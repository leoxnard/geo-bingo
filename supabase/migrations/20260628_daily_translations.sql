-- =============================================================================
-- DAILY CHALLENGE — CATEGORY TRANSLATIONS
-- =============================================================================
-- Mirrors the community-preset publish flow: when an admin adds a candidate, the
-- client auto-detects the language (DeepL) and translates the category into every
-- app locale. We persist that map so players see the category in their own locale.
--
--   * category_translations jsonb — { en, de, es, fr, zh } (any subset; missing
--     locales fall back to the canonical `category` on the client).
--   * The add/review RPCs accept the translations; the scheduler + replace copy
--     them onto the materialised challenge; the read RPCs expose them.
-- =============================================================================

ALTER TABLE public.daily_challenge_candidates
    ADD COLUMN IF NOT EXISTS category_translations jsonb;
ALTER TABLE public.daily_challenges
    ADD COLUMN IF NOT EXISTS category_translations jsonb;

-- Add a pre-approved AI/manual candidate, now carrying per-locale translations.
DROP FUNCTION IF EXISTS public.admin_add_candidate(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, text);

CREATE OR REPLACE FUNCTION public.admin_add_candidate(
    p_category text,
    p_source   text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision,
    p_start_lat double precision DEFAULT NULL,
    p_start_lng double precision DEFAULT NULL,
    p_boundary text DEFAULT NULL,
    p_translations jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    IF p_category IS NULL OR trim(p_category) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CATEGORY');
    END IF;
    IF p_source NOT IN ('ai', 'manual') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_SOURCE');
    END IF;
    IF (p_lat IS NULL OR p_lng IS NULL) AND (p_start_lat IS NULL OR p_start_lng IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MISSING_VIEW');
    END IF;

    INSERT INTO daily_challenge_candidates
        (category, category_norm, source, lat, lng, heading, pitch, zoom, start_lat, start_lng, boundary, category_translations, status, reviewed_at, reviewed_by)
    VALUES
        (trim(p_category), lower(trim(p_category)), p_source, p_lat, p_lng,
         coalesce(p_heading, 0), coalesce(p_pitch, 0), coalesce(p_zoom, 1),
         p_start_lat, p_start_lng,
         p_boundary, p_translations, 'approved', now(), auth.uid())
    ON CONFLICT (category_norm) DO NOTHING;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.admin_add_candidate(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_add_candidate(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, text, jsonb) TO authenticated, service_role;

-- Bulk-add database fallback categories — items are { name, translations } objects.
CREATE OR REPLACE FUNCTION public.admin_add_database_candidates(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    added int;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_ITEMS');
    END IF;

    WITH cleaned AS (
        SELECT DISTINCT ON (lower(trim(elem->>'name')))
            trim(elem->>'name') AS cat,
            lower(trim(elem->>'name')) AS norm,
            CASE WHEN jsonb_typeof(elem->'translations') = 'object' THEN elem->'translations' ELSE NULL END AS tr
        FROM jsonb_array_elements(p_items) AS t(elem)
        WHERE trim(coalesce(elem->>'name', '')) <> ''
    ),
    ins AS (
        INSERT INTO daily_challenge_candidates
            (category, category_norm, source, is_fallback, status, category_translations, reviewed_at, reviewed_by)
        SELECT cat, norm, 'database', true, 'approved', tr, now(), auth.uid()
        FROM cleaned
        ON CONFLICT (category_norm) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO added FROM ins;

    RETURN jsonb_build_object('success', true, 'added', added);
END;
$$;

ALTER FUNCTION public.admin_add_database_candidates(jsonb) OWNER TO postgres;

-- Approve/reject a candidate; approval can attach translations (game candidates are
-- harvested without them, so the admin's client supplies them on approve).
DROP FUNCTION IF EXISTS public.review_daily_candidate(uuid, text);

CREATE OR REPLACE FUNCTION public.review_daily_candidate(p_id uuid, p_decision text, p_translations jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    IF p_decision NOT IN ('approved', 'rejected', 'pending') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_DECISION');
    END IF;

    UPDATE daily_challenge_candidates
    SET status = p_decision,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        category_translations = CASE
            WHEN p_decision = 'approved' AND p_translations IS NOT NULL THEN p_translations
            ELSE category_translations
        END
    WHERE id = p_id AND status <> 'used';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND_OR_USED');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.review_daily_candidate(uuid, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.review_daily_candidate(uuid, text, jsonb) TO authenticated, service_role;

-- Scheduler copies the translations onto the materialised challenge.
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
        (challenge_date, candidate_id, category, source, lat, lng, heading, pitch, zoom, boundary, start_lat, start_lng, category_translations)
    VALUES
        (today, cand.id, cand.category, cand.source, cand.lat, cand.lng, cand.heading, cand.pitch, cand.zoom,
         cand.boundary, cand.start_lat, cand.start_lng, cand.category_translations);

    UPDATE daily_challenge_candidates SET status = 'used' WHERE id = cand.id;

    RETURN jsonb_build_object('success', true, 'created', true, 'category', cand.category);
END;
$$;

ALTER FUNCTION public.ensure_daily_challenge() OWNER TO postgres;

-- Replace copies translations too.
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
        candidate_id          = cand.id,
        category              = cand.category,
        source                = cand.source,
        lat                   = cand.lat,
        lng                   = cand.lng,
        heading               = cand.heading,
        pitch                 = cand.pitch,
        zoom                  = cand.zoom,
        boundary              = cand.boundary,
        start_lat             = cand.start_lat,
        start_lng             = cand.start_lng,
        category_translations = cand.category_translations,
        created_at            = now()
    WHERE id = ch.id;

    DELETE FROM daily_attempts WHERE challenge_id = ch.id;

    RETURN jsonb_build_object('success', true, 'category', cand.category);
END;
$$;

ALTER FUNCTION public.admin_replace_daily_challenge(date) OWNER TO postgres;

-- Read RPCs expose the translations so the client can resolve per locale.
CREATE OR REPLACE FUNCTION public.get_daily_challenge(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c daily_challenges%ROWTYPE;
BEGIN
    SELECT * INTO c FROM daily_challenges WHERE challenge_date = p_date;
    IF c.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;
    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
        'id', c.id,
        'challenge_date', c.challenge_date,
        'category', c.category,
        'category_translations', c.category_translations,
        'source', c.source,
        'has_location', (c.lat IS NOT NULL),
        'boundary', c.boundary,
        'start_lat', c.start_lat,
        'start_lng', c.start_lng,
        'created_at', c.created_at
    ));
END;
$$;

ALTER FUNCTION public.get_daily_challenge(date) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_recent_daily_challenges()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    RETURN coalesce((
        SELECT jsonb_agg(r ORDER BY (r->>'challenge_date') DESC)
        FROM (
            SELECT jsonb_build_object(
                'id', dc.id,
                'challenge_date', dc.challenge_date,
                'category', dc.category,
                'category_translations', dc.category_translations,
                'source', dc.source,
                'has_location', (dc.lat IS NOT NULL),
                'players', (SELECT count(*) FROM daily_attempts a
                            WHERE a.challenge_id = dc.id AND NOT a.removed AND a.duration_ms IS NOT NULL),
                'top_time', (SELECT min(a.duration_ms) FROM daily_attempts a
                            WHERE a.challenge_id = dc.id AND NOT a.removed AND a.duration_ms IS NOT NULL),
                'my_time', (SELECT a.duration_ms FROM daily_attempts a
                            WHERE a.challenge_id = dc.id AND a.account_id = uid AND NOT a.removed),
                'my_forfeited', (SELECT a.forfeited FROM daily_attempts a
                            WHERE a.challenge_id = dc.id AND a.account_id = uid)
            ) AS r
            FROM daily_challenges dc
            WHERE dc.challenge_date > ((now() AT TIME ZONE 'utc')::date - 7)
        ) t
    ), '[]'::jsonb);
END;
$$;

ALTER FUNCTION public.get_recent_daily_challenges() OWNER TO postgres;
