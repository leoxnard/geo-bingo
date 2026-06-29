-- =============================================================================
-- DAILY CHALLENGE — QUEUE ORDERING + INLINE EDIT
-- =============================================================================
-- Adds a manual queue order to the candidate pool and the RPCs the admin window
-- needs to curate it:
--   * sort_order column — admin-defined priority; the scheduler and the replace
--     RPC pick the lowest sort_order first (NULLs last, then oldest).
--   * admin_reorder_daily_candidates(ids) — persist a new queue order.
--   * admin_edit_daily_candidate(id, category) — rename a queued candidate.
-- The candidate list + scheduler + replace ordering all honour sort_order so the
-- top of the queue is genuinely "what runs next".
-- =============================================================================

ALTER TABLE public.daily_challenge_candidates
    ADD COLUMN IF NOT EXISTS sort_order double precision;

-- List ordering: curated (non-fallback) first, then by manual order, then oldest.
CREATE OR REPLACE FUNCTION public.admin_list_daily_candidates(p_status text DEFAULT NULL)
RETURNS SETOF public.daily_challenge_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN;  -- non-admins get nothing
    END IF;
    RETURN QUERY
        SELECT * FROM daily_challenge_candidates
        WHERE p_status IS NULL OR status = p_status
        ORDER BY is_fallback, sort_order NULLS LAST, reviewed_at NULLS LAST, created_at
        LIMIT 500;
END;
$$;

ALTER FUNCTION public.admin_list_daily_candidates(text) OWNER TO postgres;

-- Scheduler honours the manual order within each pool.
CREATE OR REPLACE FUNCTION public.ensure_daily_challenge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today date := (now() AT TIME ZONE 'utc')::date;
    cand  daily_challenge_candidates%ROWTYPE;
BEGIN
    IF EXISTS (SELECT 1 FROM daily_challenges WHERE challenge_date = today) THEN
        RETURN jsonb_build_object('success', true, 'created', false);
    END IF;

    SELECT * INTO cand FROM daily_challenge_candidates
    WHERE status = 'approved' AND is_fallback = false
      AND category_norm NOT IN (SELECT lower(trim(category)) FROM daily_challenges)
    ORDER BY sort_order NULLS LAST, reviewed_at NULLS LAST, created_at
    LIMIT 1;

    IF cand.id IS NULL THEN
        SELECT * INTO cand FROM daily_challenge_candidates
        WHERE status = 'approved' AND is_fallback = true
          AND category_norm NOT IN (SELECT lower(trim(category)) FROM daily_challenges)
        ORDER BY sort_order NULLS LAST, created_at
        LIMIT 1;
    END IF;

    IF cand.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CANDIDATE');
    END IF;

    INSERT INTO daily_challenges
        (challenge_date, candidate_id, category, source, lat, lng, heading, pitch, zoom, boundary, start_lat, start_lng)
    VALUES
        (today, cand.id, cand.category, cand.source, cand.lat, cand.lng, cand.heading, cand.pitch, cand.zoom,
         cand.boundary, cand.start_lat, cand.start_lng);

    UPDATE daily_challenge_candidates SET status = 'used' WHERE id = cand.id;

    RETURN jsonb_build_object('success', true, 'created', true, 'category', cand.category);
END;
$$;

ALTER FUNCTION public.ensure_daily_challenge() OWNER TO postgres;

-- Replace honours the manual order too.
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

    SELECT * INTO cand FROM daily_challenge_candidates
    WHERE status = 'approved'
      AND category_norm NOT IN (
          SELECT lower(trim(category)) FROM daily_challenges WHERE id <> ch.id
      )
    ORDER BY is_fallback, sort_order NULLS LAST, reviewed_at NULLS LAST, created_at
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

-- Persist a new queue order (ids in the desired order → ascending sort_order).
CREATE OR REPLACE FUNCTION public.admin_reorder_daily_candidates(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    UPDATE daily_challenge_candidates c
    SET sort_order = o.ord
    FROM (
        SELECT id, ordinality::double precision AS ord
        FROM unnest(p_ids) WITH ORDINALITY AS u(id, ordinality)
    ) o
    WHERE c.id = o.id;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.admin_reorder_daily_candidates(uuid[]) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_reorder_daily_candidates(uuid[]) TO authenticated, service_role;

-- Rename a queued candidate (keeps the normalised dedup key in sync).
CREATE OR REPLACE FUNCTION public.admin_edit_daily_candidate(p_id uuid, p_category text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    nm   text;
    norm text;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    nm := NULLIF(trim(coalesce(p_category, '')), '');
    IF nm IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CATEGORY');
    END IF;
    norm := lower(nm);

    IF EXISTS (SELECT 1 FROM daily_challenge_candidates WHERE category_norm = norm AND id <> p_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE');
    END IF;

    UPDATE daily_challenge_candidates SET category = nm, category_norm = norm WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.admin_edit_daily_candidate(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_edit_daily_candidate(uuid, text) TO authenticated, service_role;
