# Testing and verification

## Commands

| Command | Purpose | Current recorded result |
|---|---|---|
| `npm test` | Vitest unit and API-contract tests | 86 tests passed across 16 files (2026-10-28 local run) |
| `npm run typecheck` | Frontend and server TypeScript checks | Passed (2026-10-28 local run) |
| `npm run build` | Typecheck and Vite production build | Passed; Vite emitted `dist/` (2026-10-28 local run) |
| `npm run lint` | Not configured | Not available |

## Test coverage and limits

Tests cover semantic candidate boundaries, privacy redaction, cosine and embedding validation, provider timeout/rate-limit mapping, endpoint auth/configuration gates, missing optional profile-column fallback, malformed/oversized local API JSON, frontend response-contract handling, relationship pagination/review helpers, document path/type/size validation, notification date calculations, and selected application behavior. They are local tests with mocked dependencies. They do not establish actual Supabase RLS, SQL trigger behavior, OpenAI account configuration, Vercel function deployment, real role accounts, browser workflows, Storage policies, or delivered email/SMS. User-provided SQL Editor evidence confirms the dashboard summary RPC returned a row on the selected live project; it does not verify the remaining SQL behavior.

The current source changes are on a machine-local working tree; the live Vercel version and database were not verified by these commands. For external verification, follow `MANUAL_SETUP.md` and `DEPLOYMENT.md` using a development Supabase project and fictional records.
