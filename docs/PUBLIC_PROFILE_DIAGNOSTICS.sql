-- Read-only checks for a newly registered user. Run against the intended
-- Supabase project in SQL Editor; do not run any write statement from this file.

-- 1) Confirm the default role exists and the expected SECURITY DEFINER trigger function exists.
select e.enumlabel as role
from pg_enum e
join pg_type t on t.oid = e.enumtypid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'app_role'
  and e.enumlabel = 'public_user';

select p.oid::regprocedure as function_name, p.prosecdef as is_security_definer
from pg_proc p
where p.oid = to_regprocedure('public.provision_public_user_profile()');

-- 2) Confirm a trigger is attached to auth.users and is enabled.
select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal
  and t.tgname = 'on_auth_user_created_public_profile';

-- 3) Count Auth identities that currently have no application profile.
-- This is aggregate-only; it does not expose email addresses or modify rows.
select count(*) as auth_users_without_profile
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 4) Inspect one affected account. Replace the placeholder with its Auth UUID.
-- This reads only role/access fields and does not expose account email.
select id, role, active, is_admin, bureau_id
from public.profiles
where id = '00000000-0000-0000-0000-000000000000'::uuid;
