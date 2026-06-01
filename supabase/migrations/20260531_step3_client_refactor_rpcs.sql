-- =============================================================================
-- STEP 3 — RPCS NEEDED BY THE CLIENT REFACTOR
-- =============================================================================
-- Three write paths in the client cannot be expressed through the existing
-- RPCs (update_game_settings, update_player, delete_submission etc):
--
--   1. games.update({ host_id: newHostId })  — handing host privileges to
--      another player. host_id is deliberately NOT on the update_game_settings
--      allowlist, because letting a "host" patch host_id would let anyone who
--      already knows it move it elsewhere; we want an explicit, narrow RPC.
--
--   2. players.delete(...) for kick / ban — must be host-only.
--
--   3. submissions.delete().eq('game_id', X) for the "back to lobby" restart
--      flow in PodiumView — must be host-only.
--
-- All three are SECURITY DEFINER + host-validated, mirroring the pattern of
-- the other RPCs in this batch.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- transfer_host: explicit handoff of the host role
-- -----------------------------------------------------------------------------
-- Caller proves they're the current host by sending p_current_host_id; only
-- if that matches games.host_id do we move host_id to p_new_host_id.
CREATE OR REPLACE FUNCTION public.transfer_host(
    p_game_id text,
    p_current_host_id text,
    p_new_host_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_current_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    UPDATE games SET host_id = p_new_host_id WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_host TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- delete_player: host kicks / bans a player
-- -----------------------------------------------------------------------------
-- Validates that p_host_id is actually host of the game owning the target
-- player before removing them.
CREATE OR REPLACE FUNCTION public.delete_player(
    p_id uuid,
    p_host_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_game_id text;
BEGIN
    SELECT game_id INTO target_game_id FROM players WHERE id = p_id;
    IF target_game_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PLAYER_NOT_FOUND');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM games WHERE id = target_game_id AND host_id = p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    DELETE FROM players WHERE id = p_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_player TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- clear_submissions_for_game: host wipes all submissions on restart
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_submissions_for_game(
    p_game_id text,
    p_host_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    DELETE FROM submissions WHERE game_id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_submissions_for_game TO anon, authenticated, service_role;
