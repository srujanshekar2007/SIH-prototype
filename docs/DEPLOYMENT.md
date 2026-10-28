# Deployment guide

## Vercel configuration

- Root directory: repository root.
- Build command: `npm run build`.
- Output directory: `dist`.
- API function: root `api/overlap/matches.ts`; Vercel Functions use the `/api/...` path. `vercel.json` bounds its duration to 60 seconds. No catch-all rewrite should intercept `/api`.
- Frontend development uses a relative `/api` path proxied by Vite to local Express. Production uses the same relative path on the deployed origin; it must not point to localhost or a stale deployment URL.

Build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Server-only variables for optional AI matching: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, optional `OPENAI_EMBEDDING_MODEL`, optional `AI_SIMILARITY_THRESHOLD`, and `AI_EXTERNAL_COMPLAINT_TEXT_APPROVED`. Keep secrets out of `VITE_` variables. Configure scopes separately for Preview and Production; redeploy after changes.

## Supabase

Review and apply migrations in lexical order using an authorized operator and the intended project ref. Confirm the linked project before `supabase db push`. The semantic route requires `202610270001_ai_semantic_overlap.sql`; app login and rule matching do not require that optional migration. Auth URL allowlists must include the correct app origins. Use separate dev/test and production projects.

The user-provided SQL Editor screenshots show the selected `SIH-prototype` production project accepted `202610280001_dashboard_relationship_rpcs.sql`, then returned one JSON row from an authenticated call to `public.dashboard_relationship_summary()`. The same project initially lacked `profiles.can_manage_bureau`; `202610280002_validate_transfer_destination.sql` repairs that scope field and transfer guard but has not been verified as applied. A direct live request to `https://sih-prototype-ruddy.vercel.app/api/overlap/matches` returned JSON HTTP 405 with `Allow: POST` for GET, and JSON HTTP 401 for an unauthenticated POST. The home page returned HTTP 200. Authorized POST, provider configuration, persistence, and deployed-commit identity were not verified; no deployment was initiated from this workspace.

## Dashboard relationship summary is missing

If the dashboard reports `PGRST202` or says `public.dashboard_relationship_summary()` is missing from the schema cache, inspect the function directly; some projects do not expose a `supabase_migrations.schema_migrations` ledger. The additive repair at `supabase/migrations/202610280001_dashboard_relationship_rpcs.sql` installs the exact summary RPC expected by the frontend and adds a paginated relationship-review RPC. Its profile scope reads the optional `can_manage_bureau` flag compatibly when older project schemas do not have that column. Review and apply it to the intended project through the authorized database change process. It also sends PostgREST a schema reload notification after creating the functions.

```sql
select to_regprocedure('public.dashboard_relationship_summary()');
```

If this returns `NULL`, the function is absent. If it returns `dashboard_relationship_summary()` but PostgREST still reports PGRST202, run:

```sql
NOTIFY pgrst, 'reload schema';
```

Then retry the dashboard summary. This notification refreshes the API schema cache; it does not create the function or apply a migration.

## Verification checklist

1. Confirm the Vercel build logs show the Vite build and the `api/overlap/matches` function after deploying the reviewed working tree.
2. `GET https://<deployment>/api/overlap/matches` should return JSON HTTP 405, not HTML/SPA content.
3. An unauthenticated `POST` should return JSON 401. Use a protected test account for authorized POST checks; do not paste bearer tokens into tickets or logs.
4. With AI unconfigured, an authorized POST must return a clear JSON 503 and no fabricated suggestions.
5. With approved server configuration and the migration applied, test fictional complaint cases with separate role accounts and verify suggestions/review persistence while original complaint rows remain unchanged.
6. Verify Supabase Auth redirects, RLS scope, and role-specific pages in the actual deployment.

The deployed route's method guard and unauthenticated response have been verified. Authorized POST behavior and the currently deployed commit remain unverified; a local build does not prove the changed working tree is deployed.

## Additional reviewed migrations

- `202610280002_validate_transfer_destination.sql` adds the missing nullable `profiles.can_manage_bureau` field with a false default for new profiles, repairs its helper while preserving legacy NULL behavior, and requires transfers/escalations to target a different active configured Bureau/Cell. Review and apply after confirming the live migration state.
- `202610280003_private_supporting_documents.sql` creates/configures a private case-scoped Storage bucket, insert/read policies, metadata checks, and an upload audit event. Apply only if private evidence storage is intended and approved. It does not create demo files or enable public access.
