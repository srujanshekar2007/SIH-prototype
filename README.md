# SIH26264 · AICTE Complaint Monitoring Prototype

An administrative monitoring prototype for authorized officials tracking institution-related complaints. It is not an official AICTE deployment and is not connected to live AICTE systems.

## Repository audit

The supplied workspace contained no source files, package configuration, existing UI, authentication implementation, or migrations. The project was bootstrapped with Vite, React, TypeScript, Supabase JS, Recharts, and Lucide icons. No existing data was found, and no seed data or accounts have been created.

## Implemented

- Supabase Auth email/password sign-in; no public registration or role picker.
- Supabase-backed dashboard, case registry/search/status filter, institution directory/profile, overlap review queue, alerts derived from recorded next-action dates, reports, and formula-safe CSV export.
- Case status/action history and transfer/escalation writes backed by append-only action/audit triggers.
- Role-specific dashboards: designated administrators (`is_admin`), Bureau/Cell managers (`can_manage_bureau`), assigned individual officers, and read-only AICTE oversight. Counts/charts use RLS-visible records; individual officer case visibility is assignment-scoped.
- Bureau-scoped officer workload, auditable assignment/reassignment events, authorized transfers, coordination requests/responses, overlap review, role-limited actions, and administrator-only audit summaries.
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
3. Review `supabase/migrations/202610240001_initial_schema.sql` and `supabase/migrations/202610240002_role_dashboard_scope.sql` against your project, then apply them with the Supabase CLI (`supabase link`, `supabase db push`) or the SQL editor.
4. Add reviewed Bureau/Cell rows and provision each user's `profiles` row using a trusted administrator SQL/editor process. Set roles only from `aicte_official`, `pgrc_officer`, `rb_officer`, `administrator`. PGRC/RB roles require a matching bureau UUID. `can_manage_bureau` is false by default for new profiles; set it true only for an explicitly authorized Bureau/Cell manager. The migration does not create institutions, cases, accounts, or bureau rows.
5. Apply `.env.local` values and restart Vite. Confirm data access using accounts with each intended role before deployment.

Both migrations are additive and create tables, indexes, functions, triggers, policies, or one profile permission column. The role-scope migration does not update existing profile rows or drop application records. Existing PGRC/RB profiles have a null new permission and retain their former Bureau-wide scope; a trusted administrator may explicitly set the flag true for a manager or false for an individual officer. New profiles default to individual-officer scope. The migration restricts complaint changes to audited workflow triggers and adds the `assigned_to` action-history field. Review it before applying to a project with pre-existing objects. Storage buckets are not created; document table entries alone do not grant access to a Storage object. Configure a private bucket and matching Storage policies before enabling document upload/download.

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
- Overlap suggestions can be generated on request from accessible cross-Bureau cases sharing an institution record. This is identity evidence only, not a claim that the complaints are duplicates; human review is required.
- Coordination request creation and responses are wired for authorized participants. There is no configurable approaching-deadline window, expected-disposal date, or historical backlog snapshot; those metrics are not fabricated. `next_action_at` is presented as a past next-action date. The app has no persistent notification center, document Storage setup, date-range filters, or full audit browser.
- AI case summarization is not included. No external AI service is called.
- No connected Supabase project or role-specific accounts were available, so the migrations have not been applied and live authentication, RLS, and workflow writes could not be verified here. The role and scope helpers have unit coverage.

## Deployment

Build with `npm run build` and deploy the `dist/` directory to a static host configured to serve `index.html` for client-side routes. Supply only the Supabase URL and publishable anon key through the host's build environment. Configure Auth redirect URLs and enforce HTTPS. Review RLS policies and test all roles in the target Supabase project before real records are entered.
