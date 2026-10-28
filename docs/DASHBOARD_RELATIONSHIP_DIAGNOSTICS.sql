-- Read-only diagnostics for public.dashboard_relationship_summary().
-- Run in the intended Supabase project's SQL Editor. Replace the UUID below with
-- the id of an active profile whose dashboard is experiencing the timeout.
-- No complaint or relationship rows are modified by these queries.

-- 1) Confirm the relevant migrations are recorded as applied.
select version, name
from supabase_migrations.schema_migrations
where version in ('202610270002', '202610270003')
order by version;

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
);

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
