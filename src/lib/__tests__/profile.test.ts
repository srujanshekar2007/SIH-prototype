import { describe, expect, it, vi } from 'vitest';
import { fetchUserProfile } from '../profile';

const authUid = 'ed28f76e-ac11-4c9d-888c-fa86088e4227';

function mockClient(responses: any[]) {
  const maybeSingle = vi.fn(async () => responses.shift());
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const from = vi.fn(() => ({ select, eq, maybeSingle }));
  return { client: { from }, from, select, eq, maybeSingle };
}

describe('authenticated profile lookup', () => {
  it('retrieves the active profile using the authenticated Auth UID', async () => {
    const profile = { id: authUid, role: 'administrator', is_admin: true, active: true };
    const mock = mockClient([{ data: profile, error: null }]);

    const result = await fetchUserProfile(mock.client, authUid);

    expect(result.data).toEqual(profile);
    expect(result.data.active).toBe(true);
    expect(mock.from).toHaveBeenCalledWith('profiles');
    expect(mock.eq).toHaveBeenCalledWith('id', authUid);
  });

  it('retries without the new optional column when the migration is not applied', async () => {
    const profile = { id: authUid, role: 'administrator', is_admin: true, active: true };
    const mock = mockClient([
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'can_manage_bureau' column of 'profiles' in the schema cache" } },
      { data: profile, error: null },
    ]);

    const result = await fetchUserProfile(mock.client, authUid);

    expect(result.data).toEqual({ ...profile, can_manage_bureau: null });
    expect(mock.eq).toHaveBeenNthCalledWith(1, 'id', authUid);
    expect(mock.eq).toHaveBeenNthCalledWith(2, 'id', authUid);
    expect(mock.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('keeps an inactive profile inactive after the legacy-column fallback', async () => {
    const profile = { id: authUid, role: 'administrator', is_admin: true, active: false };
    const mock = mockClient([
      { data: null, error: { code: '42703', message: 'column profiles.can_manage_bureau does not exist' } },
      { data: profile, error: null },
    ]);

    const result = await fetchUserProfile(mock.client, authUid);

    expect(result.data.active).toBe(false);
  });

  it('does not hide unrelated profile-query errors with a legacy retry', async () => {
    const error = { code: '42501', message: 'permission denied for table profiles' };
    const mock = mockClient([{ data: null, error }]);

    const result = await fetchUserProfile(mock.client, authUid);

    expect(result.error).toBe(error);
    expect(mock.maybeSingle).toHaveBeenCalledTimes(1);
  });
});
