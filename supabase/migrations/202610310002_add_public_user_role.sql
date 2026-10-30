-- Keep this enum change isolated so PostgreSQL commits the new value before it
-- is referenced by constraints and provisioning functions in the next migration.
alter type public.app_role add value if not exists 'public_user';
