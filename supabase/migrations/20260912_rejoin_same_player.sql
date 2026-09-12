-- =============================================================================
-- REJOIN AS THE SAME PLAYER
-- =============================================================================
-- A player who left a running game and came back was registered as a brand new
-- players row: the game showed a duplicate entrant, and the returning player
-- lost their board, path, submissions and team.
--
-- The client id (players.id) lived in sessionStorage, so it died with the tab.
-- That is fixed client-side, but storage can still be gone (another browser,
-- another device, cleared data, private window), so join_game gains two fallback
-- identities to recognise a returning player by:
--
--   • account_id — a signed-in player is the same person on any device
--   • device_id  — the anonymous per-browser id from lib/deviceId.ts
--
-- Resolution order is id → account_id → device_id, always scoped to THIS game.
-- The existing row is never re-keyed (submissions.player_id FKs to it); instead
-- join_game returns the canonical player_id and the client adopts it.
-- =============================================================================

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS device_id text;

-- Rejoin lookups are always "this game, this identity".
CREATE INDEX IF NOT EXISTS players_game_device_idx ON public.players (game_id, device_id);
CREATE INDEX IF NOT EXISTS players_game_account_idx ON public.players (game_id, account_id);

-- Replaced by the p_device_id overload below. Dropped rather than left alongside
-- it so a named-argument call can never resolve ambiguously.
DROP FUNCTION IF EXISTS public.join_game(text, uuid, text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.join_game(
    p_game_id text,
    p_player_id uuid,
    p_name text,
    p_account_id uuid DEFAULT NULL::uuid,
    p_bingo_board jsonb DEFAULT NULL::jsonb,
    p_device_id text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    target_status text;
    target_banned text[];
    target_require_twitch boolean;
    target_host_id text;
    existing_id uuid;
    dev text := NULLIF(btrim(coalesce(p_device_id, '')), '');
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

    -- Who is this, really? The id the client brought is authoritative when it
    -- already names a row in this game. Otherwise the client lost its storage,
    -- so fall back to the account (same person, any device) and then the device
    -- (same browser, no account). Both fallbacks are scoped to this game.
    SELECT id INTO existing_id FROM players WHERE id = p_player_id AND game_id = p_game_id;

    IF existing_id IS NULL AND p_account_id IS NOT NULL THEN
        SELECT id INTO existing_id FROM players
        WHERE game_id = p_game_id AND account_id = p_account_id
        ORDER BY id LIMIT 1;
    END IF;

    IF existing_id IS NULL AND dev IS NOT NULL THEN
        SELECT id INTO existing_id FROM players
        WHERE game_id = p_game_id AND device_id = dev
        ORDER BY id LIMIT 1;
    END IF;

    IF existing_id IS NOT NULL THEN
        -- A ban is recorded against the id the host saw, which may be the
        -- canonical row rather than the one this client brought.
        IF existing_id::text = ANY(target_banned) THEN
            RETURN jsonb_build_object('success', false, 'error', 'BANNED');
        END IF;

        -- Rejoin: keep every stat on the row (score, path, board, team) and only
        -- refresh the identity material. The board is filled in only when the row
        -- never got one, so a returning player keeps the board they played on.
        UPDATE players SET
            name        = COALESCE(NULLIF(p_name, ''), name),
            account_id  = COALESCE(account_id, p_account_id),
            device_id   = COALESCE(device_id, dev),
            bingo_board = CASE
                WHEN p_bingo_board IS NOT NULL AND (bingo_board IS NULL OR jsonb_array_length(bingo_board) = 0)
                    THEN p_bingo_board
                ELSE bingo_board
            END
        WHERE id = existing_id;

        RETURN jsonb_build_object('success', true, 'rejoined', true, 'player_id', existing_id);
    END IF;

    -- New registration. A finished game is spectate-only: no row, but no error.
    IF target_status = 'finished' THEN
        RETURN jsonb_build_object('success', true, 'spectator', true);
    END IF;

    IF target_require_twitch
        AND p_player_id::text IS DISTINCT FROM target_host_id
        AND NOT public.current_user_has_twitch() THEN
        RETURN jsonb_build_object('success', false, 'error', 'TWITCH_REQUIRED');
    END IF;

    INSERT INTO players (id, game_id, name, account_id, device_id, bingo_board)
    VALUES (p_player_id, p_game_id, NULLIF(p_name, ''), p_account_id, dev, COALESCE(p_bingo_board, '[]'::jsonb))
    ON CONFLICT (id) DO UPDATE SET
        game_id     = EXCLUDED.game_id,
        name        = COALESCE(EXCLUDED.name, players.name),
        account_id  = COALESCE(players.account_id, EXCLUDED.account_id),
        device_id   = COALESCE(EXCLUDED.device_id, players.device_id),
        bingo_board = CASE
            WHEN EXCLUDED.bingo_board IS NOT NULL AND jsonb_array_length(EXCLUDED.bingo_board) > 0
                THEN EXCLUDED.bingo_board
            ELSE players.bingo_board
        END;

    RETURN jsonb_build_object('success', true, 'player_id', p_player_id);
END;
$$;

ALTER FUNCTION public.join_game(text, uuid, text, uuid, jsonb, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.join_game(text, uuid, text, uuid, jsonb, text) TO anon;
GRANT ALL ON FUNCTION public.join_game(text, uuid, text, uuid, jsonb, text) TO authenticated;
GRANT ALL ON FUNCTION public.join_game(text, uuid, text, uuid, jsonb, text) TO service_role;
