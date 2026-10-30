-- Expand the existing server-only suggestion RPC so semantic candidates can be
-- reviewed within one Bureau/Cell as well as across Bureaus/Cells. Institution
-- identity and per-case authorization remain mandatory. Complaints are untouched.
create or replace function public.persist_ai_relationship_suggestions(actor uuid, suggestions jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare
  item jsonb;
  source_id uuid;
  target_id uuid;
  source_case public.complaints%rowtype;
  target_case public.complaints%rowtype;
  score double precision;
  inserted_or_updated integer := 0;
  threshold_insert boolean;
begin
  if auth.role() <> 'service_role' or actor is null then
    raise exception 'AI relationship persistence is server-only';
  end if;
  if jsonb_typeof(suggestions) <> 'array' or jsonb_array_length(suggestions) > 25000 then
    raise exception 'Invalid suggestion batch';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id=actor and p.active
      and (p.is_admin or p.role in ('pgrc_officer','rb_officer','bureau_officer'))
  ) then raise exception 'An active workflow official is required'; end if;

  for item in select value from jsonb_array_elements(suggestions) loop
    source_id := (item->>'source_case_id')::uuid;
    target_id := (item->>'target_case_id')::uuid;
    score := (item->>'semantic_similarity')::double precision;
    threshold_insert := coalesce((item->>'should_insert')::boolean, false);
    if source_id = target_id or score is null or score < -1 or score > 1 then
      raise exception 'Invalid semantic relationship candidate';
    end if;
    select * into source_case from public.complaints where id=source_id;
    select * into target_case from public.complaints where id=target_id;
    if source_case.id is null or target_case.id is null
      or source_case.institution_id is distinct from target_case.institution_id
      or source_case.bureau_id is null or target_case.bureau_id is null
      or not public.ai_actor_can_act_on_case(actor, source_id)
      or not public.ai_actor_can_act_on_case(actor, target_id) then
      raise exception 'The actor is not authorized to compare this same-institution pair';
    end if;

    update public.case_relationships set
      relationship_type='same_institution_review',
      match_reasons=array(select jsonb_array_elements_text(item->'match_reasons')),
      semantic_similarity=score,
      semantic_model=item->>'semantic_model',
      algorithm_version=item->>'algorithm_version',
      matching_fields=array(select jsonb_array_elements_text(item->'matching_fields')),
      explanation=coalesce(item->'explanation','{}'::jsonb),
      source_text_hash=item->>'source_text_hash',
      target_text_hash=item->>'target_text_hash',
      generated_by=actor
    where source_case_id=source_id and target_case_id=target_id and review_status='pending';
    if found then
      inserted_or_updated := inserted_or_updated + 1;
    elsif threshold_insert then
      insert into public.case_relationships(
        source_case_id,target_case_id,relationship_type,match_reasons,semantic_similarity,
        semantic_model,algorithm_version,matching_fields,explanation,source_text_hash,target_text_hash,generated_by
      ) values (
        source_id,target_id,'same_institution_review',
        array(select jsonb_array_elements_text(item->'match_reasons')),
        score,item->>'semantic_model',item->>'algorithm_version',
        array(select jsonb_array_elements_text(item->'matching_fields')),
        coalesce(item->'explanation','{}'::jsonb),item->>'source_text_hash',item->>'target_text_hash',actor
      ) on conflict(source_case_id,target_case_id) do nothing;
      if found then inserted_or_updated := inserted_or_updated + 1; end if;
    end if;
  end loop;
  return inserted_or_updated;
end
$$;

revoke all on function public.persist_ai_relationship_suggestions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persist_ai_relationship_suggestions(uuid, jsonb) to service_role;
