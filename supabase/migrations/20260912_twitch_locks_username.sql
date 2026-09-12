-- =============================================================================
-- A LINKED TWITCH ACCOUNT OWNS THE DISPLAY NAME
-- =============================================================================
-- When Twitch is linked, the app syncs the account name to the Twitch handle
-- (see AccountProfile's twitch-name effect) so presets, the leaderboard and the
-- lobby all show the streamer's real handle. Any manual rename is therefore
-- pointless — it is overwritten on the next visit — and confusing while it
-- lasts.
--
-- The account page already hid its rename button, but the profile overlay in
-- the options menu did not, and nothing stopped a direct RPC call. Enforce it
-- where every path has to go through instead of at each button.
--
-- The name still changes when the Twitch handle does: that sync calls this RPC
-- too, so it is allowed through when the requested name IS the linked handle.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_username(p_username text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
    u   text := btrim(coalesce(p_username, ''));
    twitch_handle text;
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    IF length(u) < 2 OR length(u) > 30 THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID'); END IF;

    SELECT coalesce(
               identity_data ->> 'user_name',
               identity_data ->> 'preferred_username',
               identity_data ->> 'nickname',
               identity_data ->> 'name'
           )
    INTO twitch_handle
    FROM auth.identities
    WHERE user_id = uid AND provider = 'twitch'
    LIMIT 1;

    IF FOUND AND lower(coalesce(twitch_handle, '')) IS DISTINCT FROM lower(u) THEN
        RETURN jsonb_build_object('success', false, 'error', 'TWITCH_MANAGED');
    END IF;

    IF EXISTS (SELECT 1 FROM profiles WHERE lower(username) = lower(u) AND id <> uid) THEN
        RETURN jsonb_build_object('success', false, 'error', 'TAKEN');
    END IF;
    INSERT INTO profiles (id, username) VALUES (uid, u)
        ON CONFLICT (id) DO UPDATE SET username = excluded.username;
    UPDATE community_presets SET author_name = u WHERE author_id = uid;
    RETURN jsonb_build_object('success', true, 'username', u);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TAKEN');
END;
$$;

ALTER FUNCTION public.set_username(text) OWNER TO postgres;
