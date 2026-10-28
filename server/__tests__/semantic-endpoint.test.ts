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
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { state.code = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };
  return handler({ method, headers, body } as any, response as any).then(() => ({ ...state, headers: response.headers }));
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
    const unsupported = await run({ authorization: 'Bearer x' }, 'GET');
    expect(unsupported.code).toBe(405);
    expect(unsupported.body).toMatchObject({ code: 'method_not_allowed' });
    expect(unsupported.headers.Allow).toBe('POST');
    expect(mockClients.createClient).not.toHaveBeenCalled();
  });

  it('returns a structured 503 when server Supabase configuration is missing', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const result = await run({ authorization: 'Bearer signed-in-token' });
    expect(result.code).toBe(503);
    expect(result.body).toMatchObject({ code: 'server_not_configured' });
    expect(mockClients.createClient).not.toHaveBeenCalled();
  });

  it('falls back when the optional bureau manager column is absent', async () => {
    configureServer();
    vi.stubEnv('OPENAI_API_KEY', '');
    const columns: string[] = [];
    let reads = 0;
    const query: any = {
      select: (value: string) => { columns.push(value); return query; },
      eq: () => query,
      maybeSingle: async () => ++reads === 1
        ? { data: null, error: { code: '42703', message: 'column profiles.can_manage_bureau does not exist' } }
        : { data: { id: 'official', role: 'rb_officer', is_admin: false, active: true, bureau_id: 'bureau' }, error: null },
    };
    mockClients.createClient.mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: 'official' } }, error: null }) },
      from: vi.fn(() => query),
    });

    const result = await run({ authorization: 'Bearer signed-in-token' });

    expect(result.code).toBe(503);
    expect(result.body).toMatchObject({ code: 'ai_not_configured' });
    expect(columns).toHaveLength(2);
    expect(columns[1]).not.toContain('can_manage_bureau');
  });

  it('preserves a valid authenticated POST response when no candidates need embeddings', async () => {
    configureServer();
    const profileQuery: any = {
      select: () => profileQuery,
      eq: () => profileQuery,
      maybeSingle: async () => ({ data: { id: 'official', role: 'rb_officer', is_admin: false, active: true, bureau_id: 'bureau', can_manage_bureau: true }, error: null }),
    };
    const complaintQuery: any = {
      select: () => complaintQuery,
      order: () => complaintQuery,
      range: async () => ({ data: [], error: null }),
    };
    const relationshipQuery: any = { select: async () => ({ data: [], error: null }) };
    const caller = {
      auth: { getUser: async () => ({ data: { user: { id: 'official' } }, error: null }) },
      from: (table: string) => table === 'profiles' ? profileQuery : table === 'complaints' ? complaintQuery : relationshipQuery,
    };
    mockClients.createClient.mockReturnValueOnce(caller).mockReturnValueOnce({});

    const result = await run({ authorization: 'Bearer signed-in-token' });
    expect(result.code).toBe(200);
    expect(result.body).toMatchObject({ generated: 0, evaluated: 0, model: 'text-embedding-3-small' });
    expect(mockClients.createClient).toHaveBeenCalledTimes(2);
  });

  it('does not expose client initialization exceptions in the API response', async () => {
    configureServer();
    mockClients.createClient.mockImplementationOnce(() => { throw new Error('sensitive runtime detail'); });
    const result = await run({ authorization: 'Bearer signed-in-token' });
    expect(result.code).toBe(503);
    expect(result.body).toMatchObject({ code: 'matching_unavailable' });
    expect(JSON.stringify(result.body)).not.toContain('sensitive runtime detail');
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
