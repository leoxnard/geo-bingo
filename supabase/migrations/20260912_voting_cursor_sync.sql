-- =============================================================================
-- VOTING CURSOR: PUBLISH THE HOST'S WHOLE STATE, NOT JUST THE ACTIVE CARD
-- =============================================================================
-- The cursor only named the submission being voted on, so non-hosts could not
-- tell the difference between the two states where the host shows the category
-- grid instead of a card:
--
--   • between two submissions, while the host's replay animates onward
--   • after the last submission, when the round is complete
--
-- Both look like "no active card", but the second one also means the round's
-- final markers and the Next Player prompt should be on screen. Without it,
-- non-hosts sat on the previous submission's Street View while the host had
-- long since moved on — the reported "everyone should see the grid" desync.
--
-- voting_line_complete carries the second state. A null active card with the
-- flag false means "host is animating"; with it true, "round finished".
-- =============================================================================

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS voting_line_complete boolean DEFAULT false NOT NULL;

-- Reset alongside the rest of the voting cursor whenever a game (re)enters
-- voting or returns to the lobby, so a replayed game never starts finished.
CREATE OR REPLACE FUNCTION public.set_voting_cursor(
    p_game_id text,
    p_host_id text,
    p_round_index integer,
    p_active_sub_id uuid,
    p_line_complete boolean DEFAULT false
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games
    SET voting_round_index = p_round_index,
        voting_active_sub_id = p_active_sub_id,
        voting_line_complete = COALESCE(p_line_complete, false)
    WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

DROP FUNCTION IF EXISTS public.set_voting_cursor(text, text, integer, uuid);

ALTER FUNCTION public.set_voting_cursor(text, text, integer, uuid, boolean) OWNER TO postgres;
GRANT ALL ON FUNCTION public.set_voting_cursor(text, text, integer, uuid, boolean) TO anon;
GRANT ALL ON FUNCTION public.set_voting_cursor(text, text, integer, uuid, boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_voting_cursor(text, text, integer, uuid, boolean) TO service_role;

-- Four separate RPCs move a game into 'voting' (vote_to_end, force_end_round,
-- the all-ready auto-advance and set_game_status), each resetting the cursor
-- inline. Rather than editing all four and every future one, clear the flag from
-- a trigger on the status transition itself: a game entering voting or returning
-- to the lobby is never mid-replay, let alone finished with one.
CREATE OR REPLACE FUNCTION public.reset_voting_line_complete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('voting', 'lobby') THEN
        NEW.voting_line_complete := false;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.reset_voting_line_complete() OWNER TO postgres;

DROP TRIGGER IF EXISTS games_reset_voting_line_complete ON public.games;
CREATE TRIGGER games_reset_voting_line_complete
    BEFORE UPDATE ON public.games
    FOR EACH ROW EXECUTE FUNCTION public.reset_voting_line_complete();
