-- =============================================================================
-- HYPE VOTES
-- =============================================================================
-- Adds register_hype: an optional "extra points" vote a player can cast on a
-- submission in addition to (or instead of) their yes/no vote. Each hype a
-- submission receives is worth half a point on the podium.
--
-- Hype is stored in the same `votes` jsonb as yes/no, but namespaced under a
-- `hype:` key prefix (e.g. `hype:<player_id>`) so it never gets mistaken for a
-- yes/no vote when tallying. The value is a boolean toggle (true = hyped).
--
-- Mirrors register_vote's membership check: the hyper must be a player in the
-- same game as the submission.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_hype(p_submission_id uuid, p_player_id text, p_hype boolean)
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
        RETURN; -- no such submission; nothing to hype
    END IF;

    -- The hyper must be a player in the same game as the submission.
    IF NOT EXISTS (SELECT 1 FROM players WHERE id::text = p_player_id AND game_id = sub_game) THEN
        RETURN; -- reject hypes from non-members / arbitrary keys
    END IF;

    UPDATE submissions
    SET votes = jsonb_set(COALESCE(votes, '{}'::jsonb), array['hype:' || p_player_id], to_jsonb(p_hype))
    WHERE id = p_submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_hype TO anon, authenticated, service_role;
