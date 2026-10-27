-- dashboard_relationship_summary joins pending relationships to authorized cases by
-- target_case_id. The existing unique(source_case_id, target_case_id) index supports
-- the source-side join, while relationships_queue_idx supports pending status/order;
-- neither provides a target_case_id lookup path.
create index if not exists case_relationships_pending_target_idx
  on public.case_relationships(target_case_id)
  where review_status = 'pending';
