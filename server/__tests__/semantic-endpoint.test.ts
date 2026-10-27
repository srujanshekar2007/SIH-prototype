import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/overlap/matches';

const mockClients = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => mockClients.createClient(...args) }));

afterEach(() => {
  vi.unstubAllEnvs();
  mockClients.createClient.mockReset();
});

function run(headers: Record<string, string> = {}, method = 'POST', body?: unknown) {
  const state: { code: number; body: unknown } = { code: 200, body: null };
  const response = {
    setHeader: vi.fn(),
    status(code: number) { state.code = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };
  return handler({ method, headers, body } as any, response as any).then(() => state);
}

function configureServer() {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'publishable-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-key');
  vi.stubEnv('OPENAI_API_KEY', 'server-only-provider-key');
  vi.stubEnv('AI_EXTERNAL_COMPLAINT_TEXT_APPROVED', 'true');
}

describe('AI overlap endpoint authorization/configuration', () => {
  it('keeps the provider optional and returns a rule-based fallback message when no key exists', async () => {
    configureServer();
    vi.stubEnv('OPENAI_API_KEY', '');
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'official', role: 'rb_officer', is_admin: false, active: true, bureau_id: 'bureau', can_manage_bureau: false }, error: null }) };
    mockClients.createClient.mockReturnValueOnce({ auth: { getUser: async () => ({ data: { user: { id: 'official' } }, error: null }) }, from: () => query });
    const result = await run({ authorization: 'Bearer signed-in-token' });
    expect(result.code).toBe(503);
    expect(result.body).toMatchObject({ code: 'ai_not_configured' });
    expect(mockClients.createClient).toHaveBeenCalledTimes(1);
  });

  it('rejects a read-only or unauthorized profile before querying complaint records', async () => {
    configureServer();
    const from = vi.fn((table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { id: 'official', role: 'aicte_official', is_admin: false, active: true, bureau_id: null, can_manage_bureau: false }, error: null }),
      };
      if (table !== 'profiles') throw new Error(`Complaint table read occurred before role check: ${table}`);
      return query;
    });
    const caller = { auth: { getUser: async () => ({ data: { user: { id: 'official' } }, error: null }) }, from };
    mockClients.createClient.mockReturnValueOnce(caller).mockReturnValueOnce({});
    const result = await run({ authorization: 'Bearer signed-in-token' });
    expect(result.code).toBe(403);
    expect(result.body).toMatchObject({ code: 'forbidden' });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthenticated requests and unsupported methods', async () => {
    configureServer();
    expect((await run()).code).toBe(401);
    expect((await run({ authorization: 'Bearer x' }, 'GET')).code).toBe(405);
  });

  it('rejects an invalid requested threshold as JSON before reading complaint records', async () => {
    configureServer();
    const profileQuery: any = {
      select: () => profileQuery,
      eq: () => profileQuery,
      maybeSingle: async () => ({ data: { id: 'official', role: 'rb_officer', is_admin: false, active: true, bureau_id: 'bureau', can_manage_bureau: true }, error: null }),
    };
    const complaintRead = vi.fn(() => { throw new Error('Complaint query should not occur for an invalid threshold'); });
    const caller = {
      auth: { getUser: async () => ({ data: { user: { id: 'official' } }, error: null }) },
      from: (table: string) => table === 'profiles' ? profileQuery : complaintRead(),
    };
    mockClients.createClient.mockReturnValueOnce(caller).mockReturnValueOnce({});
    const result = await run({ authorization: 'Bearer signed-in-token' }, 'POST', { threshold: '0.65' });
    expect(result.code).toBe(400);
    expect(result.body).toMatchObject({ code: 'invalid_threshold' });
    expect(complaintRead).not.toHaveBeenCalled();
  });
});
