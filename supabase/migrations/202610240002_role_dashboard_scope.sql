-- Add explicit Bureau/Cell management scope without updating existing profile rows.
-- NULL marks a profile that existed before this migration; its former bureau-wide access is
-- preserved until an administrator explicitly sets true (manager) or false (individual officer).
-- New profiles receive false from the column default.
do $$ begin
 if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='can_manage_bureau') then
   alter table public.profiles add column can_manage_bureau boolean;
   alter table public.profiles alter column can_manage_bureau set default false;
 end if;
end $$;

create or replace function public.can_manage_bureau() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((select coalesce(can_manage_bureau, true) and active and role in ('pgrc_officer','rb_officer')
                   from public.profiles where id=auth.uid()),false)
$$;

-- A bureau manager can see the whole assigned bureau. Individual officers can see only
-- cases assigned to them. AICTE officials retain read scope but do not gain admin actions.
-- Administrator role text alone is not sufficient; is_admin() must be true.
create or replace function public.can_access_case(case_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_admin()
      or public.current_role() = 'aicte_official'
      or exists(
        select 1 from public.complaints c
        where c.id=case_id and (
          (public.can_manage_bureau() and c.bureau_id=public.current_bureau())
          or (public.current_role() in ('pgrc_officer','rb_officer') and c.assigned_officer_id=auth.uid())
        )
      )
$$;

-- Keep profile scope fields administrator-only; users cannot grant themselves bureau access.
create or replace function public.prevent_profile_privilege_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null and not public.is_admin() then
   if new.id <> old.id or new.role <> old.role or new.bureau_id is distinct from old.bureau_id
      or new.is_admin <> old.is_admin or new.active <> old.active
      or new.can_manage_bureau <> old.can_manage_bureau then
     raise exception 'Profile access fields are administrator managed';
   end if;
 end if;
 new.updated_at=now(); return new;
end $$;

-- Only bureau managers (or a designated administrator) can create new bureau cases.
drop policy if exists complaints_insert_admin on public.complaints;
create policy complaints_insert_admin on public.complaints for insert to authenticated
with check(public.is_admin() or (public.can_manage_bureau() and created_by=auth.uid() and bureau_id=public.current_bureau()));

-- Bureau managers may see names/roles only for profiles in their own Bureau/Cell, needed for
-- authorized officer workload summaries. Individual officers retain self-only profile visibility.
drop policy if exists profile_read_scope on public.profiles;
create policy profile_read_scope on public.profiles for select to authenticated
using (id=auth.uid() or public.is_admin() or (public.can_manage_bureau() and bureau_id=public.current_bureau()));

-- Former and destination bureau managers may follow transfer/coordination records that
-- involve their own unit, while the underlying complaint remains protected independently.
drop policy if exists transfer_read_scope on public.transfers;
create policy transfer_read_scope on public.transfers for select to authenticated
using (public.can_access_case(complaint_id) or (public.can_manage_bureau() and (from_bureau_id=public.current_bureau() or to_bureau_id=public.current_bureau())));
drop policy if exists coordination_read_scope on public.coordination_requests;
create policy coordination_read_scope on public.coordination_requests for select to authenticated
using (public.can_access_case(complaint_id) or (public.can_manage_bureau() and (from_bureau_id=public.current_bureau() or to_bureau_id=public.current_bureau())));

-- Separate read scope from workflow authority. AICTE officials retain organization-wide
-- read access but cannot mutate cases solely by holding that role.
create or replace function public.can_act_on_case(case_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_admin()
      or exists(select 1 from public.complaints c where c.id=case_id and (
          (public.can_manage_bureau() and c.bureau_id=public.current_bureau())
          or (public.current_role() in ('pgrc_officer','rb_officer') and c.assigned_officer_id=auth.uid())
      ))
$$;

drop policy if exists complaints_update_scope on public.complaints;
-- Case changes must be written through append-only case_actions/transfers workflow triggers.
-- This prevents broad row updates from silently changing assignment, owner, or case history.
drop policy if exists action_insert_scope on public.case_actions;
create policy action_insert_scope on public.case_actions for insert to authenticated
with check(public.can_act_on_case(complaint_id) and actor_id=auth.uid());
drop policy if exists transfer_insert_scope on public.transfers;
create policy transfer_insert_scope on public.transfers for insert to authenticated
with check(public.can_act_on_case(complaint_id) and actor_id=auth.uid());
drop policy if exists relationship_review_scope on public.case_relationships;
create policy relationship_review_scope on public.case_relationships for update to authenticated
using(public.can_act_on_case(source_case_id) and public.can_act_on_case(target_case_id))
with check(public.can_act_on_case(source_case_id) and public.can_act_on_case(target_case_id) and reviewed_by=auth.uid());
drop policy if exists coordination_insert_scope on public.coordination_requests;
create policy coordination_insert_scope on public.coordination_requests for insert to authenticated
with check(public.can_act_on_case(complaint_id) and requested_by=auth.uid());
drop policy if exists coordination_update_scope on public.coordination_requests;
create policy coordination_update_scope on public.coordination_requests for update to authenticated
using (public.can_act_on_case(complaint_id) or (public.can_manage_bureau() and (from_bureau_id=public.current_bureau() or to_bureau_id=public.current_bureau())))
with check ((public.can_act_on_case(complaint_id) or (public.can_manage_bureau() and (from_bureau_id=public.current_bureau() or to_bureau_id=public.current_bureau()))) and responded_by=auth.uid());
drop policy if exists documents_insert_case on public.supporting_documents;
create policy documents_insert_case on public.supporting_documents for insert to authenticated
with check(public.can_act_on_case(complaint_id) and uploaded_by=auth.uid());

-- Add an explicit assignment target to the append-only case history so reassignments are auditable.
alter table public.case_actions add column if not exists assigned_to uuid references public.profiles(id);
create or replace function public.apply_case_action() returns trigger
language plpgsql security definer set search_path=public as $$
declare old_status public.case_status; case_bureau uuid; target_role public.app_role; target_bureau uuid; target_active boolean;
begin
 select status,bureau_id into old_status,case_bureau from public.complaints where id=new.complaint_id for update;
 if not public.can_access_case(new.complaint_id) then raise exception 'Not authorized for this case'; end if;
 new.actor_id=auth.uid(); new.status_before=old_status;
 if new.action_type='assignment' then
   if not public.is_admin() and not (public.can_manage_bureau() and case_bureau=public.current_bureau()) then raise exception 'Only an authorized Bureau manager can assign cases'; end if;
   select role,bureau_id,active into target_role,target_bureau,target_active from public.profiles where id=new.assigned_to;
   if target_active is distinct from true or target_role not in ('pgrc_officer','rb_officer') or target_bureau is distinct from case_bureau then raise exception 'Assignee must be an active officer in the case Bureau/Cell'; end if;
   update public.complaints set assigned_officer_id=new.assigned_to,updated_at=now() where id=new.complaint_id;
 end if;
 if new.status_after is not null then update public.complaints set status=new.status_after,updated_at=now() where id=new.complaint_id; end if;
 insert into public.audit_logs(actor_id,entity_type,entity_id,action,details) values(auth.uid(),'complaint',new.complaint_id,new.action_type,jsonb_build_object('remarks',new.remarks,'status_before',old_status,'status_after',new.status_after,'assigned_to',new.assigned_to));
 return new;
end $$;

-- The overlap suggestion RPC writes relationship records. Permit it only for workflow-capable
-- users; organization-wide read access alone (AICTE official role) is not mutation authority.
create or replace function public.suggest_same_institution_relationships() returns integer
language plpgsql security definer set search_path=public as $$
declare added integer;
begin
 if auth.uid() is null or not (public.is_admin() or public.can_manage_bureau() or public.current_role() in ('pgrc_officer','rb_officer')) then
   raise exception 'Not authorized to generate relationship suggestions';
 end if;
 insert into public.case_relationships(source_case_id,target_case_id,relationship_type,match_reasons)
 select least(a.id,b.id),greatest(a.id,b.id),'same_institution_review',array['Same institution record','Cross-bureau cases; complaint similarity not established']
 from public.complaints a join public.complaints b on a.institution_id=b.institution_id and a.id<b.id
 where a.bureau_id is not null and b.bureau_id is not null and a.bureau_id<>b.bureau_id
   and public.can_access_case(a.id) and public.can_access_case(b.id)
 on conflict(source_case_id,target_case_id) do nothing;
 get diagnostics added = row_count; return added;
end $$;
