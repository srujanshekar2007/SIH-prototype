const PROFILE_COLUMNS = 'id,display_name,role,bureau_id,is_admin,active,can_manage_bureau,created_at,bureaus(name)';
const LEGACY_PROFILE_COLUMNS = 'id,display_name,role,bureau_id,is_admin,active,created_at,bureaus(name)';

export function isMissingBureauPermissionColumn(error: any) {
  if (!error) return false;
  const message = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase();
  const namesPermissionColumn = message.includes('can_manage_bureau');
  return namesPermissionColumn && (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column.{0,80}(does not exist|not found|schema cache)/.test(message) ||
    /could not find.{0,80}column/.test(message)
  );
}

export async function fetchUserProfile(client: any, authUserId: string) {
  const current = await client.from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', authUserId)
    .maybeSingle();

  if (!isMissingBureauPermissionColumn(current.error)) return current;

  // Databases that have not applied the role-scope migration still use the original
  // Bureau-wide RLS rules. Keep login working while explicitly marking the scope as legacy.
  const legacy = await client.from('profiles')
    .select(LEGACY_PROFILE_COLUMNS)
    .eq('id', authUserId)
    .maybeSingle();

  if (legacy.error) return legacy;
  return {
    ...legacy,
    data: legacy.data ? { ...legacy.data, can_manage_bureau: null } : null,
  };
}
