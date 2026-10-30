# Authentication and public registration

## Existing system

The portal uses Supabase Auth with the browser's public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Database authorization remains in the existing RLS policies and role-aware SQL functions. The application profile is keyed by the Auth user UUID. Privileged profile fields are not editable by ordinary users.

## Public signup flow

1. A visitor chooses Create Account on the existing sign-in screen and provides a name, email, and 12–128 character password.
2. The browser calls Supabase Auth `signUp`, passing only the full name as user metadata. It never sends a role, Bureau, or admin flag.
3. Migrations `202610310002_add_public_user_role.sql` and `202610310003_public_registration_profiles.sql` add the `public_user` role and an Auth-user trigger. The trigger ignores role/permission metadata and inserts a profile with that fixed role, no Bureau, `is_admin=false`, and `active=true`. It uses `ON CONFLICT DO NOTHING` and does not modify existing profiles.
4. Supabase's email-confirmation setting determines whether a verification link is required before a session is returned. Add the local and production portal origins to Supabase Auth's Site URL/redirect allowlist before signup tests.
5. Public users see a restricted account page. This project has no public complaint intake feature, so registration does not create complaints or expose case/institution records. RLS remains the data boundary.

Apply the migrations in order only after review and approval; registration must not be enabled against a database where they are absent. Migration `202610310004_backfill_missing_public_profiles.sql` provisions existing Auth UUIDs that have no profile, using the same fixed public role, and leaves every existing profile untouched. It repairs accounts registered before the trigger was installed. None of these migrations resets data or weakens RLS. The first migration isolates the new enum value so PostgreSQL commits it before a later migration references it.

## Login and recovery

Login and password creation use Supabase Auth email/password methods. Forgot password calls `resetPasswordForEmail` with the portal origin. Supabase sends a recovery link; the existing Auth event handler opens the password-update screen, which calls `updateUser({password})`. Confirm the redirect origin in the Supabase Auth allowlist and configure email delivery in Supabase.

## Roles and user administration

Public signup cannot select or modify roles. Only the existing administrator RLS policy can view/update profiles in User & Role Management. The UI edits profiles through the signed-in administrator's Supabase session; it does not expose service credentials. Officer roles require a Bureau/Cell. `public_user` always has no Bureau and no administrator flag. An administrator can deactivate an application profile without deleting its Auth account; existing sessions re-check active profile access every 30 seconds and when the page regains focus. RLS independently checks active status for database operations.

Existing administrator and officer accounts are not modified by signup. The admin profile list uses UUID and display name because the public `profiles` table does not store email addresses. User password changes and account creation remain in Supabase Auth.

## Local setup and checks

Set the existing public Supabase variables in `.env.local`, apply the two reviewed migrations to the intended development Supabase project, and run:

```sh
npm install
npm test
npm run typecheck
npm run build
```

Use a dedicated test Supabase project and throwaway accounts to test registration, confirmation, duplicate signups, password reset, role restrictions, and existing privileged logins. Do not use real complaint details in test accounts.

## Verification stages

- Signup UI/code: implemented locally; Supabase account creation still requires configuration and the unapplied migrations.
- Automatic profile provisioning: migration authored; not applied or verified against a live Supabase project.
- Existing orphaned Auth users: the new backfill migration inserts only missing profiles as active `public_user`; it has not been applied or verified. Run the read-only checks in `PUBLIC_PROFILE_DIAGNOSTICS.sql` first.
- Public-user access restriction: enforced in the UI and expected to be enforced by existing RLS role scope; production RLS behavior must be tested after migration.
- Email verification and reset delivery: use the current Supabase project's Auth/email configuration; not tested against production.
- Production authentication: not verified; no deploy or production configuration change was performed.
