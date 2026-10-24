-- SIH26264 initial schema. Additive migration: creates application tables and policies only.
-- Run against a reviewed Supabase project with: supabase db push
create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('aicte_official','pgrc_officer','rb_officer','administrator'); exception when duplicate_object then null; end $$;
do $$ begin create type public.case_status as enum ('Pending','Under Process','Disposed','Transferred','Escalated'); exception when duplicate_object then null; end $$;

create table if not exists public.bureaus (
 id uuid primary key default gen_random_uuid(), name text not null unique, code text unique, active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade, display_name text not null default '', role public.app_role not null, bureau_id uuid references public.bureaus(id), is_admin boolean not null default false, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint role_bureau_consistency check ((role in ('pgrc_officer','rb_officer') and bureau_id is not null) or role in ('aicte_official','administrator'))
);
create table if not exists public.institutions (
 id uuid primary key default gen_random_uuid(), internal_id text not null unique, aicte_permanent_id text unique, name text not null, address text, region text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.complaints (
 id uuid primary key default gen_random_uuid(), case_number text not null unique, institution_id uuid not null references public.institutions(id), category text, subject text, description text, status public.case_status not null default 'Pending', bureau_id uuid references public.bureaus(id), assigned_officer_id uuid references public.profiles(id), priority text, received_at timestamptz not null default now(), next_action_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.case_actions (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id), action_type text not null check(action_type in ('update','assignment','transfer','escalation','coordination','note')), remarks text not null check(length(btrim(remarks)) >= 5), status_before public.case_status, status_after public.case_status, actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.transfers (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id), from_bureau_id uuid references public.bureaus(id), to_bureau_id uuid references public.bureaus(id), transfer_type text not null check(transfer_type in ('transfer','escalation')), reason text not null check(length(btrim(reason)) >= 5), actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.case_relationships (
 id uuid primary key default gen_random_uuid(), source_case_id uuid not null references public.complaints(id), target_case_id uuid not null references public.complaints(id), relationship_type text not null default 'potentially_related', match_reasons text[] not null default '{}', review_status text not null default 'pending' check(review_status in ('pending','confirmed','rejected')), review_note text, reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now(), check(source_case_id <> target_case_id), unique(source_case_id,target_case_id)
);
create table if not exists public.coordination_requests (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id), from_bureau_id uuid references public.bureaus(id), to_bureau_id uuid references public.bureaus(id), requested_by uuid not null references public.profiles(id), message text not null check(length(btrim(message)) >= 5), response text, status text not null default 'open' check(status in ('open','responded','closed')), responded_by uuid references public.profiles(id), created_at timestamptz not null default now(), responded_at timestamptz
);
create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id), complaint_id uuid references public.complaints(id), kind text not null, message text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), entity_type text not null, entity_id uuid, action text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.supporting_documents (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id), storage_path text not null unique, file_name text not null, mime_type text, uploaded_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index if not exists complaints_institution_idx on public.complaints(institution_id);
create index if not exists complaints_bureau_status_idx on public.complaints(bureau_id,status);
create index if not exists complaints_due_idx on public.complaints(next_action_at) where status <> 'Disposed';
create index if not exists actions_case_date_idx on public.case_actions(complaint_id,created_at desc);
create index if not exists relationships_queue_idx on public.case_relationships(review_status,created_at desc);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id,created_at desc);

