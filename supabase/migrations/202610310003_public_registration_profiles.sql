-- Public sign-up uses one least-privilege role. This does not grant complaint,
-- institution, workflow, or administrative access and does not change existing rows.

-- Keep the project's bureau-role invariant and permit only bureau-less public accounts.
alter table public.profiles drop constraint if exists role_bureau_consistency;
alter table public.profiles add constraint role_bureau_consistency check (
  (role in ('pgrc_officer','rb_officer','bureau_officer') and bureau_id is not null)
  or role in ('aicte_official','administrator')
  or (role = 'public_user' and bureau_id is null and is_admin = false)
);

-- Do not trust role, bureau, active, or admin values from user metadata. Every new
-- Auth account receives the fixed public_user role and no Bureau or admin scope.
create or replace function public.provision_public_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  supplied_name text;
begin
  supplied_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  insert into public.profiles (id, display_name, role, bureau_id, is_admin, active)
  values (
    new.id,
    left(coalesce(supplied_name, ''), 120),
    'public_user',
    null,
    false,
    true
  )
  on conflict (id) do nothing;
  return new;
end
$$;

revoke all on function public.provision_public_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_public_profile on auth.users;
create trigger on_auth_user_created_public_profile
  after insert on auth.users
  for each row execute function public.provision_public_user_profile();

comment on function public.provision_public_user_profile() is
  'Creates a least-privilege public_user profile for Auth signups; caller metadata cannot set roles or bureau scope.';
