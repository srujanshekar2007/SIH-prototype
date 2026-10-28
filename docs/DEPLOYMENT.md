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

No live migration was applied, no Vercel settings were inspected via authenticated project access, and no deployment was initiated from this workspace.

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

1. Confirm the Vercel build logs show the Vite build and the `api/overlap/matches` function.
2. `GET https://<deployment>/api/overlap/matches` should return JSON HTTP 405, not HTML/SPA content.
3. An unauthenticated `POST` should return JSON 401. Use a protected test account for authorized POST checks; do not paste bearer tokens into tickets or logs.
4. With AI unconfigured, an authorized POST must return a clear JSON 503 and no fabricated suggestions.
5. With approved server configuration and the migration applied, test fictional complaint cases with separate role accounts and verify suggestions/review persistence while original complaint rows remain unchanged.
6. Verify Supabase Auth redirects, RLS scope, and role-specific pages in the actual deployment.

Production route status is unknown until this checklist is executed against the deployed revision. A local build does not prove production deployment.
