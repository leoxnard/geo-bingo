-- ============================================================================
-- delete_player: re-evaluate the round when a player is removed
-- ============================================================================
-- Kicking/banning a player shrinks the lobby. If we're mid-round and everyone
-- who is left has already voted to end the round, the "vote to end" quorum is
-- now met — so advance straight to voting instead of stranding the rest waiting
-- on a player who is gone. Also prune the removed player from ready_players so
-- every count stays consistent. Done inside the RPC so it's atomic + authoritative.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_game_id text;
    remaining      int;
    ready_here     int;
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

    -- Keep the ready set consistent with who is actually still here.
    UPDATE games SET ready_players = array_remove(COALESCE(ready_players, '{}'::text[]), p_id::text)
    WHERE id = target_game_id;

    -- If everyone remaining already voted to end the round, advance to voting
    -- (resetting the voting cursor, like the vote RPCs do).
    SELECT count(*) INTO remaining FROM players WHERE game_id = target_game_id;
    SELECT count(*) INTO ready_here
    FROM players p
    WHERE p.game_id = target_game_id
      AND p.id::text = ANY (COALESCE((SELECT ready_players FROM games WHERE id = target_game_id), '{}'::text[]));

    IF remaining > 0 AND ready_here >= remaining THEN
        UPDATE games SET status = 'voting', voting_round_index = 0, voting_active_sub_id = NULL
        WHERE id = target_game_id AND status = 'playing';
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;
