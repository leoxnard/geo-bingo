-- ============================================================================
-- join_game: register a player into a game, including after it has started
-- ============================================================================
-- Players used to be inserted directly from the client (supabase.from('players')
-- .insert(...)), gated by the RLS policy "Insert players only into open lobbies"
-- which only permits inserts while games.status = 'lobby'. A player opening the
-- room link after the host started the game (status = 'playing') therefore never
-- got a players row, and every subsequent claim_category / vote failed with
-- NOT_A_PLAYER.
--
-- This SECURITY DEFINER RPC is the authoritative join path. It bypasses the RLS
-- insert gate deliberately and enforces the real rules server-side:
--   * game must exist                            -> GAME_NOT_FOUND
--   * banned players are refused                 -> BANNED
--   * a row already in this game is a rejoin/refresh (idempotent, no dup row)
--   * a finished game is spectate-only           -> success + spectator, no row
--   * lobby / playing / voting register the row so late joiners can play + vote
--   * if the game requires a linked Twitch account, only the host and Twitch-
--     linked players may register           -> TWITCH_REQUIRED
-- The bingo board is passed in (the client shuffles it) to avoid duplicating the
-- board-assignment logic in SQL.
--
-- NOTE: this references games.require_twitch and current_user_has_twitch(), which
-- are created by 20260719_twitch_auth.sql. Apply that migration before this one.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid" DEFAULT NULL::"uuid", "p_bingo_board" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_status text;
    target_banned text[];
    target_require_twitch boolean;
    target_host_id text;
BEGIN
    SELECT status, COALESCE(banned_players, '{}'::text[]), COALESCE(require_twitch, false), host_id
    INTO target_status, target_banned, target_require_twitch, target_host_id
    FROM games WHERE id = p_game_id;

    IF target_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'GAME_NOT_FOUND');
    END IF;

    IF p_player_id::text = ANY(target_banned) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BANNED');
    END IF;

    -- Rejoin: this player already belongs to the game (refresh / reconnect).
    -- Keep it idempotent so we never create a duplicate row.
    IF EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        UPDATE players SET
            name        = COALESCE(NULLIF(p_name, ''), name),
            account_id  = COALESCE(account_id, p_account_id),
            bingo_board = CASE
                WHEN p_bingo_board IS NOT NULL AND (bingo_board IS NULL OR jsonb_array_length(bingo_board) = 0)
                    THEN p_bingo_board
                ELSE bingo_board
            END
        WHERE id = p_player_id;
        RETURN jsonb_build_object('success', true, 'rejoined', true);
    END IF;

    -- New registration. A finished game is spectate-only: no row, but no error.
    IF target_status = 'finished' THEN
        RETURN jsonb_build_object('success', true, 'spectator', true);
    END IF;

    -- Twitch gate: if the host requires a linked Twitch account, only the host
    -- and players who linked Twitch may register. Existing members (rejoin path
    -- above) are unaffected, so flipping the flag never ejects anyone.
    IF target_require_twitch
        AND p_player_id::text IS DISTINCT FROM target_host_id
        AND NOT public.current_user_has_twitch() THEN
        RETURN jsonb_build_object('success', false, 'error', 'TWITCH_REQUIRED');
    END IF;

    INSERT INTO players (id, game_id, name, account_id, bingo_board)
    VALUES (p_player_id, p_game_id, NULLIF(p_name, ''), p_account_id, COALESCE(p_bingo_board, '[]'::jsonb))
    ON CONFLICT (id) DO UPDATE SET
        game_id     = EXCLUDED.game_id,
        name        = COALESCE(EXCLUDED.name, players.name),
        account_id  = COALESCE(players.account_id, EXCLUDED.account_id),
        bingo_board = CASE
            WHEN EXCLUDED.bingo_board IS NOT NULL AND jsonb_array_length(EXCLUDED.bingo_board) > 0
                THEN EXCLUDED.bingo_board
            ELSE players.bingo_board
        END;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") TO "service_role";
