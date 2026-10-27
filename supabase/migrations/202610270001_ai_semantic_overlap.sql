-- Additive semantic-suggestion metadata and private embedding cache.
-- Embeddings are derived representations only; complaint text is not copied into this table.
alter table public.case_relationships
  add column if not exists semantic_similarity double precision,
  add column if not exists semantic_model text,
  add column if not exists algorithm_version text,
  add column if not exists matching_fields text[] not null default '{}',
  add column if not exists explanation jsonb not null default '{}'::jsonb,
  add column if not exists source_text_hash text,
  add column if not exists target_text_hash text,
  add column if not exists generated_by uuid references public.profiles(id);

alter table public.case_relationships
  drop constraint if exists case_relationships_semantic_similarity_check;
alter table public.case_relationships
  add constraint case_relationships_semantic_similarity_check
  check (semantic_similarity is null or semantic_similarity between -1 and 1);

create index if not exists case_relationships_pending_similarity_idx
  on public.case_relationships(semantic_similarity desc, created_at desc)
  where review_status = 'pending' and semantic_similarity is not null;

create table if not exists public.case_text_embeddings (
  complaint_id uuid primary key references public.complaints(id) on delete cascade,
  content_hash text not null,
  model text not null,
  embedding real[] not null,
  updated_at timestamptz not null default now(),
  constraint case_text_embeddings_vector_size check (cardinality(embedding) = 1536)
);
alter table public.case_text_embeddings enable row level security;
revoke all on public.case_text_embeddings from anon, authenticated;
grant all on public.case_text_embeddings to service_role;

-- Only the authenticated, authorized Vercel endpoint may persist embeddings-derived suggestions.
-- The endpoint first loads complaints with the caller's JWT/RLS scope; this RPC independently
-- rechecks the actor, same-institution identity, cross-bureau condition and action scope.
create or replace function public.ai_actor_can_act_on_case(actor uuid, case_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((
    select p.active and (
      p.is_admin or (
        p.role in ('pgrc_officer','rb_officer','bureau_officer') and (
          (coalesce(p.can_manage_bureau, true) and c.bureau_id = p.bureau_id)
          or c.assigned_officer_id = p.id
        )
      ) or (p.role = 'bureau_officer' and c.assigned_officer_id = p.id)
    )
    from public.profiles p join public.complaints c on c.id = case_id
    where p.id = actor
  ), false)
$$;
revoke all on function public.ai_actor_can_act_on_case(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_actor_can_act_on_case(uuid, uuid) to service_role;

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
      or source_case.bureau_id = target_case.bureau_id
      or not public.ai_actor_can_act_on_case(actor, source_id)
      or not public.ai_actor_can_act_on_case(actor, target_id) then
      raise exception 'The actor is not authorized to compare this cross-bureau pair';
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

-- Add official decisions to the existing immutable audit log without changing either complaint.
create or replace function public.audit_relationship_review() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.review_status is distinct from new.review_status then
    if old.review_status <> 'pending' or new.review_status not in ('confirmed','rejected')
      or auth.uid() is null or new.reviewed_by is distinct from auth.uid() then
      raise exception 'Invalid relationship review transition';
    end if;
    insert into public.audit_logs(actor_id,entity_type,entity_id,action,details)
    values(auth.uid(),'case_relationship',new.id,'relationship_'||new.review_status,
      jsonb_build_object('source_case_id',new.source_case_id,'target_case_id',new.target_case_id,
        'semantic_similarity',new.semantic_similarity,'semantic_model',new.semantic_model,
        'review_note',new.review_note));
  end if;
  return new;
end $$;
drop trigger if exists case_relationship_review_audit on public.case_relationships;
create trigger case_relationship_review_audit
  before update on public.case_relationships
  for each row execute function public.audit_relationship_review();
