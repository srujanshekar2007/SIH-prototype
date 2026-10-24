-- Extend the existing bureau-scoped authorization model to the generic Bureau/Regional Office role.
-- This keeps individual officers assignment-scoped and managers bureau-scoped under can_manage_bureau().
alter table public.profiles drop constraint if exists role_bureau_consistency;
alter table public.profiles add constraint role_bureau_consistency check (
  (role in ('pgrc_officer','rb_officer','bureau_officer') and bureau_id is not null)
  or role in ('aicte_official','administrator')
);

create or replace function public.can_manage_bureau() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((select coalesce(can_manage_bureau, true) and active and role in ('pgrc_officer','rb_officer','bureau_officer')
                   from public.profiles where id=auth.uid()),false)
$$;

create or replace function public.can_access_case(case_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_admin()
      or public.current_role() = 'aicte_official'
      or exists(
        select 1 from public.complaints c
        where c.id=case_id and (
          (public.can_manage_bureau() and c.bureau_id=public.current_bureau())
          or (public.current_role() in ('pgrc_officer','rb_officer','bureau_officer') and c.assigned_officer_id=auth.uid())
        )
      )
$$;

create or replace function public.can_act_on_case(case_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_admin()
      or exists(select 1 from public.complaints c where c.id=case_id and (
          (public.can_manage_bureau() and c.bureau_id=public.current_bureau())
          or (public.current_role() in ('pgrc_officer','rb_officer','bureau_officer') and c.assigned_officer_id=auth.uid())
      ))
$$;

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
   if target_active is distinct from true or target_role not in ('pgrc_officer','rb_officer','bureau_officer') or target_bureau is distinct from case_bureau then raise exception 'Assignee must be an active officer in the case Bureau/Cell'; end if;
   update public.complaints set assigned_officer_id=new.assigned_to,updated_at=now() where id=new.complaint_id;
 end if;
 if new.status_after is not null then update public.complaints set status=new.status_after,updated_at=now() where id=new.complaint_id; end if;
 insert into public.audit_logs(actor_id,entity_type,entity_id,action,details) values(auth.uid(),'complaint',new.complaint_id,new.action_type,jsonb_build_object('remarks',new.remarks,'status_before',old_status,'status_after',new.status_after,'assigned_to',new.assigned_to));
 return new;
end $$;

create or replace function public.suggest_same_institution_relationships() returns integer
language plpgsql security definer set search_path=public as $$
declare added integer;
begin
 if auth.uid() is null or not (public.is_admin() or public.can_manage_bureau() or public.current_role() in ('pgrc_officer','rb_officer','bureau_officer')) then
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
