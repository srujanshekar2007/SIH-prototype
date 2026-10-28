# Security model and limits

## Identity and authorization

- Supabase Auth supplies the identity. The application requires an active `profiles` row keyed to the Auth user UUID.
- Database RLS uses helpers such as `is_admin()`, `current_role()`, `current_bureau()`, `can_access_case()`, and `can_act_on_case()`. Bureau managers and assigned officers have different scopes; administrators require the designated admin flag.
- Semantic matching validates the bearer token and active profile, fetches complaints with the caller JWT (RLS), checks action scope, and the persistence RPC independently checks actor permission and same-institution/different-bureau constraints.
- Profile provisioning is a trusted manual operation. Public registration and client-side role selection are absent.
- Action/transfer triggers create audit entries; `case_actions` and `audit_logs` are append-only. Audit reading is admin-only, but the UI currently shows only a recent summary rather than a searchable audit browser.

## Secrets

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are public client configuration; RLS must protect data. `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` are server-only and must never be exposed through `VITE_` variables or committed files. Do not print credentials in issues or logs.

## External processing

When semantic matching is explicitly enabled, the function sends subject/category/description text after heuristic redaction of common labeled names/IDs/contact details and general email/phone patterns. Heuristic redaction is not anonymization and can miss personal/sensitive information. Data-owner approval and applicable processor/retention policy are prerequisites. The server does not select institution names/IDs, action history, or supporting-document data for the model request. Raw complaint text is not copied into the embedding cache; vectors and content hashes are retained in a table inaccessible to anon/authenticated roles.

## Known security gaps requiring review

- Private case-scoped upload/download code and migration `202610280003_private_supporting_documents.sql` are present, but the migration is not live-verified. Until applied and tested with actual role accounts, do not upload real evidence. The flow allows PDF/JPEG/PNG up to 10 MiB, uses signed downloads, audits uploads, and has no deletion UI. Malware scanning is not implemented.
- No in-app account provisioning. Use a trusted administrator process; do not enable public signup or self-assigned roles.
- No independent production security review or live RLS test has been performed from this workspace.
- Audit UI and audit event coverage are limited to implemented SQL triggers and an admin recent-events summary; verify coverage against operational policy.
- API uses a service-role key for the private embedding cache and restricted persistence RPC only after checks. This remains privileged server code and should receive code review and secret rotation controls.
- Existing database migrations have not been applied to a live Supabase project here.

Report suspected issues without including case text or credentials.
