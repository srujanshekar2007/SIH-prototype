-- Private, case-scoped evidence storage. Existing metadata is retained; no files
-- or complaint records are created by this migration.
alter table public.supporting_documents
  add column if not exists file_size_bytes bigint;

drop policy if exists documents_insert_case on public.supporting_documents;
create policy documents_insert_case
  on public.supporting_documents for insert to authenticated
  with check (public.can_act_on_case(complaint_id) and uploaded_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-supporting-documents',
  'case-supporting-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists case_supporting_documents_read on storage.objects;
create policy case_supporting_documents_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'case-supporting-documents'
    and exists (
      select 1 from public.complaints c
      where c.id::text = (storage.foldername(name))[1]
        and public.can_access_case(c.id)
    )
  );

drop policy if exists case_supporting_documents_insert on storage.objects;
create policy case_supporting_documents_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'case-supporting-documents'
    and exists (
      select 1 from public.complaints c
      where c.id::text = (storage.foldername(name))[1]
        and public.can_act_on_case(c.id)
    )
  );

-- Permit best-effort cleanup only for authorized objects that never acquired a
-- metadata row. Completed evidence cannot be deleted through this policy.
drop policy if exists case_supporting_documents_cleanup_orphan on storage.objects;
create policy case_supporting_documents_cleanup_orphan
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'case-supporting-documents'
    and exists (
      select 1 from public.complaints c
      where c.id::text = (storage.foldername(name))[1]
        and public.can_act_on_case(c.id)
    )
    and not exists (
      select 1 from public.supporting_documents d
      where d.storage_path = name
    )
  );

create or replace function public.audit_supporting_document_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, entity_type, entity_id, action, details)
  values (
    auth.uid(), 'supporting_document', new.id, 'document_uploaded',
    jsonb_build_object('complaint_id', new.complaint_id, 'mime_type', new.mime_type,
      'file_size_bytes', new.file_size_bytes)
  );
  return new;
end
$$;
drop trigger if exists supporting_document_upload_audit on public.supporting_documents;
create trigger supporting_document_upload_audit
  after insert on public.supporting_documents
  for each row execute function public.audit_supporting_document_upload();

create or replace function public.validate_supporting_document_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.uploaded_by is distinct from auth.uid()
    or new.file_size_bytes is null or new.file_size_bytes < 1 or new.file_size_bytes > 10485760
    or new.mime_type is null
    or new.mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or length(new.file_name) > 255
    or (storage.foldername(new.storage_path))[1] is distinct from new.complaint_id::text
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'case-supporting-documents' and o.name = new.storage_path
    ) then
    raise exception 'Supporting document metadata does not match an authorized private upload';
  end if;
  return new;
end
$$;
drop trigger if exists supporting_document_metadata_validate on public.supporting_documents;
create trigger supporting_document_metadata_validate
  before insert on public.supporting_documents
  for each row execute function public.validate_supporting_document_metadata();
