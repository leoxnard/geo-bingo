-- =============================================================================
-- HOST CAPABILITY = SECRET TOKEN (not the public host_id)
-- =============================================================================
-- Problem: host RPCs authenticated by games.host_id, which equals the host's
-- player_id. Player ids are public (the roster is readable), so host_id is
-- enumerable — any player could present it and perform host actions. Hiding
-- host_id wouldn't help because it's just one of the visible player ids.
--
-- Fix: the host capability is now a high-entropy token stored in a table no
-- client can read (game_host_secrets, RLS on, no policies). host_id stays
-- public — it still identifies *who* the host is for display / isHost — but it
-- is no longer the capability. The host holds the token in localStorage; the
-- host RPCs validate the token instead of host_id.
--
-- The existing host RPCs keep their signatures to minimise churn; the
-- `p_host_id` / `p_current_host_id` parameter now carries the TOKEN, not the
-- player id. CREATE OR REPLACE preserves existing grants.
--
-- Residual (documented, acceptable for a casual game): host TRANSFER and the
-- brief moment between game creation and token registration each have a small
-- race window — fully closing them needs real auth. The realistic threat (a
-- player in the room reading host_id to act as host) is closed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.game_host_secrets (
    game_id text PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
    host_token text NOT NULL
);
ALTER TABLE public.game_host_secrets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: anon/authenticated have no direct read or write.
-- Only the SECURITY DEFINER functions below (running as the owner) touch it.

-- Internal helper. NOT granted to anon/authenticated, so it can only be reached
-- from inside the SECURITY DEFINER functions below (which run as the owner) —
-- clients can't call it to brute-force tokens.
CREATE OR REPLACE FUNCTION public.is_valid_host(p_game_id text, p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM game_host_secrets
        WHERE game_id = p_game_id AND p_token IS NOT NULL AND host_token = p_token
    );
$$;
REVOKE ALL ON FUNCTION public.is_valid_host(text, text) FROM PUBLIC;

-- The current host_id holder claims the token once. ON CONFLICT DO NOTHING
-- means an already-registered token can't be overwritten by a later caller.
CREATE OR REPLACE FUNCTION public.register_host_secret(p_game_id text, p_player_id text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rows_affected int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_player_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    INSERT INTO game_host_secrets (game_id, host_token)
    VALUES (p_game_id, p_token)
    ON CONFLICT (game_id) DO NOTHING;

    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    RETURN jsonb_build_object('success', rows_affected > 0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_host_secret(text, text, text) TO anon, authenticated, service_role;


-- ===== Host RPCs now validate the token (p_host_id slot carries it) =========

CREATE OR REPLACE FUNCTION public.set_game_status(p_game_id text, p_host_id text, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_status NOT IN ('lobby', 'playing', 'voting', 'finished') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_STATUS');
    END IF;
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games SET status = p_status WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_player(p_id uuid, p_host_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    target_game_id text;
BEGIN
    SELECT game_id INTO target_game_id FROM players WHERE id = p_id;
    IF target_game_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PLAYER_NOT_FOUND');
    END IF;
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(target_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    DELETE FROM players WHERE id = p_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_submissions_for_game(p_game_id text, p_host_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    DELETE FROM submissions WHERE game_id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- p_current_host_id carries the current host's TOKEN. The token is consumed
-- (deleted) on transfer; the new host re-registers a fresh one client-side.
CREATE OR REPLACE FUNCTION public.transfer_host(p_game_id text, p_current_host_id text, p_new_host_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_valid_host(p_game_id, p_current_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games SET host_id = p_new_host_id WHERE id = p_game_id;
    DELETE FROM game_host_secrets WHERE game_id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_game_settings(p_game_id text, p_host_id text, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    allowed_keys text[] := ARRAY[
        'categories', 'time_limit', 'game_mode', 'grid_size', 'team_mode',
        'starting_point', 'gameBoundary', 'end_condition', 'hide_minimap',
        'hide_map_symbols', 'suggested_categories', 'exclusive_mode',
        'category_source', 'generation_radius', 'generation_number',
        'category_details', 'language', 'categories_generated', 'ai_end_game',
        'ready_players', 'banned_players'
    ];
    safe_patch jsonb;
BEGIN
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    UPDATE games SET
        categories            = COALESCE(safe_patch->'categories', categories),
        time_limit            = COALESCE((safe_patch->>'time_limit')::int, time_limit),
        game_mode             = COALESCE(safe_patch->>'game_mode', game_mode),
        grid_size             = COALESCE((safe_patch->>'grid_size')::int, grid_size),
        team_mode             = COALESCE(safe_patch->>'team_mode', team_mode),
        starting_point        = COALESCE(safe_patch->>'starting_point', starting_point),
        "gameBoundary"        = COALESCE(safe_patch->>'gameBoundary', "gameBoundary"),
        end_condition         = COALESCE(safe_patch->>'end_condition', end_condition),
        hide_minimap          = COALESCE((safe_patch->>'hide_minimap')::boolean, hide_minimap),
        hide_map_symbols      = COALESCE((safe_patch->>'hide_map_symbols')::boolean, hide_map_symbols),
        suggested_categories  = CASE WHEN safe_patch ? 'suggested_categories'
                                    THEN ARRAY(SELECT jsonb_array_elements_text(safe_patch->'suggested_categories'))
                                    ELSE suggested_categories END,
        exclusive_mode        = COALESCE((safe_patch->>'exclusive_mode')::boolean, exclusive_mode),
        category_source       = COALESCE(safe_patch->>'category_source', category_source),
        generation_radius     = COALESCE((safe_patch->>'generation_radius')::bigint, generation_radius),
        generation_number     = COALESCE((safe_patch->>'generation_number')::int, generation_number),
        category_details      = CASE WHEN safe_patch ? 'category_details'
                                    THEN ARRAY(SELECT jsonb_array_elements(safe_patch->'category_details'))
                                    ELSE category_details END,
        language              = COALESCE(safe_patch->>'language', language),
        categories_generated  = COALESCE((safe_patch->>'categories_generated')::boolean, categories_generated),
        ai_end_game           = COALESCE((safe_patch->>'ai_end_game')::boolean, ai_end_game),
        ready_players         = CASE WHEN safe_patch ? 'ready_players'
                                    THEN ARRAY(SELECT jsonb_array_elements_text(safe_patch->'ready_players'))
                                    ELSE ready_players END,
        banned_players        = CASE WHEN safe_patch ? 'banned_players'
                                    THEN ARRAY(SELECT jsonb_array_elements_text(safe_patch->'banned_players'))
                                    ELSE banned_players END
    WHERE id = p_game_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
