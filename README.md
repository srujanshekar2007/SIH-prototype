# SIH26264 · AICTE Complaint Monitoring Prototype

An administrative prototype for authorized officials to track institution-related complaints, coordinate bureau workflows, review potential cross-bureau relationships, and monitor recorded deadlines. It is not an official AICTE deployment and is not connected to live AICTE systems.

## Current capabilities

- Supabase Auth email/password login, public self-registration, email verification, password recovery, and a database-triggered least-privilege `public_user` profile. See [authentication setup](docs/AUTHENTICATION.md); its migrations are not yet applied to production.
- Role-scoped dashboard, complaint registry, institution records, workflow/action history, transfers/escalations, coordination requests, overlap review, alerts, reports, and CSV export.
- Case-scoped supporting-document upload and short-lived signed download are implemented behind the optional private-storage migration; do not use until that migration and role checks are verified in the target project.
- Rule-based relationship suggestions use shared institution records and cross-bureau cases as a review cue. This does not determine that complaints are duplicates.
- Optional server-side semantic suggestions use OpenAI `text-embedding-3-small` or the separate CaseGraph MiniLM service when configured. Similarity is raw cosine similarity, and every suggestion requires human review.
- Website Help Assistant is deterministic local FAQ matching; it does not use a generative AI provider or complaint data.

## Local development

Requirements: Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
cp .env.example .env.local
# Set the client-safe Supabase URL and publishable key in .env.local.
npm run dev
```

`npm run dev` runs Vite and a loopback-only API server. The browser posts to `/api/overlap/matches`; Vite proxies that path to the local server, which invokes the same handler used by Vercel. The API server needs Supabase and AI secrets only to perform semantic matching. Ordinary app sign-in and rule-based matching use Supabase client configuration.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

There is no lint script configured in `package.json`.

## Setup and deployment

See [MANUAL_SETUP.md](MANUAL_SETUP.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md), and [docs/DEMO_WALKTHROUGH.md](docs/DEMO_WALKTHROUGH.md). Database migrations are in `supabase/migrations/` and must be reviewed/applied to the intended Supabase project in order. The dashboard RPC was manually applied and verified through user-provided SQL Editor evidence; no seed, deployment, or account provisioning is performed by this repository's local development command.

## Security and AI matching

See [docs/SECURITY.md](docs/SECURITY.md) and [docs/AI_MATCHING.md](docs/AI_MATCHING.md). Semantic matching sends subject, category, and description for uncached complaints to OpenAI only when server secrets, the administrator approval flag, and the user's per-run disclosure are all present. Pattern redaction is best effort, not anonymization; the data owner must approve the processor and policy before enabling this feature.
