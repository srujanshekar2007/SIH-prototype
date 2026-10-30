# Role-based verification matrix

Use a dedicated non-production Supabase project. `profiles.id` must match the Auth UUID. Public signup may be tested only after reviewing and applying migrations `202610310002` and `202610310003` in that test project; it must always provision `public_user`. Never grant roles from the browser. This is a planned manual test matrix, not evidence that live role tests have been run.

| Profile | Intended scope from current code | Read checks | Mutation checks |
|---|---|---|---|
| Administrator (`is_admin = true`) | Organization-wide authorized records; administrator-only management/audit functions | Can view all authorized complaints, institutions, transfers, audit summary and relationship queue | Can create cases, assign within configured rules, record actions, transfer to an active destination, review relationships, and run matching if server/data-owner gates are configured |
| Bureau manager (`pgrc_officer`, `rb_officer`, or `bureau_officer`; `can_manage_bureau = true` or legacy NULL) | Own bureau cases plus cases assigned to the user; related transfer/coordination visibility per RLS | Can read in-scope cases, bureau records and associated history | Can perform allowed in-scope actions; only managers can assign; target officer must be active and in the case bureau |
| Individual officer (bureau role; `can_manage_bureau = false`) | Cases assigned to that officer | Must not see unassigned peer cases or other bureaus' case text | Can act on assigned cases where policy permits; must not assign officers or alter profile scope |
| AICTE oversight (`aicte_official`, non-admin) | Organization-wide read access | Can read authorized records and relationship summaries | Must be denied assignment, transfer/escalation, relationship decisions, rule generation and AI generation |

## Manual execution

1. Create one account per role in Supabase Authentication → Users using the approved provisioning process; record each Auth UUID.
2. Have a trusted administrator create matching `profiles` rows and assign existing bureau IDs. Set `is_admin` only for the designated administrator. Do not expose credentials or UUIDs in screenshots.
3. Use at least two configured bureaus, one case assigned to an individual officer, one unassigned case in a managed bureau, and one out-of-scope case. Use only approved fictional data.
4. For each role, test complaint registry, institution history, action history, relationship queue, search, and reports. Attempt unauthorized mutations directly through the UI and confirm server/RLS rejection.
5. For the administrator and manager, verify assignment, transfer and review audit records. For oversight and individual officer, verify forbidden actions fail even if called directly.
6. Test document read/upload against migration `202610280003_private_supporting_documents.sql` only after applying it in the development project. Verify other roles cannot list, sign, or read an out-of-scope object.

Record account role, project/environment, action, result, and timestamp without copying complaint text, tokens, or secrets.
