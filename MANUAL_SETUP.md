# Manual setup checklist

The latest user-provided SQL Editor screenshots show `202610280001_dashboard_relationship_rpcs.sql` was run against the selected `SIH-prototype` production project and `public.dashboard_relationship_summary()` returned one JSON row under the supplied active profile UUID. This does not verify the other migrations, queue RPC, RLS across roles, Storage, or Vercel. Use a dedicated development Supabase project for remaining setup and testing.

## 1. Local app configuration (required)

1. In Supabase Dashboard, select the intended development project and copy its **Project URL** and **publishable/anon key** from Project Settings → API.
2. Copy `.env.example` to `.env.local` in the repository root. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These are browser-visible values; never use a service-role/secret key for either.
3. Run `npm install`, then `npm run dev`. Sign-in remains unavailable until an Auth user and matching `public.profiles` row have been provisioned.
4. Add local and deployed app origins under Authentication → URL Configuration → Redirect URLs before password reset is tested. Exact production origin depends on the Vercel deployment URL.

## 2. Database (required)

1. Review all SQL under `supabase/migrations/` against the target project's current schema and take a database backup according to your organization's process.
2. Apply the migrations in lexical order using the authorized project workflow: `202610240001_initial_schema.sql`, `202610240002_role_dashboard_scope.sql`, `202610240003_expected_disposal_date.sql`, `202610240004_add_bureau_officer_role.sql`, `202610240005_scope_bureau_officer_role.sql`, `202610270001_ai_semantic_overlap.sql`, `202610270002_action_schema_and_relationship_summary.sql`, `202610270003_pending_relationship_target_index.sql`, `202610280001_dashboard_relationship_rpcs.sql`, `202610280002_validate_transfer_destination.sql`, and `202610280003_private_supporting_documents.sql`.
3. The user-provided SQL Editor evidence verifies the dashboard summary RPC from `202610280001`; it also showed `profiles.can_manage_bureau` was absent. Apply `202610280002_validate_transfer_destination.sql` after review to add the nullable scope column with a false default for new profiles while preserving NULL on existing profiles, repair the helper, and validate transfer destinations.
4. `202610280003_private_supporting_documents.sql` is needed only if enabling private file upload/download. It creates or configures the private bucket and case-scoped policies; do not apply it until the project uses Supabase Storage and the database change is approved.
5. Verify required tables, columns, functions, grants, RLS policies, and indexes with read-only SQL. Some projects do not have an exposed `supabase_migrations.schema_migrations` ledger; do not assume it exists.
6. Create bureau rows and fictitious demo rows only in a verified development project. No reproducible demo seed script is included; do not repurpose production records as a demo dataset.

No migration is applied automatically by `npm run dev`. The dashboard summary function call has been verified in the selected live Supabase project from user-provided SQL Editor evidence; the rest of the live schema and real-role behavior remain unverified.

## 3. User provisioning (required)

1. In Supabase Dashboard → Authentication → Users, create an invited/provisioned user using the organization's approved account process; do not enable public signup.
2. Have a trusted database administrator insert the matching profile row with `profiles.id` equal to the Auth user's UUID. Assign only an approved role and bureau scope. `administrator` must be paired with `is_admin=true`; bureau roles require an existing bureau. Never allow the user to set their own role.
3. Sign in with that user's issued credentials and verify only the expected scope is visible. Do not store credentials in the repository.

There is no in-app privileged account-provisioning workflow or seed administrator.

## 4. Optional semantic AI matching

Requires data-owner approval for external processing, a reviewed OpenAI account/key, and the semantic migration.

1. Set `OPENAI_API_KEY` as a **server-only** secret in `.env.local` for local API use and in Vercel Project → Settings → Environment Variables for the intended deployment environments. Never prefix it with `VITE_`.
2. Set server-side `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the same environments. The service-role key must be kept server-only; it is used after JWT/profile checks for the restricted cache and persistence RPC.
3. Set `AI_EXTERNAL_COMPLAINT_TEXT_APPROVED=true` only after the data owner approves sending redacted subject/category/description text to OpenAI. A signed-in official must also accept the per-run disclosure in the UI.
4. Optionally set `OPENAI_EMBEDDING_MODEL` (must return 1536 dimensions for this migration) and `AI_SIMILARITY_THRESHOLD` (0–1, default 0.78). Redeploy Vercel after changing production variables.
5. Verify in a non-production project with fictional text, authorized role accounts, and the API checks described in `docs/AI_MATCHING.md`. Missing credentials or migration should produce an explicit error; do not treat this as successful configuration.

## 5. Private supporting documents (optional; only after migration)

1. Review and apply `supabase/migrations/202610280003_private_supporting_documents.sql` to the intended development project first.
2. In Supabase Storage, verify bucket `case-supporting-documents` is private, has a 10 MiB size cap, and allows only PDF, JPEG, and PNG.
3. Sign in as an authorized case worker, upload a fictional allowed file, and verify the case detail lists it and opens via a short-lived signed URL. Try a read-only/out-of-scope account and verify it cannot upload, list, or open the object.
4. The UI intentionally has no delete action; document retention/deletion policy needs an authorized business decision before adding one.

## 6. Vercel deployment (required for hosted app)

1. Review the working-tree diff and push only after approval; no commit or push was made by this work.
2. In Vercel Project Settings → Git, confirm the intended repository and production branch. Under Build & Development Settings, confirm root directory is the repository root, build command is `npm run build`, and output directory is `dist`.
3. Confirm the root-level `api/overlap/matches.ts` function is included. Configure the environment variables above for the right Preview/Production scopes.
4. Deploy, then verify `/api/overlap/matches` responds with JSON `405` to GET (expected method guard) and valid authenticated POST behavior using an approved test account. A Vite build alone does not verify function deployment.
5. Confirm the production URL and Supabase Auth redirect allowlist; test a role-scoped login, rule-based suggestions, and—only if approved/configured—semantic matching.

## Missing external inputs and verification

- An authorized operator to apply and verify the remaining reviewed migrations, especially `202610280002_validate_transfer_destination.sql`; the selected production project did verify the dashboard summary RPC.
- Approved role accounts and bureau identifiers for scope testing.
- Data-owner decision on external complaint-text processing, and provider credentials if approved.
- Vercel project access and the deployed Git revision for production route verification.
- A reviewed, idempotent fictional demo seed design. The current repo does not include one.
