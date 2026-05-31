-- =============================================================================
-- STEP 9 — ALLOW update_player TO MOVE A PLAYER BETWEEN GAMES (game_id)
-- =============================================================================
-- A browser session is identified by one player UUID (sessionStorage), and
-- players.id is the primary key — so a given session has exactly ONE player
-- row. Re-joining or switching games reuses that same UUID, which means the
-- existing row has to be MOVED to the new game by patching game_id. The
-- original client did exactly this (players.update({ game_id, name, ... })).
--
-- The step-2 lockdown migrated that write onto update_player but dropped
-- game_id from the allowlist (it looked immutable). The result: the second
-- game a tab ever opens can't register the player — their row stays in the
-- previous game, fetchPlayers for the new game returns a list without them,
-- and the client treats that as "you were kicked" and redirects home. Every
-- game after the first one in a tab appeared to be un-joinable.
--
-- Fix: re-add game_id to the allowlist (and the SET clause). This matches the
-- original behaviour. It does let a known player_id be moved into a game, but
-- joining is open by code anyway and player_ids are private UUIDs, so this
-- doesn't widen the trust model beyond what already existed.
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
BEGIN
    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
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
