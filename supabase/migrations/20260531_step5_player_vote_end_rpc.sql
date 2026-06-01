-- =============================================================================
-- STEP 5 — PLAYER-INITIATED VOTE-TO-END
-- =============================================================================
-- handleVoteEndOptimistic in app/game/[id]/page.tsx lets each player vote to
-- end the round during gameplay. When every player has voted, status flips
-- to 'voting'. This is per-player, not host-only, so update_game_settings
-- (host-only) doesn't fit.
--
-- player_vote_to_end_round adds the caller's id to games.ready_players (or
-- leaves it alone if already present) and, when the array length reaches the
-- total player count in the game, also flips status -> 'voting' in the same
-- statement.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.player_vote_to_end_round(
    p_game_id text,
    p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_ready    text[];
    total_players int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    -- Dedupe-append: union the existing ready_players array with the caller.
    SELECT ARRAY(SELECT DISTINCT unnest(
        COALESCE((SELECT ready_players FROM games WHERE id = p_game_id), '{}'::text[])
        || ARRAY[p_player_id::text]
    )) INTO new_ready;

    SELECT count(*)::int INTO total_players FROM players WHERE game_id = p_game_id;

    IF array_length(new_ready, 1) >= total_players THEN
        UPDATE games SET ready_players = new_ready, status = 'voting'
        WHERE id = p_game_id AND status = 'playing';
    ELSE
        UPDATE games SET ready_players = new_ready WHERE id = p_game_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'ready_count', array_length(new_ready, 1), 'total_players', total_players);
END;
$$;

GRANT EXECUTE ON FUNCTION public.player_vote_to_end_round TO anon, authenticated, service_role;
