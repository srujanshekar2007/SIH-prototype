# SIH26264 · AICTE Complaint Monitoring Prototype

An administrative monitoring prototype for authorized officials tracking institution-related complaints. It is not an official AICTE deployment and is not connected to live AICTE systems.

## Repository audit

The supplied workspace contained no source files, package configuration, existing UI, authentication implementation, or migrations. The project was bootstrapped with Vite, React, TypeScript, Supabase JS, Recharts, and Lucide icons. No existing data was found, and no seed data or accounts have been created.

## Implemented

- Supabase Auth email/password sign-in; no public registration or role picker.
- Supabase-backed dashboard, case registry/search/status filter, institution directory/profile, overlap review queue, alerts derived from recorded next-action dates, reports, and formula-safe CSV export.
- Case status/action history and transfer/escalation writes backed by append-only action/audit triggers.
- Protected role-aware navigation and RLS-oriented schema for profiles, bureaus, institutions, complaints, assignments via case ownership fields, actions, transfers, relationships, coordination, notifications, audit events, and document metadata.
- Responsive navy-sidebar administrative interface, status charts, empty/error/loading states, touch-sized mobile navigation, keyboard focus, and reduced-motion support.
- Website Help Assistant is local deterministic FAQ matching. It has no Supabase import, network, API endpoint, case context, or persistence. Confidential requests get the required refusal; unrelated requests receive the required fallback.

## Local setup

Prerequisites: Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
cp .env.example .env.local
# Set the two values below in .env.local
npm run dev
```

Required environment variables:

- `VITE_SUPABASE_URL` — Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` — publishable/anon key. Never put a service-role key in a `VITE_` variable.

The app intentionally shows a configuration notice and does not show fabricated records when these values are absent.

## Supabase setup

1. Create or select a Supabase project and configure the allowed local/deployed redirect URLs in Auth settings.
2. Create official accounts through an authorized Supabase Auth administrator process; public signup is not implemented. No initial credentials are supplied or generated.
3. Review `supabase/migrations/202610240001_initial_schema.sql` against your project, then apply it with the Supabase CLI (`supabase link`, `supabase db push`) or the SQL editor.
4. Add reviewed Bureau/Cell rows and provision each user's `profiles` row using a trusted administrator SQL/editor process. Set roles only from `aicte_official`, `pgrc_officer`, `rb_officer`, `administrator`. PGRC/RB roles require a matching bureau UUID. The migration does not create institutions, cases, accounts, or bureau rows.
5. Apply `.env.local` values and restart Vite. Confirm data access using accounts with each intended role before deployment.

The migration is additive and creates tables, indexes, functions, triggers, and RLS policies. It does not drop application records. Review it before applying to a project with pre-existing objects. Storage buckets are not created; document table entries alone do not grant access to a Storage object. Configure a private bucket and matching Storage policies before enabling document upload/download.

## Commands

```sh
npm run dev        # local development
npm test           # local website-help assistant tests
npm run typecheck  # TypeScript check
npm run build      # typecheck + production bundle
npm run preview    # preview production bundle
```

## Security notes and limitations

- Supabase RLS is the authorization boundary. Client UI checks only hide irrelevant navigation. Do not use the service-role key in this client.
- Auth roles/profile rows must be provisioned by an administrator. This repo does not include a privileged provisioning server/Edge Function, account deactivation UI, or public signup.
- The current migration models one handling bureau and assigned officer per complaint. Additional bureau/cell names are configurable data, but historical multi-assignment memberships and granular case sharing need a reviewed extension.
- Relationship suggestions are not generated automatically yet. The review UI accepts only already stored, authorized suggestions; no confidence score or synthetic evidence is shown.
- Coordination request creation is wired; responses and a persistent coordination inbox are not yet implemented. Deadline rules use each record's `next_action_at`; no official SLA is assumed. Notifications, Storage, date-range filters, pagination, and a full audit browser need further implementation.
- AI case summarization is not included. No external AI service is called.
- No connected Supabase project was configured here, so live authentication, RLS behavior, and database writes cannot be verified from this workspace alone.

## Deployment

Build with `npm run build` and deploy the `dist/` directory to a static host configured to serve `index.html` for client-side routes. Supply only the Supabase URL and publishable anon key through the host's build environment. Configure Auth redirect URLs and enforce HTTPS. Review RLS policies and test all roles in the target Supabase project before real records are entered.
