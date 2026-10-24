import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createLocalAiApp } from '../app';

const authUid = 'ed28f76e-ac11-4c9d-888c-fa86088e4227';
const caseId = 'd06b44c2-920b-426a-9465-999241230abc';
let openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  openServers = [];
});

async function requestApi(options: {
  profile?: any;
  complaint?: any;
  profileError?: any;
  caseError?: any;
  token?: string;
}) {
  const rows: Record<string, any> = {
    profiles: { data: options.profile ?? { id: authUid, role: 'administrator', is_admin: true, active: true }, error: options.profileError ?? null },
    complaints: { data: options.complaint === undefined ? { case_number: 'CASE-1', subject: 'Test subject', description: 'Record details' } : options.complaint, error: options.caseError ?? null },
    case_actions: { data: [{ action_type: 'note', remarks: 'Follow-up recorded' }], error: null },
  };
  const queries: string[] = [];
  const filters: [string, unknown][] = [];
  const createUserClient = vi.fn(() => ({
    from: (table: string) => {
      queries.push(table);
      const builder: any = {
        select: () => builder,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return builder; },
        maybeSingle: async () => rows[table],
        order: () => builder,
        limit: async () => rows[table],
      };
      return builder;
    },
  }));
  const summarize = vi.fn(async () => 'Local summary text');
  const app = createLocalAiApp({
    authClient: { auth: { getUser: async (token: string) => token === (options.token || 'valid-token') ? { data: { user: { id: authUid } }, error: null } : { data: { user: null }, error: new Error('invalid') } } },
    createUserClient,
    health: async () => true,
    summarize,
  });
  const server = app.listen(0, '127.0.0.1');
  openServers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/cases/${caseId}/summary`, {
    method: 'POST',
    headers: options.token === '' ? {} : { Authorization: `Bearer ${options.token || 'valid-token'}`, 'Content-Type': 'application/json' },
    body: options.token === '' ? undefined : '{}',
  });
  return { response, queries, filters, summarize, createUserClient };
}

describe('local Ollama case summary endpoint', () => {
  it('verifies the active profile and returns an on-demand summary for an authorized case', async () => {
    const { response, queries, filters, summarize, createUserClient } = await requestApi({});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ summary: 'Local summary text', stored: false, engine: 'Ollama' });
    expect(queries).toEqual(['profiles', 'complaints', 'case_actions']);
    expect(filters).toEqual([['id', authUid], ['id', caseId], ['complaint_id', caseId]]);
    expect(createUserClient).toHaveBeenCalledWith('valid-token');
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it('blocks inactive profiles before reading a complaint or invoking the model', async () => {
    const { response, queries, summarize } = await requestApi({ profile: { id: authUid, role: 'administrator', is_admin: true, active: false } });
    expect(response.status).toBe(403);
    expect(queries).toEqual(['profiles']);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('relies on RLS-visible case lookup and does not summarize an inaccessible case', async () => {
    const { response, queries, summarize } = await requestApi({ complaint: null });
    expect(response.status).toBe(404);
    expect(queries).toEqual(['profiles', 'complaints']);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('does not treat a profile lookup error as permission to proceed', async () => {
    const { response, queries, summarize } = await requestApi({ profileError: new Error('RLS denied') });
    expect(response.status).toBe(503);
    expect(queries).toEqual(['profiles']);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('requires a bearer token', async () => {
    const { response, queries, summarize } = await requestApi({ token: '' });
    expect(response.status).toBe(401);
    expect(queries).toEqual([]);
    expect(summarize).not.toHaveBeenCalled();
  });
});
