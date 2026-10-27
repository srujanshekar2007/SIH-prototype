# Implementation status and handoff

Status reflects repository inspection and local checks on 2026-10-27. It is not a production certification.

| Area | Status | Notes |
|---|---|---|
| 1. Complaint, institution, workflow UI | IMPLEMENTED BUT NOT FULLY TESTED | Existing pages and Supabase queries are present; no full browser/role E2E run. |
| 2. API endpoint and local/prod routing | IMPLEMENTED BUT NOT FULLY TESTED | Shared authenticated handler at `api/overlap/matches.ts`; local Vite proxy and root Vercel function config exist. Live Vercel route not verified. |
| 3. Hosted AI provider | CONFIGURATION REQUIRED | OpenAI embeddings code exists; key, migration, and data-owner approval are required. No Gemini or generative summary integration exists. |
| 4. Semantic suggestions and review | IMPLEMENTED BUT NOT FULLY TESTED | Institution-gated cross-bureau cosine suggestions and human review; local tests pass; live RPC/RLS not tested. |
| 5. Auth, role boundaries, RLS | IMPLEMENTED BUT NOT FULLY TESTED | SQL policies/helpers and server checks exist; apply migrations and test with real role accounts before production. |
| 6. Reproducible fictional demo dataset | NOT IMPLEMENTED | No safe idempotent seed script or local demo accounts are supplied. No records were generated or inserted. |
| 7. Multi-bureau participation | NOT IMPLEMENTED | Each complaint has one primary bureau/officer. Related cases and coordination requests exist; no secondary-participant table. |
| 8. Alerts/deadlines/notifications | IMPLEMENTED BUT NOT FULLY TESTED | Client derives overdue/due-soon from recorded dates. No SLA policy, scheduler, email/SMS delivery, or persistent notification center is claimed. |
| 9. Supporting document storage | NOT IMPLEMENTED | Metadata table only; private Storage bucket/policies/upload/download flow absent. |
| 10. Audit browser and historical snapshots | IMPLEMENTED BUT NOT FULLY TESTED | Trigger-backed append-only audit records and a limited admin recent summary exist; full searchable browser and trustworthy historical backlog snapshots are absent. |
| Typecheck, tests, build | IMPLEMENTED AND TESTED LOCALLY | `npm test` 50/50, `npm run typecheck`, and `npm run build` passed. No lint script exists. |
| Live Supabase migration/configuration | BLOCKED BY EXTERNAL ACCESS | No authenticated project access/verified project ref; migrations were not applied. |
| Production deployment verification | DEPLOYMENT REQUIRED | No Vercel project access or deployment was used. Push/deploy current reviewed revision, then test API route. |

## Change control

Branch: `main`. Base commit: `64372f4 Update frontend UI`. The repository already contained uncommitted code changes before this assignment; they were preserved. No commit or push was made. Review `git status` and the diff before creating a commit.
