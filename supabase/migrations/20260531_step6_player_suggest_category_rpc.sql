-- =============================================================================
-- STEP 6 — PLAYER-SUBMITTED CATEGORY SUGGESTIONS
-- =============================================================================
-- handleSuggestCategory in components/lobby/LobbyCategories.tsx lets non-host
-- players propose a category that the host can later accept or reject. The
-- write goes into games.suggested_categories, which update_game_settings
-- only allows the host to touch.
--
-- This narrow rpc lets any player in the game append to the suggestions
-- list. It dedupes against the existing list so the same suggestion can't
-- pile up multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.player_suggest_category(
    p_game_id text,
    p_player_id uuid,
    p_category text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    trimmed_cat text;
    existing text[];
BEGIN
    trimmed_cat := trim(p_category);
    IF trimmed_cat = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'EMPTY');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    SELECT COALESCE(suggested_categories, '{}'::text[])
    INTO existing
    FROM games WHERE id = p_game_id;

    -- Case-insensitive dedup.
    IF EXISTS (SELECT 1 FROM unnest(existing) AS s WHERE lower(s) = lower(trimmed_cat)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ALREADY_SUGGESTED');
    END IF;

    UPDATE games
    SET suggested_categories = existing || ARRAY[trimmed_cat]
    WHERE id = p_game_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.player_suggest_category TO anon, authenticated, service_role;
