-- Keep assignment ownership on complaints and action history on the confirmed case_actions schema.
-- This trigger deliberately does not reference the optional assigned_to history column.
create or replace function public.apply_case_action() returns trigger
language plpgsql security definer set search_path=public as $$
declare old_status public.case_status; assigned_officer uuid;
begin
  select status, assigned_officer_id into old_status, assigned_officer
  from public.complaints
  where id = new.complaint_id
  for update;

  if not public.can_access_case(new.complaint_id) then
    raise exception 'Not authorized for this case';
  end if;

  new.actor_id = auth.uid();
  new.status_before = old_status;
  if new.status_after is not null then
    update public.complaints
    set status = new.status_after, updated_at = now()
    where id = new.complaint_id;
  end if;

  insert into public.audit_logs(actor_id, entity_type, entity_id, action, details)
  values (
    auth.uid(), 'complaint', new.complaint_id, new.action_type,
    jsonb_build_object('remarks', new.remarks, 'status_before', old_status, 'status_after', new.status_after, 'assigned_officer_id', assigned_officer)
  );
  return new;
end
$$;

-- Assignment is written atomically to complaints.assigned_officer_id plus an append-only
-- assignment action. The target officer is not stored in case_actions.
create or replace function public.assign_complaint_officer(
  p_complaint_id uuid,
  p_assigned_officer_id uuid,
  p_remarks text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  case_bureau uuid;
  target_bureau uuid;
  target_role text;
  target_active boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_remarks is null or length(btrim(p_remarks)) < 5 then
    raise exception 'Assignment remarks must contain at least 5 characters';
  end if;

  select bureau_id into case_bureau
  from public.complaints
  where id = p_complaint_id
  for update;
  if not found then raise exception 'Case not found'; end if;
  if not public.can_access_case(p_complaint_id) then raise exception 'Not authorized for this case'; end if;
  if not public.is_admin() and not (public.can_manage_bureau() and case_bureau = public.current_bureau()) then
    raise exception 'Only an authorized Bureau/Cell manager can assign cases';
  end if;

  select bureau_id, role::text, active into target_bureau, target_role, target_active
  from public.profiles
  where id = p_assigned_officer_id;
  if target_active is distinct from true
    or target_role not in ('pgrc_officer', 'rb_officer', 'bureau_officer')
    or target_bureau is distinct from case_bureau then
    raise exception 'Assignee must be an active officer in the case Bureau/Cell';
  end if;

  update public.complaints
  set assigned_officer_id = p_assigned_officer_id, updated_at = now()
  where id = p_complaint_id;

  insert into public.case_actions(complaint_id, action_type, remarks, actor_id)
  values (p_complaint_id, 'assignment', btrim(p_remarks), auth.uid());

  return p_assigned_officer_id;
end
$$;
revoke all on function public.assign_complaint_officer(uuid, uuid, text) from public, anon;
grant execute on function public.assign_complaint_officer(uuid, uuid, text) to authenticated;

-- Dashboard summary reads only pending relationship data, aggregates it in PostgreSQL,
-- and applies the same active-profile case scope as public.can_access_case().
create or replace function public.dashboard_relationship_summary() returns jsonb
language sql stable security definer set search_path=public as $$
  with actor_profile as materialized (
    select id, role::text as role, is_admin, active, bureau_id, can_manage_bureau
    from public.profiles
    where id = auth.uid() and active
  ),
  visible_cases as materialized (
    select c.id, c.bureau_id
    from public.complaints c
    cross join actor_profile p
    where p.is_admin
      or p.role = 'aicte_official'
      or (
        p.role in ('pgrc_officer', 'rb_officer', 'bureau_officer')
        and (
          (coalesce(p.can_manage_bureau, true) and c.bureau_id = p.bureau_id)
          or c.assigned_officer_id = p.id
        )
      )
  ),
  authorized_pending as materialized (
    select r.id, r.source_case_id, r.target_case_id, r.match_reasons, r.created_at,
      source_case.bureau_id as source_bureau_id,
      target_case.bureau_id as target_bureau_id
    from public.case_relationships r
    join visible_cases source_case on source_case.id = r.source_case_id
    join visible_cases target_case on target_case.id = r.target_case_id
    where r.review_status = 'pending'
  ),
  recent_rows as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'source_case_id', recent.source_case_id,
        'target_case_id', recent.target_case_id,
        'review_status', 'pending',
        'match_reasons', recent.match_reasons,
        'created_at', recent.created_at
      ) order by recent.created_at desc
    ), '[]'::jsonb) as rows
    from (
      select id, source_case_id, target_case_id, match_reasons, created_at
      from authorized_pending
      order by created_at desc, id
      limit 50
    ) recent
  ),
  affected_case_ids as (
    select coalesce(jsonb_agg(case_id), '[]'::jsonb) as ids
    from (
      select source_case_id as case_id from authorized_pending
      union
      select target_case_id as case_id from authorized_pending
    ) affected
  ),
  bureau_counts as (
    select coalesce(jsonb_agg(jsonb_build_object('name', unit_name, 'value', total) order by unit_name), '[]'::jsonb) as rows
    from (
      select coalesce(b.name, 'Unassigned') as unit_name, count(*)::integer as total
      from (
        select source_bureau_id as bureau_id from authorized_pending
        union all
        select target_bureau_id as bureau_id from authorized_pending
      ) units
      left join public.bureaus b on b.id = units.bureau_id
      group by coalesce(b.name, 'Unassigned')
    ) counts
  )
  select jsonb_build_object(
    'pending_count', (select count(*)::integer from authorized_pending),
    'case_ids', (select ids from affected_case_ids),
    'by_bureau', (select rows from bureau_counts),
    'recent', (select rows from recent_rows)
  )
$$;
revoke all on function public.dashboard_relationship_summary() from public, anon;
grant execute on function public.dashboard_relationship_summary() to authenticated;

-- Supports the institution-blocked cross-bureau candidate join used by the rule-based finder.
create index if not exists complaints_overlap_candidates_idx
  on public.complaints(institution_id, bureau_id, id)
  where bureau_id is not null;
