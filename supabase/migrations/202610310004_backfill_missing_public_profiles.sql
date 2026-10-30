-- Existing Auth users created before public profile provisioning was installed may
-- have no application profile. Give only orphaned Auth identities the fixed,
-- least-privilege public role. Existing profiles and role assignments are untouched.
insert into public.profiles (id, display_name, role, bureau_id, is_admin, active)
select
  u.id,
  left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), ''), 120),
  'public_user'::public.app_role,
  null,
  false,
  true
from auth.users as u
where not exists (
  select 1
  from public.profiles as p
  where p.id = u.id
)
on conflict (id) do nothing;
