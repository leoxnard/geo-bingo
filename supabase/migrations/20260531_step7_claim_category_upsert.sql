-- =============================================================================
-- STEP 7 — TURN claim_category INTO AN UPSERT
-- =============================================================================
-- In non-exclusive (ffa) mode a player can re-capture a category at a new
-- camera angle to overwrite their earlier capture. The client used to do
--    if (existingSub) supabase.from('submissions').update(...)
--    else            supabase.from('submissions').insert(...)
-- which doesn't fit any of the existing rpcs.
--
-- Easiest is to make claim_category handle both: if the caller already has a
-- submission for the same (game_id, player_id, category), patch its position
-- and clear the cached AI verdict so the re-take has to be re-verified.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_category(
    p_game_id text,
    p_player_id uuid,
    p_category text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision
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

    SELECT id INTO existing_id
    FROM submissions
    WHERE game_id = p_game_id AND player_id = p_player_id AND category = p_category
    LIMIT 1;

    IF existing_id IS NOT NULL THEN
        UPDATE submissions SET
            lat = p_lat, lng = p_lng, heading = p_heading, pitch = p_pitch, zoom = p_zoom,
            ai_verdict = NULL, ai_verified_hash = NULL
        WHERE id = existing_id
        RETURNING * INTO result_sub;
    ELSE
        INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom)
        VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom)
        RETURNING * INTO result_sub;
    END IF;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_category TO anon, authenticated, service_role;
