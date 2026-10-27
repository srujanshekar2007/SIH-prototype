import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createLocalApiApp } from '../app';

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  openServers.length = 0;
});

describe('local semantic matching route', () => {
  it('mounts /api/overlap/matches and returns structured JSON before any database access', async () => {
    const server = createLocalApiApp().listen(0, '127.0.0.1');
    openServers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/overlap/matches`, { method: 'POST' });
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'unauthenticated' });
  });
});
