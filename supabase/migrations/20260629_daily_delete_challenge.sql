-- Delete a materialised challenge for a given date (wipes all attempts), then
-- immediately replaces it with the next approved candidate from the queue.
-- If the queue is empty the day is simply left challengeless.
CREATE OR REPLACE FUNCTION public.admin_delete_daily_challenge(p_date date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    ch   daily_challenges%ROWTYPE;
    cand daily_challenge_candidates%ROWTYPE;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    SELECT * INTO ch FROM daily_challenges WHERE challenge_date = p_date;
    IF ch.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;

    -- Return old candidate to the approved pool so it can be scheduled again.
    IF ch.candidate_id IS NOT NULL THEN
        UPDATE daily_challenge_candidates SET status = 'approved' WHERE id = ch.candidate_id;
    END IF;

    -- Wipe all play records for this challenge.
    DELETE FROM daily_attempts WHERE challenge_id = ch.id;

    -- Remove the challenge row.
    DELETE FROM daily_challenges WHERE id = ch.id;

    -- Pick the next approved candidate that has not been used on any other day.
    SELECT * INTO cand FROM daily_challenge_candidates
    WHERE status = 'approved'
      AND category_norm NOT IN (
          SELECT lower(trim(category)) FROM daily_challenges
      )
    ORDER BY is_fallback, sort_order NULLS LAST, reviewed_at NULLS LAST, created_at
    LIMIT 1;

    IF cand.id IS NOT NULL THEN
        UPDATE daily_challenge_candidates SET status = 'used' WHERE id = cand.id;
        INSERT INTO daily_challenges (
            challenge_date, candidate_id, category, category_translations,
            source, lat, lng, heading, pitch, zoom, boundary, start_lat, start_lng
        ) VALUES (
            p_date, cand.id, cand.category, cand.category_translations,
            cand.source, cand.lat, cand.lng, cand.heading, cand.pitch, cand.zoom,
            cand.boundary, cand.start_lat, cand.start_lng
        );
        RETURN jsonb_build_object('success', true, 'category', cand.category);
    END IF;

    RETURN jsonb_build_object('success', true, 'category', null);
END;
$$;

ALTER FUNCTION public.admin_delete_daily_challenge(date) OWNER TO postgres;
GRANT ALL ON FUNCTION public.admin_delete_daily_challenge(date) TO anon;
GRANT ALL ON FUNCTION public.admin_delete_daily_challenge(date) TO authenticated;
GRANT ALL ON FUNCTION public.admin_delete_daily_challenge(date) TO service_role;
