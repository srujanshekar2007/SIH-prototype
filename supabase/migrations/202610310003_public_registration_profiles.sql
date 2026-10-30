
-- Allow public users without granting administrative permissions.
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS role_bureau_consistency;

ALTER TABLE public.profiles
ADD CONSTRAINT role_bureau_consistency CHECK (
    (
        role IN ('pgrc_officer', 'rb_officer')
        AND bureau_id IS NOT NULL
    )
    OR role IN ('aicte_official', 'administrator')
    OR (
        role = 'public_user'
        AND bureau_id IS NULL
        AND is_admin = FALSE
    )
);

-- Automatically provision a restricted profile for every new Auth user.
CREATE OR REPLACE FUNCTION public.provision_public_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    supplied_name TEXT;
BEGIN
    supplied_name := NULLIF(
        BTRIM(NEW.raw_user_meta_data ->> 'full_name'),
        ''
    );

    INSERT INTO public.profiles (
        id,
        display_name,
        role,
        bureau_id,
        is_admin,
        active
    )
    VALUES (
        NEW.id,
        LEFT(COALESCE(supplied_name, ''), 120),
        'public_user',
        NULL,
        FALSE,
        TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_public_user_profile()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_public_profile
ON auth.users;

CREATE TRIGGER on_auth_user_created_public_profile
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.provision_public_user_profile();

COMMENT ON FUNCTION public.provision_public_user_profile() IS
'Creates a least-privilege public_user profile for Auth signups.';
