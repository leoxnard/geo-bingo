-- =============================================================================
-- SUBMISSION CAPTURE TIMESTAMP
-- =============================================================================
-- The voting "journey replay" places each submission along the player's path by
-- finding the nearest path point in space. When the path revisits a location
-- (e.g. a category is found early, then re-captured later at the same spot) the
-- spatial match picks the FIRST pass, so an overwrite surfaces at the old, early
-- position instead of where it was actually re-taken.
--
-- To fix this we store the client-side capture time (epoch ms, the SAME clock
-- the path points use) so the replay can match by time. The column is nullable
-- and the RPC param defaults to NULL, so older rows / callers keep working
-- (the client falls back to spatial matching when it's absent).
-- =============================================================================

ALTER TABLE public.submissions
    ADD COLUMN IF NOT EXISTS captured_at bigint;

-- claim_category (ffa upsert) -------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.claim_category(
    p_game_id text,
    p_player_id uuid,
    p_category text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision,
    p_captured_at bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    existing_id uuid;
    result_sub RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    PERFORM 1 FROM players WHERE id = p_player_id FOR UPDATE;

    SELECT id INTO existing_id
    FROM submissions
    WHERE game_id = p_game_id AND player_id = p_player_id AND category = p_category
    LIMIT 1;

    IF existing_id IS NOT NULL THEN
        UPDATE submissions SET
            lat = p_lat, lng = p_lng, heading = p_heading, pitch = p_pitch, zoom = p_zoom,
            captured_at = p_captured_at,
            ai_verdict = NULL, ai_verified_hash = NULL
        WHERE id = existing_id
        RETURNING * INTO result_sub;
    ELSE
        INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom, captured_at)
        VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom, p_captured_at)
        RETURNING * INTO result_sub;
    END IF;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_category TO anon, authenticated, service_role;

-- claim_exclusive_category ----------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_exclusive_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.claim_exclusive_category(
    p_game_id text,
    p_player_id uuid,
    p_category text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision,
    p_captured_at bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result_sub RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    PERFORM 1 FROM games WHERE id = p_game_id FOR UPDATE;

    IF EXISTS (SELECT 1 FROM submissions WHERE game_id = p_game_id AND category = p_category) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CLAIMED');
    END IF;

    INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom, captured_at)
    VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom, p_captured_at)
    RETURNING * INTO result_sub;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_exclusive_category TO anon, authenticated, service_role;
