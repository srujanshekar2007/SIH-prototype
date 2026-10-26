import { describe, expect, it } from 'vitest';
import {
  clearSessionStartedAt,
  getSessionStartedAt,
  isSessionAgeExpired,
  MAX_AUTH_SESSION_AGE_MS,
} from '../session-age';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

function session(sessionId = 'session-1', lastSignIn: string | null = '2026-10-26T10:00:00.000Z') {
  const payload = btoa(JSON.stringify({ session_id: sessionId }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return {
    access_token: `header.${payload}.signature`,
    user: { id: 'user-1', last_sign_in_at: lastSignIn },
  };
}

describe('one-hour authenticated session age', () => {
  it('uses the server sign-in timestamp for a fresh login and retains it on restoration', () => {
    const storage = memoryStorage();
    const authenticatedAt = Date.parse('2026-10-26T10:00:00.000Z');
    const current = session();

    expect(getSessionStartedAt(current, storage, authenticatedAt + 5000)).toBe(authenticatedAt);
    expect(getSessionStartedAt(current, storage, authenticatedAt + 20_000)).toBe(authenticatedAt);
  });

  it('expires exactly at sixty minutes and remains valid just before the limit', () => {
    const start = Date.parse('2026-10-26T10:00:00.000Z');
    expect(isSessionAgeExpired(start, start + MAX_AUTH_SESSION_AGE_MS - 1)).toBe(false);
    expect(isSessionAgeExpired(start, start + MAX_AUTH_SESSION_AGE_MS)).toBe(true);
  });

  it('falls back to an in-memory start time if session storage is unavailable', () => {
    const blockedStorage = {
      getItem: () => { throw new Error('Storage blocked'); },
      setItem: () => { throw new Error('Storage blocked'); },
      removeItem: () => { throw new Error('Storage blocked'); },
    };
    const now = Date.parse('2026-10-26T10:05:00.000Z');
    expect(getSessionStartedAt(session('session-2', null), blockedStorage, now)).toBe(now);
  });

  it('clears only the timestamp associated with the signed-in Supabase session', () => {
    const storage = memoryStorage();
    const first = session('session-1');
    const second = session('session-2');
    getSessionStartedAt(first, storage, Date.now());
    getSessionStartedAt(second, storage, Date.now());

    clearSessionStartedAt(first, storage);

    expect(storage.values.has('aicte-auth-start:session-1')).toBe(false);
    expect(storage.values.has('aicte-auth-start:session-2')).toBe(true);
  });
});
