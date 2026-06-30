-- Self-service account deletion. Wipes everything the signed-in account owns and
-- then removes the auth identity itself, so no trace of the user remains in the
-- database. community_presets (and their votes, via cascade) and daily_attempts
-- both cascade off auth.users, but we also delete them explicitly so the intent
-- and the exact data removed are unambiguous. Runs as postgres (OWNER) so it is
-- allowed to delete from the auth schema; auth.identities / auth.sessions /
-- refresh_tokens cascade off auth.users automatically.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    caller uuid := auth.uid();
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    DELETE FROM community_presets WHERE author_id = caller;  -- votes cascade
    DELETE FROM daily_attempts    WHERE account_id = caller;

    DELETE FROM auth.users WHERE id = caller;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.delete_my_account() OWNER TO postgres;
GRANT ALL ON FUNCTION public.delete_my_account() TO anon;
GRANT ALL ON FUNCTION public.delete_my_account() TO authenticated;
GRANT ALL ON FUNCTION public.delete_my_account() TO service_role;
