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
  it('returns 405 and Allow for GET before touching server configuration', async () => {
    const server = createLocalApiApp().listen(0, '127.0.0.1');
    openServers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/overlap/matches`, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'method_not_allowed' });
  });

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

  it('returns structured JSON for malformed request bodies', async () => {
    const server = createLocalApiApp().listen(0, '127.0.0.1');
    openServers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/overlap/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'invalid_json' });
  });

  it('returns structured JSON when the request body exceeds the parser limit', async () => {
    const server = createLocalApiApp().listen(0, '127.0.0.1');
    openServers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/overlap/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'x'.repeat(3000) }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'request_too_large' });
  });
});
