-- =============================================================================
-- PERSIST THE PANORAMA A SUBMISSION WAS TAKEN IN
-- =============================================================================
-- A submission stored only lat/lng/heading/pitch/zoom. Nothing ever stored an
-- image, so the voting replay, the checklist thumbnail and the Gemini
-- verification image each re-derive the view by asking Google for the panorama
-- NEAREST to those coordinates.
--
-- Nearest is not the same as the one the player stood in. It diverges for
-- photospheres and indoor tours sitting metres from a road pano, for junctions
-- where a rival pano is marginally closer, and whenever coverage is refreshed
-- between capture and voting. When it diverges, the stored heading is applied
-- from a different vantage point and the claimed object is simply not in frame
-- — the reported "voting shows a different picture" mismatch.
--
-- pano_id pins it exactly. It is nullable: submissions taken before this
-- migration keep working through the coordinate fallback.
-- =============================================================================

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS pano_id text;

CREATE OR REPLACE FUNCTION public.claim_category(
    p_game_id text,
    p_player_id uuid,
    p_category text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision,
    p_captured_at bigint DEFAULT NULL::bigint,
    p_pano_id text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
            pano_id = p_pano_id,
            captured_at = p_captured_at,
            ai_verdict = NULL, ai_verified_hash = NULL
        WHERE id = existing_id
        RETURNING * INTO result_sub;
    ELSE
        INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom, pano_id, captured_at)
        VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom, p_pano_id, p_captured_at)
        RETURNING * INTO result_sub;
    END IF;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_exclusive_category(
    p_game_id text,
    p_player_id uuid,
    p_category text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision,
    p_captured_at bigint DEFAULT NULL::bigint,
    p_pano_id text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

    INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom, pano_id, captured_at)
    VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom, p_pano_id, p_captured_at)
    RETURNING * INTO result_sub;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;

-- The 9-argument versions are superseded by the p_pano_id overloads above.
-- Dropped so a named-argument call can never resolve ambiguously.
DROP FUNCTION IF EXISTS public.claim_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint);
DROP FUNCTION IF EXISTS public.claim_exclusive_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint);

ALTER FUNCTION public.claim_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) OWNER TO postgres;
ALTER FUNCTION public.claim_exclusive_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) OWNER TO postgres;

GRANT ALL ON FUNCTION public.claim_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) TO anon;
GRANT ALL ON FUNCTION public.claim_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) TO service_role;
GRANT ALL ON FUNCTION public.claim_exclusive_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) TO anon;
GRANT ALL ON FUNCTION public.claim_exclusive_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_exclusive_category(text, uuid, text, double precision, double precision, double precision, double precision, double precision, bigint, text) TO service_role;
