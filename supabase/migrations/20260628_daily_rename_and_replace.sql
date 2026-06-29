-- =============================================================================
-- DAILY CHALLENGE — RENAME PROPAGATION + ADMIN CATEGORY REPLACE
-- =============================================================================
-- Two incremental changes on top of 20260628_daily_challenge.sql:
--
--   1. The account-wide rename (rename_my_presets_author) now also rewrites the
--      caller's recorded daily-challenge leaderboard name, so a rename updates
--      every place the player's name appears (presets + daily attempts).
--
--   2. admin_replace_daily_challenge(date) lets an admin swap a day's challenge
--      for the next approved candidate in the queue (the outgoing category goes
--      back into the queue; the day's attempts are cleared since the task changed).
-- =============================================================================

-- 1. Account-wide rename now also covers daily leaderboard entries -------------
CREATE OR REPLACE FUNCTION public.rename_my_presets_author(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller uuid := auth.uid();
    safe_name text;
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    safe_name := NULLIF(trim(coalesce(p_name, '')), '');

    UPDATE community_presets SET author_name = safe_name WHERE author_id = caller;
    UPDATE daily_attempts   SET player_name = safe_name WHERE account_id = caller;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.rename_my_presets_author(text) OWNER TO postgres;

-- 2. Admin: replace a day's challenge with the next approved candidate ---------
-- The current category returns to the queue (status 'approved') so it can be
-- reused on a future day; the incoming candidate is marked 'used'. Existing
-- attempts for the day are deleted because the task (category) has changed.
CREATE OR REPLACE FUNCTION public.admin_replace_daily_challenge(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    -- Next approved candidate not already used by another day; curated first.
    SELECT * INTO cand FROM daily_challenge_candidates
    WHERE status = 'approved'
      AND category_norm NOT IN (
          SELECT lower(trim(category)) FROM daily_challenges WHERE id <> ch.id
      )
    ORDER BY is_fallback, reviewed_at NULLS LAST, created_at
    LIMIT 1;

    IF cand.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CANDIDATE');
    END IF;

    IF ch.candidate_id IS NOT NULL THEN
        UPDATE daily_challenge_candidates SET status = 'approved' WHERE id = ch.candidate_id;
    END IF;
    UPDATE daily_challenge_candidates SET status = 'used' WHERE id = cand.id;

    UPDATE daily_challenges SET
        candidate_id = cand.id,
        category     = cand.category,
        source       = cand.source,
        lat          = cand.lat,
        lng          = cand.lng,
        heading      = cand.heading,
        pitch        = cand.pitch,
        zoom         = cand.zoom,
        boundary     = cand.boundary,
        start_lat    = cand.start_lat,
        start_lng    = cand.start_lng,
        created_at   = now()
    WHERE id = ch.id;

    DELETE FROM daily_attempts WHERE challenge_id = ch.id;

    RETURN jsonb_build_object('success', true, 'category', cand.category);
END;
$$;

ALTER FUNCTION public.admin_replace_daily_challenge(date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_replace_daily_challenge(date) TO authenticated, service_role;
