-- Read-only diagnostics for public.dashboard_relationship_summary().
-- Run in the intended Supabase project's SQL Editor. Replace the UUID below with
-- the id of an active profile whose dashboard is experiencing the timeout.
-- No complaint or relationship rows are modified by these queries.

-- 1) Do not assume a Supabase migration ledger exists in this project. Check
-- the ledger relation safely; NULL means it is absent/unavailable.
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;

-- 2) Inspect the deployed function definition and supporting indexes.
select to_regprocedure('public.dashboard_relationship_summary()') as resolved_function,
  case
    when to_regprocedure('public.dashboard_relationship_summary()') is null then 'Function is absent from the database.'
    else pg_get_functiondef(to_regprocedure('public.dashboard_relationship_summary()'))
  end as function_definition;

select p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as function_owner
from pg_proc p
where p.oid = to_regprocedure('public.dashboard_relationship_summary()');

-- 2a) Verify the relationship-review page RPC signature expected by the browser.
select to_regprocedure(
  'public.dashboard_relationship_review_page(text,uuid,uuid,double precision,integer,integer)'
) as resolved_review_page_function,
case
  when to_regprocedure('public.dashboard_relationship_review_page(text,uuid,uuid,double precision,integer,integer)') is null
    then 'Paginated relationship-review function is absent.'
  else pg_get_functiondef(to_regprocedure(
    'public.dashboard_relationship_review_page(text,uuid,uuid,double precision,integer,integer)'
  ))
end as review_page_definition;

-- 2b) Inspect the reported case_actions.assigned_to schema-cache mismatch.
-- The current assignment RPC intentionally stores assignment ownership on
-- complaints.assigned_officer_id and does not require this optional history field.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'case_actions'
order by ordinal_position;

select p.oid::regprocedure as trigger_function,
  pg_get_functiondef(p.oid) as trigger_definition
from pg_proc p
where p.oid = to_regprocedure('public.apply_case_action()');

select to_regprocedure('public.assign_complaint_officer(uuid,uuid,text)') as assignment_rpc,
case when to_regprocedure('public.assign_complaint_officer(uuid,uuid,text)') is null then null
else pg_get_functiondef(to_regprocedure('public.assign_complaint_officer(uuid,uuid,text)')) end as assignment_definition;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('complaints', 'case_relationships')
order by tablename, indexname;

-- 3) Time the actual function under an authenticated profile's claims.
-- Replace PROFILE_UUID in all three locations. SQL Editor normally runs as
-- postgres; do not SET ROLE here, because the function is SECURITY DEFINER and
-- the direct plan below should use the function owner's table-access behavior.
-- ROLLBACK clears the local JWT claim settings.
-- Run sections 3-4 only if section 2 resolves the function; otherwise apply
-- the missing migration before running function diagnostics.
begin;
set local statement_timeout = '15s';
select set_config('request.jwt.claim.sub', 'PROFILE_UUID', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"PROFILE_UUID"}',
  true
);

explain (analyze, buffers, settings, verbose)
select public.dashboard_relationship_summary();

-- 4) Explain the function's full query using the same scope logic. This exposes
-- the underlying table/index plan if the function-call plan above only shows a
-- Function Scan.
explain (analyze, buffers, settings, verbose)
with actor_profile as materialized (
  -- to_jsonb keeps this diagnostic usable before the optional column migration.
  select id, role::text as role, is_admin, active, bureau_id,
    coalesce((to_jsonb(p)->>'can_manage_bureau')::boolean, true) as can_manage_bureau
  from public.profiles p
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
);

rollback;

-- 4a) Time the paginated relationship-review RPC with no optional filters.
-- This reports total call time. If EXPLAIN only shows Function Scan, inspect the
-- function definition above and use the underlying query plan in a non-production
-- replica; do not invent indexes from this timing alone.
begin;
set local statement_timeout = '15s';
select set_config('request.jwt.claim.sub', 'PROFILE_UUID', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"PROFILE_UUID"}',
  true
);
explain (analyze, buffers, settings, verbose)
select public.dashboard_relationship_review_page(null, null, null, null, 25, 0);

-- 4b) EXPLAIN the unfiltered review-page scope/count query directly. This mirrors
-- the current 202610280001 RPC with all optional filters NULL; compare the
-- deployed definition from section 2a first. If it differs, do not treat this
-- plan as the deployed query plan. The function itself may show only Function
-- Scan in EXPLAIN, while this query exposes table/index work for that version.
explain (analyze, buffers, settings, verbose)
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
  select r.id, r.source_case_id, r.target_case_id, r.review_status, r.created_at,
    source_case.bureau_id as source_bureau_id,
    target_case.bureau_id as target_bureau_id,
    source_case.institution_id as source_institution_id,
    target_case.institution_id as target_institution_id
  from public.case_relationships r
  join visible_cases source_case on source_case.id = r.source_case_id
  join visible_cases target_case on target_case.id = r.target_case_id
  where r.review_status in ('pending', 'confirmed', 'rejected')
)
select count(*)::integer as total_count,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', page.id,
      'source_case_id', page.source_case_id,
      'target_case_id', page.target_case_id,
      'review_status', page.review_status,
      'created_at', page.created_at
    ) order by page.created_at desc, page.id desc)
    from (
      select id, source_case_id, target_case_id, review_status, created_at
      from filtered_relationships
      order by created_at desc, id desc
      limit 25 offset 0
    ) page
  ), '[]'::jsonb) as rows
from filtered_relationships;
rollback;

-- 5) Optional: inspect aggregate table scan/index counters, if permitted.
select relname, n_live_tup, seq_scan, idx_scan, last_analyze, last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
  and relname in ('complaints', 'case_relationships')
order by relname;

-- Optional pg_stat_statements timing (only if the extension is enabled and
-- the current role can read it):
-- select calls, total_exec_time, mean_exec_time, rows, query
-- from pg_stat_statements
-- where query ilike '%dashboard_relationship_summary%'
-- order by total_exec_time desc
-- limit 10;
