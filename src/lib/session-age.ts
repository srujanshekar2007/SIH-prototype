export const MAX_AUTH_SESSION_AGE_MS = 60 * 60 * 1000;

type SessionAgeLike = {
  access_token?: string;
  user?: { id?: string; last_sign_in_at?: string | null };
};

export type TimestampStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function getSessionTimestampKey(session: SessionAgeLike | null): string | null {
  if (!session) return null;
  const userId = session.user?.id;
  if (!userId) return null;

  try {
    const payload = session.access_token?.split('.')[1];
    if (payload) {
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
      const claims = JSON.parse(decodeURIComponent(Array.from(decoded, (char) =>
        `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
      ).join('')));
      if (typeof claims.session_id === 'string' && claims.session_id) {
        return `aicte-auth-start:${claims.session_id}`;
      }
    }
  } catch {
    // Fall back to the user-scoped key for older or nonstandard JWTs.
  }

  return `aicte-auth-start:${userId}`;
}

export function getSessionStartedAt(
  session: SessionAgeLike,
  storage: TimestampStorage,
  now = Date.now(),
): number {
  const key = getSessionTimestampKey(session);
  let startedAt = now;
  const serverSignIn = Date.parse(session.user?.last_sign_in_at || '');

  if (key) {
    try {
      const stored = Number(storage.getItem(key));
      if (Number.isFinite(stored) && stored > 0 && stored <= now) startedAt = stored;
      else {
        if (Number.isFinite(serverSignIn) && serverSignIn > 0 && serverSignIn <= now) startedAt = serverSignIn;
      }
    } catch {
      if (Number.isFinite(serverSignIn) && serverSignIn > 0 && serverSignIn <= now) startedAt = serverSignIn;
    }
  }

  if (key) {
    try {
      storage.setItem(key, String(startedAt));
    } catch {
      // The in-memory timer still enforces the limit for this page lifetime.
    }
  }

  return startedAt;
}

export function clearSessionStartedAt(session: SessionAgeLike | null, storage: TimestampStorage): void {
  if (!session) return;
  const key = getSessionTimestampKey(session);
  if (!key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }
}

export function isSessionAgeExpired(startedAt: number, now = Date.now()): boolean {
  return !Number.isFinite(startedAt) || now - startedAt >= MAX_AUTH_SESSION_AGE_MS;
}
