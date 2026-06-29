-- =============================================================================
-- DAILY CHALLENGE — ADMIN EDIT / DELETE / RETRANSLATE
-- =============================================================================
-- Closes three gaps in the admin curation flow:
--
--   1. Language consistency. Renaming a candidate OR editing a materialised
--      challenge now (re)stores the per-locale translations the admin's client
--      computes (DeepL), so a category typed in German shows up translated in
--      every app locale instead of leaking the original into an English UI.
--   2. Remove a queued candidate outright (admin_delete_daily_candidate).
--   3. Edit a materialised challenge — today's or a past one — with an explicit
--      "also wipe that day's recorded plays" flag (the task changed, so the old
--      times no longer mean anything). admin_list_daily_challenges feeds the
--      admin a recent-challenge list to edit.
-- =============================================================================

-- 1. Candidate rename now also (re)stores translations -------------------------
-- The client passes a freshly translated map; we keep the existing one when none
-- is supplied. Re-detecting the language on every rename keeps locales in sync.
DROP FUNCTION IF EXISTS public.admin_edit_daily_candidate(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_edit_daily_candidate(p_id uuid, p_category text, p_translations jsonb DEFAULT NULL)
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

    UPDATE daily_challenge_candidates
    SET category              = nm,
        category_norm         = norm,
        category_translations = COALESCE(p_translations, category_translations)
    WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.admin_edit_daily_candidate(uuid, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_edit_daily_candidate(uuid, text, jsonb) TO authenticated, service_role;

-- 2. Remove a candidate from the queue outright --------------------------------
-- Hard-deletes a pending/approved candidate (used candidates are history and stay).
-- The owning past challenge keeps working (candidate_id ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION public.admin_delete_daily_candidate(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    DELETE FROM daily_challenge_candidates WHERE id = p_id AND status <> 'used';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND_OR_USED');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.admin_delete_daily_candidate(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_delete_daily_candidate(uuid) TO authenticated, service_role;

-- 3a. Recent materialised challenges for the admin editor ----------------------
-- Admin-gated, so it may expose the answer viewpoint (used to render a thumbnail).
CREATE OR REPLACE FUNCTION public.admin_list_daily_challenges(p_limit int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN '[]'::jsonb;
    END IF;
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'challenge_date', dc.challenge_date,
            'category', dc.category,
            'category_translations', dc.category_translations,
            'source', dc.source,
            'has_location', (dc.lat IS NOT NULL),
            'lat', dc.lat, 'lng', dc.lng,
            'heading', dc.heading, 'pitch', dc.pitch, 'zoom', dc.zoom,
            'attempts', (SELECT count(*) FROM daily_attempts a WHERE a.challenge_id = dc.id)
        ) ORDER BY dc.challenge_date DESC)
        FROM (
            SELECT * FROM daily_challenges ORDER BY challenge_date DESC LIMIT GREATEST(p_limit, 1)
        ) dc
    ), '[]'::jsonb);
END;
$$;

ALTER FUNCTION public.admin_list_daily_challenges(int) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_list_daily_challenges(int) TO authenticated, service_role;

-- 3b. Edit a materialised challenge --------------------------------------------
-- Renames the day's category + (re)stores translations. p_clear_attempts wipes
-- that day's recorded plays — the admin is asked client-side when the task changes.
CREATE OR REPLACE FUNCTION public.admin_edit_daily_challenge(
    p_date date,
    p_category text,
    p_translations jsonb DEFAULT NULL,
    p_clear_attempts boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ch      daily_challenges%ROWTYPE;
    nm      text;
    cleared int := 0;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    nm := NULLIF(trim(coalesce(p_category, '')), '');
    IF nm IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CATEGORY');
    END IF;

    SELECT * INTO ch FROM daily_challenges WHERE challenge_date = p_date;
    IF ch.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;

    UPDATE daily_challenges
    SET category              = nm,
        category_translations = COALESCE(p_translations, category_translations)
    WHERE id = ch.id;

    IF p_clear_attempts THEN
        WITH del AS (DELETE FROM daily_attempts WHERE challenge_id = ch.id RETURNING 1)
        SELECT count(*) INTO cleared FROM del;
    END IF;

    RETURN jsonb_build_object('success', true, 'cleared', cleared);
END;
$$;

ALTER FUNCTION public.admin_edit_daily_challenge(date, text, jsonb, boolean) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_edit_daily_challenge(date, text, jsonb, boolean) TO authenticated, service_role;
