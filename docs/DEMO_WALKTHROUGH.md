# SIH26264 demonstration walkthrough

This walkthrough uses only configured Supabase records visible to the signed-in role. The application is a prototype, not an official AICTE service. Do not use real complainant records for an unapproved demonstration.

## Before the demonstration

1. Use a dedicated non-production Supabase project and provision a test Auth user plus an active matching `profiles` row through the trusted administrator process.
2. Configure the intended bureau/cell and institution records. No seed script or demo accounts are provided by this repository.
3. Apply and verify the reviewed migrations for the features you plan to show. The dashboard relationship summary was verified against the selected production project by user-provided SQL Editor evidence; the new transfer and document migrations remain unapplied.
4. Start the app with `.env.local` configured and run `npm run dev`. For semantic matching, configure server-only provider/database settings and enable `AI_EXTERNAL_COMPLAINT_TEXT_APPROVED=true` only after data-owner approval.

## Demonstration sequence

1. **Sign in and verify role scope.** Use a provisioned account. Show that the dashboard and case list reflect its authorized records. Live cross-role access has not been tested from this workspace.
2. **Find an institution.** Search by institution name, AICTE Permanent ID, internal identifier, or region. Open its profile to review authorized cases, bureau, current officer, latest action and recorded deadlines.
3. **Inspect a complaint.** Open a case to view its recorded description, current status, ownership, deadlines and action history. If the private-document migration has been applied, show the supporting-document upload/download controls.
4. **Record workflow.** Use the case actions to record a status update or assignment. Transfers/escalations require migration `202610280002_validate_transfer_destination.sql` and a configured active destination bureau.
5. **Review relationship suggestions.** Generate rule-based suggestions using exact institution identity across different bureaus. These are review cues, not duplicate findings.
6. **Optionally run semantic matching.** Only after external processing is approved, accept the in-app disclosure and use fictional complaint text. The model score is raw cosine similarity, not a probability; provider configuration and live persistence remain unverified here.
7. **Record a human decision.** Confirm or reject a pending relationship and optionally add a note. Confirmations do not merge or change complaint records.
8. **Show history and deadlines.** Review case actions, the limited recent admin audit summary, and date-based overdue alerts. The app does not claim an official SLA or complete searchable audit browser.
9. **Show dashboard and reports.** Explain that the potential-relationship KPI uses the database summary and stays unavailable on error. Export currently includes the authorized records loaded by the app and respects report filters.

No fictional records, users, documents, or AI evaluation results are supplied or inserted by this repository.
