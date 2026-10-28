-- Restore the dashboard RPCs expected by the current frontend and page review
-- history in PostgreSQL. This is idempotent and does not modify relationship
-- or complaint rows. The summary name/signature matches the original caller.

-- The summary joins each pending relationship to its target complaint. The
-- existing unique index starts with source_case_id, and relationships_queue_idx
-- starts with review_status; neither supports a target_case_id lookup.
create index if not exists case_relationships_pending_target_idx
  on public.case_relationships(target_case_id)
  where review_status = 'pending';

create or replace function public.dashboard_relationship_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.active
  ) then
    raise exception 'An active profile is required';
  end if;

  return (
    with actor_profile as materialized (
      select p.id, p.role::text as role, p.is_admin, p.active, p.bureau_id,
        coalesce((to_jsonb(p)->>'can_manage_bureau')::boolean, true) as can_manage_bureau
      from public.profiles p
      where p.id = auth.uid() and p.active
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
        order by created_at desc, id desc
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
  );
end
$$;
revoke all on function public.dashboard_relationship_summary() from public, anon;
grant execute on function public.dashboard_relationship_summary() to authenticated;

-- The queue RPC applies all filters and authorization before counting/page
-- selection. It returns only the requested page, never the full history.
create or replace function public.dashboard_relationship_review_page(
  p_review_status text,
  p_bureau_id uuid,
  p_institution_id uuid,
  p_min_similarity double precision,
  p_page_size integer,
  p_page_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.active
  ) then
    raise exception 'An active profile is required';
  end if;
  if p_review_status is not null and p_review_status not in ('pending', 'confirmed', 'rejected') then
    raise exception 'Invalid relationship review status';
  end if;
  if p_min_similarity is not null and (p_min_similarity < -1 or p_min_similarity > 1) then
    raise exception 'Minimum similarity must be between -1 and 1';
  end if;
  if p_page_offset is not null and p_page_offset < 0 then
    raise exception 'Page offset cannot be negative';
  end if;

  return (
    with actor_profile as materialized (
      select p.id, p.role::text as role, p.is_admin, p.active, p.bureau_id,
        coalesce((to_jsonb(p)->>'can_manage_bureau')::boolean, true) as can_manage_bureau
      from public.profiles p
      where p.id = auth.uid() and p.active
    ),
    visible_cases as materialized (
      select c.id, c.bureau_id, c.institution_id
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
    filtered_relationships as materialized (
      select r.id, r.source_case_id, r.target_case_id, r.relationship_type,
        r.match_reasons, r.review_status, r.review_note, r.reviewed_by,
        r.reviewed_at, r.created_at,
        to_jsonb(r)->'semantic_similarity' as semantic_similarity,
        to_jsonb(r)->'semantic_model' as semantic_model,
        to_jsonb(r)->'algorithm_version' as algorithm_version,
        to_jsonb(r)->'matching_fields' as matching_fields,
        to_jsonb(r)->'explanation' as explanation,
        source_case.bureau_id as source_bureau_id,
        target_case.bureau_id as target_bureau_id,
        source_case.institution_id as source_institution_id,
        target_case.institution_id as target_institution_id
      from public.case_relationships r
      join visible_cases source_case on source_case.id = r.source_case_id
      join visible_cases target_case on target_case.id = r.target_case_id
      where (p_review_status is null or r.review_status = p_review_status)
        and (p_bureau_id is null or source_case.bureau_id = p_bureau_id or target_case.bureau_id = p_bureau_id)
        and (p_institution_id is null or (
          source_case.institution_id = p_institution_id
          and target_case.institution_id = p_institution_id
        ))
        and (p_min_similarity is null or
          (to_jsonb(r)->>'semantic_similarity')::double precision >= p_min_similarity)
    ),
    page_rows as (
      select *
      from filtered_relationships
      order by created_at desc, id desc
      limit greatest(1, least(coalesce(p_page_size, 25), 100))
      offset coalesce(p_page_offset, 0)
    )
    select jsonb_build_object(
      'total_count', (select count(*)::integer from filtered_relationships),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'source_case_id', source_case_id,
          'target_case_id', target_case_id,
          'relationship_type', relationship_type,
          'match_reasons', match_reasons,
          'review_status', review_status,
          'review_note', review_note,
          'reviewed_by', reviewed_by,
          'reviewed_at', reviewed_at,
          'created_at', created_at,
          'semantic_similarity', semantic_similarity,
          'semantic_model', semantic_model,
          'algorithm_version', algorithm_version,
          'matching_fields', coalesce(matching_fields, '[]'::jsonb),
          'explanation', coalesce(explanation, '{}'::jsonb)
        ) order by created_at desc, id desc)
        from page_rows
      ), '[]'::jsonb)
    )
  );
end
$$;
revoke all on function public.dashboard_relationship_review_page(text, uuid, uuid, double precision, integer, integer) from public, anon;
grant execute on function public.dashboard_relationship_review_page(text, uuid, uuid, double precision, integer, integer) to authenticated;

-- These functions were added/changed above; ask PostgREST to reload after commit.
notify pgrst, 'reload schema';