create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() and active $$;
create or replace function public.current_bureau() returns uuid language sql stable security definer set search_path=public as $$ select bureau_id from public.profiles where id=auth.uid() and active $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select is_admin and active from public.profiles where id=auth.uid()),false) $$;
create or replace function public.can_access_case(case_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_admin() or public.current_role() in ('aicte_official','administrator') or exists(select 1 from public.complaints c where c.id=case_id and (c.bureau_id=public.current_bureau() or c.assigned_officer_id=auth.uid()))
$$;

-- Derive cross-bureau review suggestions only from shared institution records and cases the caller may see.
-- This is evidence for human review, never an assertion that complaints overlap.
create or replace function public.suggest_same_institution_relationships() returns integer language plpgsql security definer set search_path=public as $$
declare added integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.case_relationships(source_case_id,target_case_id,relationship_type,match_reasons)
 select least(a.id,b.id),greatest(a.id,b.id),'same_institution_review',array['Same institution record','Cross-bureau cases; complaint similarity not established']
 from public.complaints a join public.complaints b on a.institution_id=b.institution_id and a.id<b.id
 where a.bureau_id is not null and b.bureau_id is not null and a.bureau_id<>b.bureau_id
   and public.can_access_case(a.id) and public.can_access_case(b.id)
 on conflict(source_case_id,target_case_id) do nothing;
 get diagnostics added = row_count; return added;
end $$;
grant execute on function public.suggest_same_institution_relationships() to authenticated;

-- Profile provisioning is deliberately administrator controlled. No public signup UI or role self-edit.
create or replace function public.prevent_profile_privilege_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null and not public.is_admin() then
   if new.id <> old.id or new.role <> old.role or new.bureau_id is distinct from old.bureau_id or new.is_admin <> old.is_admin or new.active <> old.active then raise exception 'Profile access fields are administrator managed'; end if;
 end if;
 new.updated_at=now(); return new;
end $$;
drop trigger if exists profile_privilege_guard on public.profiles;
create trigger profile_privilege_guard before update on public.profiles for each row execute function public.prevent_profile_privilege_change();

-- Append-only action history; status transitions are applied with their history row.
create or replace function public.apply_case_action() returns trigger language plpgsql security definer set search_path=public as $$
declare old_status public.case_status;
begin
 select status into old_status from public.complaints where id=new.complaint_id for update;
 if not public.can_access_case(new.complaint_id) then raise exception 'Not authorized for this case'; end if;
 new.actor_id=auth.uid(); new.status_before=old_status;
 if new.status_after is not null then update public.complaints set status=new.status_after,updated_at=now() where id=new.complaint_id; end if;
 insert into public.audit_logs(actor_id,entity_type,entity_id,action,details) values(auth.uid(),'complaint',new.complaint_id,new.action_type,jsonb_build_object('remarks',new.remarks,'status_before',old_status,'status_after',new.status_after));
 return new;
end $$;
drop trigger if exists case_action_apply on public.case_actions;
create trigger case_action_apply before insert on public.case_actions for each row execute function public.apply_case_action();
create or replace function public.append_only_history() returns trigger language plpgsql as $$ begin raise exception 'History records are append-only'; end $$;
drop trigger if exists case_actions_no_mutation on public.case_actions;
create trigger case_actions_no_mutation before update or delete on public.case_actions for each row execute function public.append_only_history();
drop trigger if exists audit_logs_no_mutation on public.audit_logs;
create trigger audit_logs_no_mutation before update or delete on public.audit_logs for each row execute function public.append_only_history();

alter table public.bureaus enable row level security;
alter table public.profiles enable row level security;
alter table public.institutions enable row level security;
alter table public.complaints enable row level security;
alter table public.case_actions enable row level security;
alter table public.transfers enable row level security;
alter table public.case_relationships enable row level security;
alter table public.coordination_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.supporting_documents enable row level security;

drop policy if exists bureaus_read_auth on public.bureaus; create policy bureaus_read_auth on public.bureaus for select to authenticated using (auth.uid() is not null);
drop policy if exists profile_read_scope on public.profiles; create policy profile_read_scope on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
drop policy if exists profile_admin_update on public.profiles; create policy profile_admin_update on public.profiles for update to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists institutions_read_authorized on public.institutions; create policy institutions_read_authorized on public.institutions for select to authenticated using (exists(select 1 from public.complaints c where c.institution_id=institutions.id and public.can_access_case(c.id)) or public.is_admin());
drop policy if exists complaints_read_scope on public.complaints; create policy complaints_read_scope on public.complaints for select to authenticated using(public.can_access_case(id));
drop policy if exists complaints_insert_admin on public.complaints; create policy complaints_insert_admin on public.complaints for insert to authenticated with check(public.is_admin() or (created_by=auth.uid() and bureau_id=public.current_bureau() and public.current_role() in ('pgrc_officer','rb_officer')));
drop policy if exists complaints_update_scope on public.complaints; create policy complaints_update_scope on public.complaints for update to authenticated using(public.is_admin() or (bureau_id=public.current_bureau() and public.current_role() in ('pgrc_officer','rb_officer'))) with check(public.is_admin() or (bureau_id=public.current_bureau() and public.current_role() in ('pgrc_officer','rb_officer')));
drop policy if exists action_read_scope on public.case_actions; create policy action_read_scope on public.case_actions for select to authenticated using(public.can_access_case(complaint_id));
drop policy if exists action_insert_scope on public.case_actions; create policy action_insert_scope on public.case_actions for insert to authenticated with check(public.can_access_case(complaint_id) and actor_id=auth.uid());
drop policy if exists transfer_read_scope on public.transfers; create policy transfer_read_scope on public.transfers for select to authenticated using(public.can_access_case(complaint_id));
drop policy if exists transfer_insert_scope on public.transfers; create policy transfer_insert_scope on public.transfers for insert to authenticated with check(public.can_access_case(complaint_id) and actor_id=auth.uid());
drop policy if exists relationship_read_scope on public.case_relationships; create policy relationship_read_scope on public.case_relationships for select to authenticated using(public.can_access_case(source_case_id) and public.can_access_case(target_case_id));
drop policy if exists relationship_review_scope on public.case_relationships; create policy relationship_review_scope on public.case_relationships for update to authenticated using(public.can_access_case(source_case_id) and public.can_access_case(target_case_id)) with check(public.can_access_case(source_case_id) and public.can_access_case(target_case_id) and reviewed_by=auth.uid());
drop policy if exists coordination_read_scope on public.coordination_requests; create policy coordination_read_scope on public.coordination_requests for select to authenticated using(public.can_access_case(complaint_id));
drop policy if exists coordination_insert_scope on public.coordination_requests; create policy coordination_insert_scope on public.coordination_requests for insert to authenticated with check(public.can_access_case(complaint_id) and requested_by=auth.uid());
drop policy if exists coordination_update_scope on public.coordination_requests; create policy coordination_update_scope on public.coordination_requests for update to authenticated using(public.can_access_case(complaint_id)) with check(public.can_access_case(complaint_id) and responded_by=auth.uid());
drop policy if exists notifications_read_self on public.notifications; create policy notifications_read_self on public.notifications for select to authenticated using(recipient_id=auth.uid());
drop policy if exists notifications_update_self on public.notifications; create policy notifications_update_self on public.notifications for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
drop policy if exists audit_admin_read on public.audit_logs; create policy audit_admin_read on public.audit_logs for select to authenticated using(public.is_admin());
-- Audit inserts are performed only by SECURITY DEFINER workflow triggers; authenticated clients cannot forge audit entries.
drop policy if exists documents_read_case on public.supporting_documents; create policy documents_read_case on public.supporting_documents for select to authenticated using(public.can_access_case(complaint_id));
drop policy if exists documents_insert_case on public.supporting_documents; create policy documents_insert_case on public.supporting_documents for insert to authenticated with check(public.can_access_case(complaint_id) and uploaded_by=auth.uid());

-- Transfer is recorded first in immutable workflow history, then ownership/status move atomically.
create or replace function public.apply_transfer() returns trigger language plpgsql security definer set search_path=public as $$
declare prev_status public.case_status; prev_bureau uuid; next_status public.case_status;
begin
 if not public.can_access_case(new.complaint_id) then raise exception 'Not authorized for this case'; end if;
 select status,bureau_id into prev_status,prev_bureau from public.complaints where id=new.complaint_id for update;
 new.actor_id=auth.uid(); new.from_bureau_id=prev_bureau;
 next_status=case when new.transfer_type='escalation' then 'Escalated'::public.case_status else 'Transferred'::public.case_status end;
 insert into public.case_actions(complaint_id,action_type,remarks,status_after,actor_id) values(new.complaint_id,new.transfer_type,new.reason,next_status,auth.uid());
 update public.complaints set bureau_id=coalesce(new.to_bureau_id,bureau_id),status=next_status,updated_at=now() where id=new.complaint_id;
 return new;
end $$;
drop trigger if exists transfer_apply on public.transfers;
create trigger transfer_apply before insert on public.transfers for each row execute function public.apply_transfer();
