-- Reconcile the optional bureau-management scope column confirmed missing in the
-- selected live schema. Existing profiles remain NULL (legacy bureau scope); only
-- newly created profiles receive the restrictive false default.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'can_manage_bureau'
  ) then
    alter table public.profiles add column can_manage_bureau boolean;
  end if;
end
$$;
alter table public.profiles alter column can_manage_bureau set default false;

create or replace function public.can_manage_bureau()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(p.can_manage_bureau, true)
      and p.active
      and p.role::text in ('pgrc_officer', 'rb_officer', 'bureau_officer')
    from public.profiles p
    where p.id = auth.uid()
  ), false)
$$;

-- Require transfers/escalations to name a different, active configured Bureau/Cell.
-- Ownership remains single-primary-bureau; the existing case_actions/audit trigger
-- records the transition and the complaint row is updated atomically.
create or replace function public.apply_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_status public.case_status;
  previous_bureau uuid;
  next_status public.case_status;
begin
  if auth.uid() is null or not public.can_act_on_case(new.complaint_id) then
    raise exception 'Not authorized to transfer or escalate this case';
  end if;

  select status, bureau_id into previous_status, previous_bureau
  from public.complaints
  where id = new.complaint_id
  for update;
  if not found then raise exception 'Case not found'; end if;
  if new.to_bureau_id is null then
    raise exception 'Choose a destination Bureau/Cell';
  end if;
  if new.to_bureau_id = previous_bureau then
    raise exception 'Choose a different destination Bureau/Cell';
  end if;
  if not exists (
    select 1 from public.bureaus b
    where b.id = new.to_bureau_id and b.active
  ) then
    raise exception 'The destination Bureau/Cell is unavailable';
  end if;

  new.actor_id := auth.uid();
  new.from_bureau_id := previous_bureau;
  next_status := case
    when new.transfer_type = 'escalation' then 'Escalated'::public.case_status
    else 'Transferred'::public.case_status
  end;

  insert into public.case_actions(complaint_id, action_type, remarks, status_after, actor_id)
  values (new.complaint_id, new.transfer_type, new.reason, next_status, auth.uid());

  update public.complaints
  set bureau_id = new.to_bureau_id, status = next_status, updated_at = now()
  where id = new.complaint_id;

  return new;
end
$$;
