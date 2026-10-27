# Architecture and data flow

## Runtime

- React 19 + TypeScript + Vite frontend. Supabase JS initializes from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `src/lib/supabase.ts`.
- Supabase Auth provides identity; `profiles.id` must equal the Auth UUID. Supabase RLS is the primary data boundary; profile role and bureau scope drive the UI and additional action checks.
- The local `scripts/dev.ts` starts Vite and `server/index.ts`. Vite proxies `/api` to the loopback Express server (`LOCAL_API_PORT`, default 3001). Express mounts the same handler as Vercel at `api/overlap/matches.ts`.
- Vercel serves Vite's `dist` output and deploys the root-level `api/` function. `vercel.json` sets the function runtime duration; it does not add an SPA catch-all rewrite over the API.

## Data flow

1. Browser signs in with Supabase Auth and loads its active `profiles` row plus RLS-visible complaint/workflow data in `src/App.tsx` and `src/lib/supabase.ts`.
2. Complaint actions are written through Supabase tables and SQL triggers. `case_actions` and `transfers` drive case state/history and append entries to `audit_logs`; append-only triggers block mutation of action and audit rows.
3. Rule-based overlap uses `suggest_same_institution_relationships()`: exact institution UUID, two non-null different bureau IDs, and caller visibility to both records. It is a potential-relationship cue, not text matching.
4. Optional semantic matching sends an authenticated POST to `/api/overlap/matches`. The server validates the JWT/profile, reads complaints using a JWT-bound Supabase client subject to RLS, applies action-scope checks, sends redacted subject/category/description for missing embeddings to OpenAI, computes cosine similarity, and calls a restricted SQL persistence RPC. Review decisions remain human actions.

## Database

Migrations `202610240001`–`202610240005` create/extend profiles, institutions, complaints, bureaus, action history, transfer, relationship review, coordination, notification metadata, audit, and supporting-document metadata. `202610270001_ai_semantic_overlap.sql` adds semantic metadata and a service-role-only embedding cache and RPC. Review the ordered SQL before applying. Storage object buckets/policies, seed data, historical snapshots, and a full audit browser are not provided by these migrations.

## Current ownership model

Each complaint has one primary `bureau_id` and one optional `assigned_officer_id`. A transfer changes the primary bureau and records a transfer/action; it does not create a second participating bureau. `case_relationships` connects two complaints, while `coordination_requests` are attached to a complaint and two bureaus. There is no separate multi-bureau participant table.

## AI provider

The active hosted provider is OpenAI Embeddings API, model `text-embedding-3-small`, 1536 dimensions. There is no Gemini integration and no generative summary provider in current code. See `AI_MATCHING.md` for privacy, scoring, limits, and configuration.
