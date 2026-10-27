# Manual setup checklist

This repository has not been connected to, migrated on, seeded in, or deployed to a live project by this local work. Use a dedicated development Supabase project first.

## 1. Local app configuration (required)

1. In Supabase Dashboard, select the intended development project and copy its **Project URL** and **publishable/anon key** from Project Settings → API.
2. Copy `.env.example` to `.env.local` in the repository root. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These are browser-visible values; never use a service-role/secret key for either.
3. Run `npm install`, then `npm run dev`. Sign-in remains unavailable until an Auth user and matching `public.profiles` row have been provisioned.
4. Add local and deployed app origins under Authentication → URL Configuration → Redirect URLs before password reset is tested. Exact production origin depends on the Vercel deployment URL.

## 2. Database (required)

1. Review all SQL under `supabase/migrations/` against the target project's current schema and take a database backup according to your organization's process.
2. Authenticate the Supabase CLI as an authorized operator; run `supabase link --project-ref <development-project-ref>` and `supabase db push` only after confirming the linked project. Apply migrations in lexical order.
3. Verify the migration history and inspect Tables/Policies/Functions in Supabase Dashboard. The final migration `202610270001_ai_semantic_overlap.sql` is needed only for semantic matching.
4. Create bureau rows and fictitious demo rows through an explicitly designed development seed process. No reproducible seed script is currently included; do not repurpose production records as a demo dataset.

No migration is applied automatically by `npm run dev`, and this workspace has no verified live database connection.

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

## 5. Vercel deployment (required for hosted app)

1. Push the reviewed branch to the configured GitHub repository only when ready; no commit or push was made by this work.
2. In Vercel Project Settings → Git, confirm the intended repository and production branch. Under Build & Development Settings, confirm root directory is the repository root, build command is `npm run build`, and output directory is `dist`.
3. Confirm the root-level `api/overlap/matches.ts` function is included. Configure the environment variables above for the right Preview/Production scopes.
4. Deploy, then verify `/api/overlap/matches` responds with JSON `405` to GET (expected method guard) and valid authenticated POST behavior using an approved test account. A Vite build alone does not verify function deployment.
5. Confirm the production URL and Supabase Auth redirect allowlist; test a role-scoped login, rule-based suggestions, and—only if approved/configured—semantic matching.

## Missing external inputs

- A confirmed Supabase development project/ref and an authorized operator to apply reviewed migrations.
- Approved role accounts and bureau identifiers for scope testing.
- Data-owner decision on external complaint-text processing, and provider credentials if approved.
- Vercel project access and the deployed Git revision for production route verification.
- A reviewed, idempotent fictional demo seed design. The current repo does not include one.
