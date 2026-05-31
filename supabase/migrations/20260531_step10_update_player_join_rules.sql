-- =============================================================================
-- STEP 10 — ENFORCE JOIN RULES WHEN update_player MOVES game_id
-- =============================================================================
-- Step 9 re-allowed update_player to change a player's game_id (needed so a
-- session's single player row can move between games). But that made the
-- "no joining after the lobby" rule — enforced for INSERTs by the
-- "Insert players only into open lobbies" policy — bypassable via an update.
--
-- Tighten it: when game_id is being changed to a *different* game, only allow
-- it if
--   • the player is NOT on that game's banned list, AND
--   • that game is still a lobby.
--
-- Reconnecting to the game you are already in (game_id unchanged) is always
-- allowed — that is how a player who was already in the lobby rejoins after
-- the round has started. So mid-round presence is limited to players who were
-- already in the game, and banned players can never (re)join.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_player(p_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    allowed_keys text[] := ARRAY['name', 'score', 'bingo_board', 'team', 'path', 'game_id'];
    safe_patch jsonb;
    new_game_id text;
    current_game_id text;
    target_status text;
    target_banned text[];
BEGIN
    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    -- Police game_id changes (joins). Other field updates are unaffected.
    IF safe_patch ? 'game_id' THEN
        new_game_id := safe_patch->>'game_id';
        SELECT game_id INTO current_game_id FROM players WHERE id = p_id;

        SELECT status, COALESCE(banned_players, '{}'::text[])
        INTO target_status, target_banned
        FROM games WHERE id = new_game_id;

        IF target_status IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'GAME_NOT_FOUND');
        END IF;

        -- Banned players can never (re)join, even by reconnecting.
        IF p_id::text = ANY(target_banned) THEN
            RETURN jsonb_build_object('success', false, 'error', 'BANNED');
        END IF;

        -- Moving INTO a different game is only allowed while it is a lobby.
        -- (Reconnecting to the game you are already in keeps working mid-round.)
        IF new_game_id IS DISTINCT FROM current_game_id AND target_status <> 'lobby' THEN
            RETURN jsonb_build_object('success', false, 'error', 'GAME_IN_PROGRESS');
        END IF;
    END IF;

    UPDATE players SET
        name         = COALESCE(safe_patch->>'name', name),
        score        = COALESCE((safe_patch->>'score')::int, score),
        bingo_board  = COALESCE(safe_patch->'bingo_board', bingo_board),
        team         = COALESCE((safe_patch->>'team')::int, team),
        path         = COALESCE(safe_patch->'path', path),
        game_id      = COALESCE(safe_patch->>'game_id', game_id)
    WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_player TO anon, authenticated, service_role;
