-- =============================================================================
-- VOTING HARDENING
-- =============================================================================
-- 1. register_vote: validate that the voter is actually a player in the same
--    game as the submission before recording a vote. Previously any caller
--    could write a vote onto any submission under any voter key.
--
-- 2. player_vote_to_end_round: lock the game row before reading + rewriting
--    ready_players so concurrent voters can't lose each other's votes
--    (last-writer-wins on a stale read).
-- =============================================================================

-- 1 -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_vote(p_submission_id uuid, p_player_id text, p_vote boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    sub_game text;
BEGIN
    SELECT game_id INTO sub_game FROM submissions WHERE id = p_submission_id;
    IF sub_game IS NULL THEN
        RETURN; -- no such submission; nothing to vote on
    END IF;

    -- The voter must be a player in the same game as the submission.
    IF NOT EXISTS (SELECT 1 FROM players WHERE id::text = p_player_id AND game_id = sub_game) THEN
        RETURN; -- reject votes from non-members / arbitrary voter keys
    END IF;

    UPDATE submissions
    SET votes = jsonb_set(COALESCE(votes, '{}'::jsonb), array[p_player_id], to_jsonb(p_vote))
    WHERE id = p_submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_vote TO anon, authenticated, service_role;


-- 2 -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.player_vote_to_end_round(p_game_id text, p_player_id uuid)
RETURNS jsonb
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

    -- Lock the game row so concurrent voters serialise; without this, two votes
    -- arriving together each read the old ready_players and one overwrites the
    -- other.
    PERFORM 1 FROM games WHERE id = p_game_id FOR UPDATE;

    -- Dedupe-append: union the (now locked) ready_players array with the caller.
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
