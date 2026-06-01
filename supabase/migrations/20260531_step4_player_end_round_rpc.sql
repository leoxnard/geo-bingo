-- =============================================================================
-- STEP 4 — PLAYER-INITIATED END-OF-ROUND RPC
-- =============================================================================
-- Two places in the client transition status from 'playing' -> 'voting' from
-- a non-host browser:
--
--   1. StreetView first-bingo trigger: when any player completes a bingo and
--      endCondition='first_bingo', they end the round.
--   2. useAiVerify: the player who clicks "AI Verify & End" ends the round
--      after Gemini approves all their categories.
--
-- These cannot use set_game_status (host-only). Adding one narrow RPC instead
-- of broadening set_game_status, so the host-only contract stays clean.
--
-- The transition is bounded: 'playing' -> 'voting' only, by any player in
-- the game. Worst-case abuse: a player in the game ends the round early,
-- which is a UX issue, not a security one. Knowing a player_id is already
-- equivalent to acting as that player in this app.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.player_end_round(
    p_game_id text,
    p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    UPDATE games SET status = 'voting'
    WHERE id = p_game_id AND status = 'playing';

    -- If the game wasn't in 'playing' the UPDATE matches zero rows; that's
    -- fine — it means someone else already advanced it (or the host is
    -- finishing manually). No error, just no-op.

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.player_end_round TO anon, authenticated, service_role;
