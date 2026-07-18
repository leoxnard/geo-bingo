


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_friend_request"("p_requester_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    IF NOT EXISTS (SELECT 1 FROM friend_requests WHERE requester_id = p_requester_id AND addressee_id = uid) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_REQUEST');
    END IF;
    DELETE FROM friend_requests
    WHERE (requester_id = p_requester_id AND addressee_id = uid)
       OR (requester_id = uid AND addressee_id = p_requester_id);
    INSERT INTO friendships (account_id, friend_id) VALUES (uid, p_requester_id) ON CONFLICT DO NOTHING;
    INSERT INTO friendships (account_id, friend_id) VALUES (p_requester_id, uid) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('success', true, 'name', public.account_display_name(p_requester_id));
END;
$$;


ALTER FUNCTION "public"."accept_friend_request"("p_requester_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."account_display_name"("p_id" "uuid") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT coalesce(nullif(pr.username, ''), split_part(u.email, '@', 1), 'Anonymous')
    FROM auth.users u LEFT JOIN profiles pr ON pr.id = u.id
    WHERE u.id = p_id;
$$;


ALTER FUNCTION "public"."account_display_name"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_friend"("p_friend_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid        uuid := auth.uid();
    fname      text;
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    IF p_friend_id IS NULL OR p_friend_id = uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_FRIEND');
    END IF;

    SELECT coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1), 'Anonymous')
    INTO fname
    FROM auth.users u WHERE u.id = p_friend_id;
    IF fname IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    INSERT INTO friendships (account_id, friend_id) VALUES (uid, p_friend_id) ON CONFLICT DO NOTHING;
    INSERT INTO friendships (account_id, friend_id) VALUES (p_friend_id, uid) ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object('success', true, 'name', fname);
END;
$$;


ALTER FUNCTION "public"."add_friend"("p_friend_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_add_candidate"("p_category" "text", "p_source" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_start_lat" double precision DEFAULT NULL::double precision, "p_start_lng" double precision DEFAULT NULL::double precision, "p_boundary" "text" DEFAULT NULL::"text", "p_translations" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_add_candidate"("p_category" "text", "p_source" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_start_lat" double precision, "p_start_lng" double precision, "p_boundary" "text", "p_translations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_add_database_candidates"("p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_add_database_candidates"("p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_daily_candidate"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_delete_daily_candidate"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_daily_challenge"("p_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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

    IF ch.candidate_id IS NOT NULL THEN
        UPDATE daily_challenge_candidates SET status = 'approved' WHERE id = ch.candidate_id;
    END IF;

    DELETE FROM daily_attempts WHERE challenge_id = ch.id;
    DELETE FROM daily_challenges WHERE id = ch.id;

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


ALTER FUNCTION "public"."admin_delete_daily_challenge"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_pool_word"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    DELETE FROM word_pool WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_delete_pool_word"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_edit_daily_candidate"("p_id" "uuid", "p_category" "text", "p_translations" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_edit_daily_candidate"("p_id" "uuid", "p_category" "text", "p_translations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_edit_daily_challenge"("p_date" "date", "p_category" "text", "p_translations" "jsonb" DEFAULT NULL::"jsonb", "p_clear_attempts" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_edit_daily_challenge"("p_date" "date", "p_category" "text", "p_translations" "jsonb", "p_clear_attempts" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_edit_pool_word"("p_id" "uuid", "p_word" "text" DEFAULT NULL::"text", "p_language" "text" DEFAULT NULL::"text", "p_translations" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    new_word text;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    IF p_word IS NOT NULL THEN
        new_word := btrim(p_word);
        IF char_length(new_word) NOT BETWEEN 1 AND 80 THEN
            RETURN jsonb_build_object('success', false, 'error', 'BAD_WORD');
        END IF;
    END IF;
    IF p_language IS NOT NULL AND p_language NOT IN ('german', 'english', 'spanish', 'french', 'chinese') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_LANGUAGE');
    END IF;

    BEGIN
        UPDATE word_pool
        SET word = coalesce(new_word, word),
            word_norm = lower(coalesce(new_word, word)),
            language = coalesce(p_language, language),
            translations = CASE WHEN jsonb_typeof(p_translations) = 'object' THEN p_translations ELSE translations END
        WHERE id = p_id;
    EXCEPTION WHEN unique_violation THEN
        -- The (word, language) pair already exists as another row; the admin
        -- deletes one copy instead (counter merging is a later enhancement).
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE');
    END;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_edit_pool_word"("p_id" "uuid", "p_word" "text", "p_language" "text", "p_translations" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."daily_challenge_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "category_norm" "text" NOT NULL,
    "source" "text" NOT NULL,
    "source_ref" "text",
    "lat" double precision,
    "lng" double precision,
    "heading" double precision,
    "pitch" double precision,
    "zoom" double precision,
    "boundary" "text",
    "start_lat" double precision,
    "start_lng" double precision,
    "is_fallback" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "sort_order" double precision,
    "category_translations" "jsonb"
);


ALTER TABLE "public"."daily_challenge_candidates" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_daily_candidates"("p_status" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."daily_challenge_candidates"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_list_daily_candidates"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_daily_challenges"("p_limit" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_list_daily_challenges"("p_limit" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."word_pool" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "word" "text" NOT NULL,
    "word_norm" "text" NOT NULL,
    "language" "text" DEFAULT 'english'::"text" NOT NULL,
    "translations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "games_count" integer DEFAULT 0 NOT NULL,
    "found_count" integer DEFAULT 0 NOT NULL,
    "import_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "text",
    CONSTRAINT "word_pool_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "word_pool_word_check" CHECK ((("char_length"("word") >= 1) AND ("char_length"("word") <= 80)))
);


ALTER TABLE "public"."word_pool" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_pool_words"("p_status" "text" DEFAULT NULL::"text", "p_language" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."word_pool"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT * FROM word_pool w
    WHERE (p_status IS NULL OR w.status = p_status)
      AND (p_language IS NULL OR w.language = p_language)
      AND (p_search IS NULL OR btrim(p_search) = '' OR w.word_norm ILIKE '%' || lower(btrim(p_search)) || '%')
    ORDER BY w.created_at DESC
    LIMIT 1000;
END;
$$;


ALTER FUNCTION "public"."admin_list_pool_words"("p_status" "text", "p_language" "text", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reorder_daily_candidates"("p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_reorder_daily_candidates"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_replace_daily_challenge"("p_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."admin_replace_daily_challenge"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_pool_word"("p_id" "uuid", "p_action" "text", "p_translations" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    IF p_action NOT IN ('approved', 'rejected') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_ACTION');
    END IF;

    UPDATE word_pool
    SET status = p_action,
        reviewed_at = now(),
        reviewed_by = auth.jwt() ->> 'email',
        translations = CASE WHEN jsonb_typeof(p_translations) = 'object' THEN p_translations ELSE translations END
    WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_review_pool_word"("p_id" "uuid", "p_action" "text", "p_translations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_run_daily_scheduler"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    RETURN public.ensure_daily_challenge();
END;
$$;


ALTER FUNCTION "public"."admin_run_daily_scheduler"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_pool_word_translations"("p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    updated int;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_ITEMS');
    END IF;

    WITH cleaned AS (
        SELECT (elem ->> 'id')::uuid AS id, elem -> 'translations' AS tr
        FROM jsonb_array_elements(p_items) AS t(elem)
        WHERE jsonb_typeof(elem -> 'translations') = 'object'
    ),
    upd AS (
        UPDATE word_pool w
        SET translations = cleaned.tr
        FROM cleaned
        WHERE w.id = cleaned.id
        RETURNING 1
    )
    SELECT count(*) INTO updated FROM upd;

    RETURN jsonb_build_object('success', true, 'updated', updated);
END;
$$;


ALTER FUNCTION "public"."admin_set_pool_word_translations"("p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."am_i_daily_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM daily_admins
        WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;


ALTER FUNCTION "public"."am_i_daily_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_stale_games"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    deleted_count integer;
BEGIN
    WITH deleted AS (
        DELETE FROM public.games
        WHERE updated_at < now() - interval '24 hours'
        RETURNING id
    )
    SELECT count(*) INTO deleted_count FROM deleted;
    RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_stale_games"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    DELETE FROM submissions WHERE game_id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_community_preset"("p_name" "text", "p_description" "text", "p_author_name" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller uuid := auth.uid();
    cat_count int;
    safe_mode text;
    safe_grid int;
    safe_diff text;
    new_row community_presets;
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'EMPTY_NAME');
    END IF;

    IF jsonb_typeof(p_categories) <> 'array' OR jsonb_array_length(p_categories) < 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CATEGORIES');
    END IF;

    cat_count := jsonb_array_length(p_categories);

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_categories) c
        WHERE c->>'categoryName' IS NULL OR c->>'lat' IS NULL OR c->>'lng' IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_MISSING_VIEW');
    END IF;

    IF (
        SELECT count(DISTINCT lower(c->>'categoryName')) FROM jsonb_array_elements(p_categories) c
    ) <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_CATEGORY');
    END IF;

    safe_diff := CASE WHEN p_difficulty IN ('easy', 'medium', 'hard') THEN p_difficulty ELSE 'medium' END;
    safe_mode := CASE WHEN p_game_mode = 'bingo' THEN 'bingo' ELSE 'list' END;
    safe_grid := COALESCE(p_grid_size, 3);

    IF safe_mode = 'bingo' AND safe_grid * safe_grid <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'BINGO_GRID_MISMATCH');
    END IF;

    INSERT INTO community_presets (
        author_id, author_name, name, description, categories, boundaries,
        starting_point, category_count, recommended_time, difficulty, game_mode, grid_size,
        settings, icon, category_translations, title_translations, description_translations,
        category_hint_translations
    )
    VALUES (
        caller,
        NULLIF(trim(coalesce(p_author_name, '')), ''),
        trim(p_name),
        NULLIF(trim(coalesce(p_description, '')), ''),
        p_categories,
        COALESCE(p_boundaries, '[]'::jsonb),
        COALESCE(NULLIF(trim(p_starting_point), ''), 'open-world'),
        cat_count,
        p_recommended_time,
        safe_diff,
        safe_mode,
        safe_grid,
        COALESCE(p_settings, '{}'::jsonb),
        NULLIF(trim(coalesce(p_icon, '')), ''),
        COALESCE(p_category_translations, '{}'::jsonb),
        COALESCE(p_title_translations, '{}'::jsonb),
        COALESCE(p_description_translations, '{}'::jsonb),
        COALESCE(p_category_hint_translations, '{}'::jsonb)
    )
    RETURNING * INTO new_row;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(new_row));
END;
$$;


ALTER FUNCTION "public"."create_community_preset"("p_name" "text", "p_description" "text", "p_author_name" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."daily_caller_name"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
    SELECT coalesce(
        NULLIF(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', '')), ''),
        NULLIF(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
        'Anonymous'
    );
$$;


ALTER FUNCTION "public"."daily_caller_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_friend_request"("p_requester_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    DELETE FROM friend_requests WHERE requester_id = p_requester_id AND addressee_id = uid;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."decline_friend_request"("p_requester_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller uuid := auth.uid();
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    DELETE FROM community_presets WHERE id = p_preset_id AND author_id = caller;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_OWNER_OR_MISSING');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_my_account"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller uuid := auth.uid();
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    DELETE FROM community_presets    WHERE author_id = caller;
    DELETE FROM daily_attempts       WHERE account_id = caller;
    DELETE FROM account_game_results WHERE account_id = caller;
    DELETE FROM game_invitations     WHERE inviter_id = caller OR invitee_id = caller;
    DELETE FROM friend_requests      WHERE requester_id = caller OR addressee_id = caller;
    DELETE FROM friendships          WHERE account_id = caller OR friend_id = caller;
    DELETE FROM profiles             WHERE id = caller;

    DELETE FROM auth.users WHERE id = caller;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_my_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_game_id text;
    remaining      int;
    ready_here     int;
BEGIN
    SELECT game_id INTO target_game_id FROM players WHERE id = p_id;
    IF target_game_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PLAYER_NOT_FOUND');
    END IF;
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(target_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    DELETE FROM players WHERE id = p_id;

    -- Keep the ready set consistent with who is actually still here.
    UPDATE games SET ready_players = array_remove(COALESCE(ready_players, '{}'::text[]), p_id::text)
    WHERE id = target_game_id;

    -- If everyone remaining already voted to end the round, advance to voting
    -- (resetting the voting cursor, like the vote RPCs do).
    SELECT count(*) INTO remaining FROM players WHERE game_id = target_game_id;
    SELECT count(*) INTO ready_here
    FROM players p
    WHERE p.game_id = target_game_id
      AND p.id::text = ANY (COALESCE((SELECT ready_players FROM games WHERE id = target_game_id), '{}'::text[]));

    IF remaining > 0 AND ready_here >= remaining THEN
        UPDATE games SET status = 'voting', voting_round_index = 0, voting_active_sub_id = NULL
        WHERE id = target_game_id AND status = 'playing';
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    DELETE FROM submissions WHERE id = p_id AND player_id = p_player_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_OWNER_OR_MISSING');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dismiss_game_invitation"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    DELETE FROM game_invitations WHERE id = p_id AND invitee_id = uid;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."dismiss_game_invitation"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."downvote_daily_find"("p_attempt_id" "uuid", "p_device_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    cid uuid;
    author uuid;
    has_vote boolean;
    dvotes int;
    completers int;
    flag boolean;
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_DEVICE');
    END IF;

    SELECT challenge_id, account_id, (downvoters ? p_device_id)
    INTO cid, author, has_vote
    FROM daily_attempts WHERE id = p_attempt_id FOR UPDATE;

    IF cid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    IF has_vote THEN
        UPDATE daily_attempts SET downvoters = downvoters - p_device_id WHERE id = p_attempt_id;
    ELSE
        UPDATE daily_attempts
        SET downvoters = jsonb_set(coalesce(downvoters, '{}'::jsonb), array[p_device_id], 'true'::jsonb)
        WHERE id = p_attempt_id;
    END IF;

    SELECT count(*) INTO dvotes
    FROM jsonb_object_keys((SELECT downvoters FROM daily_attempts WHERE id = p_attempt_id));

    SELECT count(*) INTO completers
    FROM daily_attempts
    WHERE challenge_id = cid AND duration_ms IS NOT NULL AND account_id <> author;

    flag := (dvotes >= 3 AND dvotes >= ceil(0.9 * GREATEST(completers, 1)));

    UPDATE daily_attempts SET downvotes = dvotes, removed = flag WHERE id = p_attempt_id;

    RETURN jsonb_build_object('success', true, 'downvotes', dvotes, 'removed', flag, 'my_downvote', NOT has_vote);
END;
$$;


ALTER FUNCTION "public"."downvote_daily_find"("p_attempt_id" "uuid", "p_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_daily_challenge"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."ensure_daily_challenge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forfeit_daily_attempt"("p_date" "date", "p_device_id" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
    cid uuid;
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    SELECT id INTO cid FROM daily_challenges WHERE challenge_date = p_date;
    IF cid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;

    INSERT INTO daily_attempts (challenge_id, account_id, device_id, player_name, forfeited)
    VALUES (cid, uid, p_device_id, public.daily_caller_name(), true)
    ON CONFLICT (challenge_id, account_id) DO NOTHING;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."forfeit_daily_attempt"("p_date" "date", "p_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_challenge"("p_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_daily_challenge"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_finds"("p_date" "date", "p_device_id" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
    cid uuid;
BEGIN
    SELECT id INTO cid FROM daily_challenges WHERE challenge_date = p_date;
    IF cid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;

    IF uid IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM daily_attempts WHERE challenge_id = cid AND account_id = uid
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_SUBMITTED');
    END IF;

    RETURN jsonb_build_object('success', true, 'data', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'id', a.id,
            'name', coalesce(
                nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
                nullif(split_part(u.email, '@', 1), ''),
                a.player_name,
                'Anonymous'
            ),
            'duration_ms', a.duration_ms,
            'lat', a.found_lat, 'lng', a.found_lng,
            'heading', a.found_heading, 'pitch', a.found_pitch, 'zoom', a.found_zoom,
            'downvotes', a.downvotes,
            'my_downvote', (a.downvoters ? p_device_id)
        ) ORDER BY a.duration_ms ASC NULLS LAST)
        FROM daily_attempts a
        LEFT JOIN auth.users u ON u.id = a.account_id
        WHERE a.challenge_id = cid AND NOT a.removed AND a.duration_ms IS NOT NULL
    ), '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."get_daily_finds"("p_date" "date", "p_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_leaderboard"("p_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'rank', rn, 'name', disp_name, 'duration_ms', duration_ms,
            'created_at', created_at, 'mine', is_mine
        ) ORDER BY rn)
        FROM (
            SELECT
                coalesce(
                    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
                    nullif(split_part(u.email, '@', 1), ''),
                    a.player_name,
                    'Anonymous'
                ) AS disp_name,
                a.duration_ms, a.created_at,
                (uid IS NOT NULL AND a.account_id = uid) AS is_mine,
                row_number() OVER (ORDER BY a.duration_ms ASC, a.created_at ASC) AS rn
            FROM daily_attempts a
            JOIN daily_challenges dc ON dc.id = a.challenge_id
            LEFT JOIN auth.users u ON u.id = a.account_id
            WHERE dc.challenge_date = p_date AND NOT a.removed AND a.duration_ms IS NOT NULL
        ) ranked
        WHERE rn <= 100
    ), '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_daily_leaderboard"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_friends_with_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    RETURN jsonb_build_object('success', true, 'data', coalesce((
        SELECT jsonb_agg(row_to_json(f) ORDER BY lower(f.name))
        FROM (
            SELECT
                fr.friend_id AS id,
                coalesce(nullif(pr.username, ''), split_part(u.email, '@', 1), 'Anonymous') AS name,
                (SELECT count(*) FROM account_game_results r WHERE r.account_id = fr.friend_id) AS games_played,
                (SELECT count(*) FROM account_game_results r WHERE r.account_id = fr.friend_id AND r.won) AS games_won,
                (SELECT coalesce(sum(r.categories_found), 0) FROM account_game_results r WHERE r.account_id = fr.friend_id) AS categories_found,
                (SELECT count(*) FROM daily_attempts a WHERE a.account_id = fr.friend_id AND NOT a.removed AND a.duration_ms IS NOT NULL) AS daily_completed
            FROM friendships fr
            JOIN auth.users u ON u.id = fr.friend_id
            LEFT JOIN profiles pr ON pr.id = fr.friend_id
            WHERE fr.account_id = uid
        ) f
    ), '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."get_friends_with_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_incoming_friend_requests"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    RETURN jsonb_build_object('success', true, 'data', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC)
        FROM (
            SELECT fr.requester_id AS id, public.account_display_name(fr.requester_id) AS name, fr.created_at
            FROM friend_requests fr WHERE fr.addressee_id = uid
        ) r
    ), '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."get_incoming_friend_requests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_account_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
    r   record;
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    SELECT
        count(*)                                                       AS games_played,
        coalesce(sum(CASE WHEN won THEN 1 ELSE 0 END), 0)              AS games_won,
        coalesce(sum(CASE WHEN player_count >= 2 THEN 1 ELSE 0 END), 0) AS multiplayer_played,
        coalesce(sum(CASE WHEN won AND player_count >= 2 THEN 1 ELSE 0 END), 0) AS multiplayer_won,
        coalesce(sum(categories_found), 0)                             AS categories_found,
        coalesce(sum(jsonb_array_length(finds)), 0)                    AS finds_count
    INTO r
    FROM account_game_results
    WHERE account_id = uid;

    RETURN jsonb_build_object(
        'success', true,
        'games_played', r.games_played,
        'games_won', r.games_won,
        'multiplayer_played', r.multiplayer_played,
        'multiplayer_won', r.multiplayer_won,
        'categories_found', r.categories_found,
        'finds_count', r.finds_count
    );
END;
$$;


ALTER FUNCTION "public"."get_my_account_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_daily_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
    completed int;
    won int;
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    SELECT count(*) INTO completed
    FROM daily_attempts a
    WHERE a.account_id = uid AND NOT a.removed AND a.duration_ms IS NOT NULL;

    SELECT count(*) INTO won
    FROM daily_attempts a
    WHERE a.account_id = uid AND NOT a.removed AND a.duration_ms IS NOT NULL
      AND a.duration_ms = (
          SELECT min(b.duration_ms) FROM daily_attempts b
          WHERE b.challenge_id = a.challenge_id AND NOT b.removed AND b.duration_ms IS NOT NULL
      );

    RETURN jsonb_build_object('success', true, 'completed', completed, 'won', won);
END;
$$;


ALTER FUNCTION "public"."get_my_daily_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_game_history"("p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    RETURN jsonb_build_object('success', true, 'data', coalesce((
        SELECT jsonb_agg(row_to_json(h) ORDER BY h.finished_at DESC)
        FROM (
            SELECT id, game_mode, team_mode, placement, player_count,
                   score, categories_found, won, finished_at
            FROM account_game_results
            WHERE account_id = uid
            ORDER BY finished_at DESC
            LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
        ) h
    ), '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."get_my_game_history"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_game_invitations"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    RETURN jsonb_build_object('success', true, 'data', coalesce((
        SELECT jsonb_agg(row_to_json(i) ORDER BY i.created_at DESC)
        FROM (
            SELECT gi.id,
                   gi.game_id,
                   gi.inviter_id,
                   public.account_display_name(gi.inviter_id) AS inviter_name,
                   gi.created_at
            FROM game_invitations gi
            WHERE gi.invitee_id = uid
              AND gi.created_at > now() - interval '2 minutes'
        ) i
    ), '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."get_my_game_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_outgoing_friend_requests"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    RETURN jsonb_build_object('success', true, 'data', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC)
        FROM (
            SELECT fr.addressee_id AS id, public.account_display_name(fr.addressee_id) AS name, fr.created_at
            FROM friend_requests fr WHERE fr.requester_id = uid
        ) r
    ), '[]'::jsonb));
END;
$$;


ALTER FUNCTION "public"."get_outgoing_friend_requests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_recent_daily_challenges"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_recent_daily_challenges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."harvest_daily_candidates"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    BEGIN
        INSERT INTO daily_challenge_candidates
            (category, category_norm, source, source_ref, lat, lng, heading, pitch, zoom, boundary)
        SELECT DISTINCT ON (lower(trim(s.category)))
            s.category,
            lower(trim(s.category)),
            'game',
            NEW.id,
            s.lat, s.lng, s.heading, s.pitch, s.zoom,
            NEW."gameBoundary"
        FROM submissions s
        WHERE s.game_id = NEW.id
          AND s.lat IS NOT NULL AND s.lng IS NOT NULL
          AND s.ai_verdict = true
          AND public.votes_all_yes(s.votes)
        ORDER BY lower(trim(s.category))
        ON CONFLICT (category_norm) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        -- harvesting is best-effort; swallow any error so the game flow is unaffected
        NULL;
    END;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."harvest_daily_candidates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."harvest_pool_words"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    src_language text;
    word_status text;
BEGIN
    BEGIN
        -- Nearby-source boards name hyper-local features; never harvest them.
        IF NEW.category_source IN ('nearbyPlaces', 'nearbyStreetView') THEN
            RETURN NEW;
        END IF;

        -- Once per round (a rematch re-stamps phase_started_at, so it passes).
        IF NEW.words_harvested_at IS NOT NULL
           AND NEW.phase_started_at IS NOT NULL
           AND NEW.words_harvested_at >= NEW.phase_started_at THEN
            RETURN NEW;
        END IF;

        -- Quality gates: a real round, actually played out.
        -- Elapsed time is measured from the playing transition and includes
        -- voting time (there is no voting_started_at column) — acceptable,
        -- the admin queue is the real gate.
        IF NEW.phase_started_at IS NULL
           OR now() - NEW.phase_started_at
              < LEAST(make_interval(secs => coalesce(NEW.time_limit, 600)), interval '5 minutes') THEN
            RETURN NEW;
        END IF;
        IF (SELECT count(*) FROM players WHERE game_id = NEW.id) < 2 THEN
            RETURN NEW;
        END IF;
        IF (SELECT count(DISTINCT lower(btrim(w)))
            FROM jsonb_array_elements_text(coalesce(NEW.categories, '[]'::jsonb)) AS t(w)
            WHERE btrim(w) <> '') < 4 THEN
            RETURN NEW;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM submissions s
            WHERE s.game_id = NEW.id AND public.submission_is_valid(s.votes)
        ) THEN
            RETURN NEW;
        END IF;

        src_language := coalesce(nullif(NEW.language, ''), 'english');
        -- Only manually-typed words need admin review; AI words are pre-vetted
        -- by generation + this round's quality gates.
        word_status := CASE WHEN NEW.category_source = 'ai' THEN 'approved' ELSE 'pending' END;

        INSERT INTO word_pool (word, word_norm, language, status, games_count, found_count)
        SELECT DISTINCT ON (lower(btrim(w)))
            btrim(w),
            lower(btrim(w)),
            src_language,
            word_status,
            1,
            CASE WHEN EXISTS (
                SELECT 1 FROM submissions s
                WHERE s.game_id = NEW.id
                  AND lower(btrim(s.category)) = lower(btrim(w))
                  AND public.submission_is_valid(s.votes)
            ) THEN 1 ELSE 0 END
        FROM jsonb_array_elements_text(NEW.categories) AS t(w)
        WHERE btrim(w) <> '' AND char_length(btrim(w)) <= 80
        ORDER BY lower(btrim(w))
        ON CONFLICT (word_norm, language) DO UPDATE
        SET games_count = word_pool.games_count + 1,
            found_count = word_pool.found_count + EXCLUDED.found_count;

        -- Plain column update — does not re-fire the UPDATE OF status triggers.
        UPDATE games SET words_harvested_at = now() WHERE id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
        -- harvesting is best-effort; swallow any error so the game flow is unaffected
        NULL;
    END;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."harvest_pool_words"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_pool_words"("p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) > 50 THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_IDS');
    END IF;

    UPDATE word_pool
    SET import_count = import_count + 1
    WHERE status = 'approved' AND id = ANY (p_ids);

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."import_pool_words"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM game_host_secrets
        WHERE game_id = p_game_id AND p_token IS NOT NULL AND host_token = p_token
    );
$$;


ALTER FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid" DEFAULT NULL::"uuid", "p_bingo_board" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_status text;
    target_banned text[];
BEGIN
    SELECT status, COALESCE(banned_players, '{}'::text[])
    INTO target_status, target_banned
    FROM games WHERE id = p_game_id;

    IF target_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'GAME_NOT_FOUND');
    END IF;

    IF p_player_id::text = ANY(target_banned) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BANNED');
    END IF;

    -- Rejoin: this player already belongs to the game (refresh / reconnect).
    -- Keep it idempotent so we never create a duplicate row.
    IF EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        UPDATE players SET
            name        = COALESCE(NULLIF(p_name, ''), name),
            account_id  = COALESCE(account_id, p_account_id),
            bingo_board = CASE
                WHEN p_bingo_board IS NOT NULL AND (bingo_board IS NULL OR jsonb_array_length(bingo_board) = 0)
                    THEN p_bingo_board
                ELSE bingo_board
            END
        WHERE id = p_player_id;
        RETURN jsonb_build_object('success', true, 'rejoined', true);
    END IF;

    -- New registration. A finished game is spectate-only: no row, but no error.
    IF target_status = 'finished' THEN
        RETURN jsonb_build_object('success', true, 'spectator', true);
    END IF;

    INSERT INTO players (id, game_id, name, account_id, bingo_board)
    VALUES (p_player_id, p_game_id, NULLIF(p_name, ''), p_account_id, COALESCE(p_bingo_board, '[]'::jsonb))
    ON CONFLICT (id) DO UPDATE SET
        game_id     = EXCLUDED.game_id,
        name        = COALESCE(EXCLUDED.name, players.name),
        account_id  = COALESCE(players.account_id, EXCLUDED.account_id),
        bingo_board = CASE
            WHEN EXCLUDED.bingo_board IS NOT NULL AND jsonb_array_length(EXCLUDED.bingo_board) > 0
                THEN EXCLUDED.bingo_board
            ELSE players.bingo_board
        END;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    UPDATE games SET status = 'voting', voting_round_index = 0, voting_active_sub_id = NULL
    WHERE id = p_game_id AND status = 'playing';

    -- If the game wasn't in 'playing' the UPDATE matches zero rows; that's
    -- fine — it means someone else already advanced it (or the host is
    -- finishing manually). No error, just no-op.

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    new_ready    text[];
    total_players int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    -- Lock the game row so concurrent voters serialise; without this, two votes
    -- arriving together each read the old ready_players and one overwrites the
    -- other.
    PERFORM 1 FROM games WHERE id = p_game_id FOR UPDATE;

    -- Dedupe-append: union the (now locked) ready_players array with the caller.
    SELECT ARRAY(SELECT DISTINCT unnest(
        COALESCE((SELECT ready_players FROM games WHERE id = p_game_id), '{}'::text[])
        || ARRAY[p_player_id::text]
    )) INTO new_ready;

    SELECT count(*)::int INTO total_players FROM players WHERE game_id = p_game_id;

    IF array_length(new_ready, 1) >= total_players THEN
        UPDATE games SET ready_players = new_ready, status = 'voting',
            voting_round_index = 0, voting_active_sub_id = NULL
        WHERE id = p_game_id AND status = 'playing';
    ELSE
        UPDATE games SET ready_players = new_ready WHERE id = p_game_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'ready_count', array_length(new_ready, 1), 'total_players', total_players);
END;
$$;


ALTER FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_my_game_result"("p_game_id" "text", "p_player_id" "uuid", "p_game_mode" "text", "p_team_mode" "text", "p_placement" integer, "p_player_count" integer, "p_score" numeric, "p_categories_found" integer, "p_won" boolean, "p_finds" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid          uuid := auth.uid();
    g            record;
    real_count   int;
    safe_finds   jsonb;
    clamped_pos  int;
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    SELECT status, coalesce(finished_at, now()) AS finished_at INTO g
    FROM games WHERE id = p_game_id;
    IF NOT FOUND OR g.status <> 'finished' THEN
        RETURN jsonb_build_object('success', false, 'error', 'GAME_NOT_FINISHED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_IN_GAME');
    END IF;

    SELECT count(*) INTO real_count FROM players WHERE game_id = p_game_id;

    safe_finds := CASE WHEN jsonb_typeof(p_finds) = 'array' THEN p_finds ELSE '[]'::jsonb END;
    IF jsonb_array_length(safe_finds) > 200 THEN
        safe_finds := (SELECT jsonb_agg(e) FROM (
            SELECT e FROM jsonb_array_elements(safe_finds) e LIMIT 200
        ) s);
    END IF;
    clamped_pos := greatest(1, least(coalesce(p_placement, real_count), real_count));

    INSERT INTO account_game_results (
        account_id, game_id, finished_at, game_mode, team_mode,
        placement, player_count, score, categories_found, won, finds
    ) VALUES (
        uid, p_game_id, g.finished_at, p_game_mode, p_team_mode,
        clamped_pos, real_count, p_score, greatest(0, coalesce(p_categories_found, 0)),
        coalesce(p_won, false), safe_finds
    )
    ON CONFLICT (account_id, game_id, finished_at) DO NOTHING;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."record_my_game_result"("p_game_id" "text", "p_player_id" "uuid", "p_game_mode" "text", "p_team_mode" "text", "p_placement" integer, "p_player_count" integer, "p_score" numeric, "p_categories_found" integer, "p_won" boolean, "p_finds" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_host_secret"("p_game_id" "text", "p_player_id" "text", "p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_player_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    -- Upsert: the rightful host (host_id == caller) can always (re)claim the
    -- secret, repairing a missing/mismatched server secret after a transfer.
    INSERT INTO game_host_secrets (game_id, host_token)
    VALUES (p_game_id, p_token)
    ON CONFLICT (game_id) DO UPDATE SET host_token = EXCLUDED.host_token;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."register_host_secret"("p_game_id" "text", "p_player_id" "text", "p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_hype"("p_submission_id" "uuid", "p_player_id" "text", "p_hype" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    sub_game text;
BEGIN
    SELECT game_id INTO sub_game FROM submissions WHERE id = p_submission_id;
    IF sub_game IS NULL THEN
        RETURN; -- no such submission; nothing to hype
    END IF;

    -- The hyper must be a player in the same game as the submission.
    IF NOT EXISTS (SELECT 1 FROM players WHERE id::text = p_player_id AND game_id = sub_game) THEN
        RETURN; -- reject hypes from non-members / arbitrary keys
    END IF;

    UPDATE submissions
    SET votes = jsonb_set(COALESCE(votes, '{}'::jsonb), array['hype:' || p_player_id], to_jsonb(p_hype))
    WHERE id = p_submission_id;
END;
$$;


ALTER FUNCTION "public"."register_hype"("p_submission_id" "uuid", "p_player_id" "text", "p_hype" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_scale_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_value" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    sub_game text;
    clamped  integer;
BEGIN
    SELECT game_id INTO sub_game FROM submissions WHERE id = p_submission_id;
    IF sub_game IS NULL THEN
        RETURN; -- no such submission; nothing to vote on
    END IF;

    -- The voter must be a player in the same game as the submission.
    IF NOT EXISTS (SELECT 1 FROM players WHERE id::text = p_player_id AND game_id = sub_game) THEN
        RETURN; -- reject votes from non-members / arbitrary voter keys
    END IF;

    clamped := LEAST(10, GREATEST(0, p_value));

    UPDATE submissions
    SET votes = jsonb_set(COALESCE(votes, '{}'::jsonb), array[p_player_id], to_jsonb(clamped))
    WHERE id = p_submission_id;
END;
$$;


ALTER FUNCTION "public"."register_scale_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_value" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    sub_game text;
BEGIN
    SELECT game_id INTO sub_game FROM submissions WHERE id = p_submission_id;
    IF sub_game IS NULL THEN
        RETURN; -- no such submission; nothing to vote on
    END IF;

    -- The voter must be a player in the same game as the submission.
    IF NOT EXISTS (SELECT 1 FROM players WHERE id::text = p_player_id AND game_id = sub_game) THEN
        RETURN; -- reject votes from non-members / arbitrary voter keys
    END IF;

    UPDATE submissions
    SET votes = jsonb_set(COALESCE(votes, '{}'::jsonb), array[p_player_id], to_jsonb(p_vote))
    WHERE id = p_submission_id;
END;
$$;


ALTER FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_friend"("p_friend_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    DELETE FROM friendships
    WHERE (account_id = uid AND friend_id = p_friend_id)
       OR (account_id = p_friend_id AND friend_id = uid);
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."remove_friend"("p_friend_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_my_presets_author"("p_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."rename_my_presets_author"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reveal_daily_location"("p_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    c daily_challenges%ROWTYPE;
BEGIN
    SELECT * INTO c FROM daily_challenges WHERE challenge_date = p_date;
    IF c.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;
    IF c.lat IS NULL THEN
        RETURN jsonb_build_object('success', true, 'has_location', false);
    END IF;
    RETURN jsonb_build_object('success', true, 'has_location', true, 'data', jsonb_build_object(
        'lat', c.lat, 'lng', c.lng, 'heading', c.heading, 'pitch', c.pitch, 'zoom', c.zoom
    ));
END;
$$;


ALTER FUNCTION "public"."reveal_daily_location"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_daily_candidate"("p_id" "uuid", "p_decision" "text", "p_translations" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."review_daily_candidate"("p_id" "uuid", "p_decision" "text", "p_translations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_friend_request"("p_addressee_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid   uuid := auth.uid();
    aname text;
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    IF p_addressee_id IS NULL OR p_addressee_id = uid THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID'); END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_addressee_id) THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND'); END IF;
    aname := public.account_display_name(p_addressee_id);
    IF EXISTS (SELECT 1 FROM friendships WHERE account_id = uid AND friend_id = p_addressee_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ALREADY_FRIENDS', 'name', aname);
    END IF;
    IF EXISTS (SELECT 1 FROM friend_requests WHERE requester_id = p_addressee_id AND addressee_id = uid) THEN
        DELETE FROM friend_requests
        WHERE (requester_id = p_addressee_id AND addressee_id = uid)
           OR (requester_id = uid AND addressee_id = p_addressee_id);
        INSERT INTO friendships (account_id, friend_id) VALUES (uid, p_addressee_id) ON CONFLICT DO NOTHING;
        INSERT INTO friendships (account_id, friend_id) VALUES (p_addressee_id, uid) ON CONFLICT DO NOTHING;
        RETURN jsonb_build_object('success', true, 'status', 'accepted', 'name', aname);
    END IF;
    INSERT INTO friend_requests (requester_id, addressee_id) VALUES (uid, p_addressee_id)
        ON CONFLICT (requester_id, addressee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'status', 'requested', 'name', aname);
END;
$$;


ALTER FUNCTION "public"."send_friend_request"("p_addressee_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_friend_request_by_username"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid    uuid := auth.uid();
    target uuid;
    u      text := btrim(coalesce(p_username, ''));
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    SELECT id INTO target FROM profiles WHERE lower(username) = lower(u);
    IF target IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND'); END IF;
    RETURN public.send_friend_request(target);
END;
$$;


ALTER FUNCTION "public"."send_friend_request_by_username"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_game_invitation"("p_game_id" "text", "p_invitee_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    IF p_game_id IS NULL OR btrim(p_game_id) = '' OR p_invitee_id IS NULL OR p_invitee_id = uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM friendships WHERE account_id = uid AND friend_id = p_invitee_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FRIENDS');
    END IF;

    DELETE FROM game_invitations WHERE created_at < now() - interval '2 minutes';

    INSERT INTO game_invitations (game_id, inviter_id, invitee_id)
    VALUES (p_game_id, uid, p_invitee_id)
    ON CONFLICT (inviter_id, invitee_id, game_id) DO UPDATE SET created_at = now();

    RETURN jsonb_build_object('success', true, 'name', public.account_display_name(p_invitee_id));
END;
$$;


ALTER FUNCTION "public"."send_game_invitation"("p_game_id" "text", "p_invitee_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF p_status NOT IN ('lobby', 'playing', 'voting', 'finished') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_STATUS');
    END IF;
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games
    SET status = p_status,
        phase_started_at = CASE WHEN p_status = 'playing' AND status IS DISTINCT FROM 'playing' THEN now() ELSE phase_started_at END,
        finished_at = CASE WHEN p_status = 'finished' THEN now() ELSE finished_at END,
        voting_round_index = CASE WHEN p_status IN ('voting', 'lobby') THEN 0 ELSE voting_round_index END,
        voting_active_sub_id = CASE WHEN p_status IN ('voting', 'lobby') THEN NULL ELSE voting_active_sub_id END
    WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE submissions
    SET ai_verdict = p_verdict, ai_verified_hash = p_hash
    WHERE id = p_id AND player_id = p_player_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_OWNER_OR_MISSING');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_username"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
    u   text := btrim(coalesce(p_username, ''));
BEGIN
    IF uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    IF length(u) < 2 OR length(u) > 30 THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID'); END IF;
    IF EXISTS (SELECT 1 FROM profiles WHERE lower(username) = lower(u) AND id <> uid) THEN
        RETURN jsonb_build_object('success', false, 'error', 'TAKEN');
    END IF;
    INSERT INTO profiles (id, username) VALUES (uid, u)
        ON CONFLICT (id) DO UPDATE SET username = excluded.username;
    UPDATE community_presets SET author_name = u WHERE author_id = uid;
    RETURN jsonb_build_object('success', true, 'username', u);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TAKEN');
END;
$$;


ALTER FUNCTION "public"."set_username"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games
    SET voting_round_index = p_round_index,
        voting_active_sub_id = p_active_sub_id
    WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submission_is_valid"("p_votes" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
    SELECT CASE
        WHEN count(*) FILTER (WHERE jsonb_typeof(value) = 'boolean') > 0
            THEN count(*) FILTER (WHERE value = to_jsonb(true)) * 2
                 > count(*) FILTER (WHERE jsonb_typeof(value) = 'boolean')
        WHEN count(*) FILTER (WHERE jsonb_typeof(value) = 'number') > 0
            THEN (avg((value #>> '{}')::numeric) FILTER (WHERE jsonb_typeof(value) = 'number')) >= 6
        ELSE false
    END
    FROM jsonb_each(coalesce(p_votes, '{}'::jsonb))
    WHERE key NOT LIKE 'hype:%' AND key <> 'host_continued';
$$;


ALTER FUNCTION "public"."submission_is_valid"("p_votes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_daily_attempt"("p_date" "date", "p_device_id" "text", "p_duration_ms" bigint, "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_ai_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    uid uuid := auth.uid();
    cid uuid;
    cdate date;
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    SELECT id, challenge_date INTO cid, cdate FROM daily_challenges WHERE challenge_date = p_date;
    IF cid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;
    IF cdate < ((now() AT TIME ZONE 'utc')::date - 7) THEN
        RETURN jsonb_build_object('success', false, 'error', 'CHALLENGE_EXPIRED');
    END IF;
    IF p_duration_ms IS NULL OR p_duration_ms <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_DURATION');
    END IF;

    INSERT INTO daily_attempts
        (challenge_id, account_id, device_id, player_name, duration_ms, forfeited,
         found_lat, found_lng, found_heading, found_pitch, found_zoom, ai_reason)
    VALUES
        (cid, uid, p_device_id, public.daily_caller_name(), p_duration_ms, false,
         p_lat, p_lng, p_heading, p_pitch, p_zoom, p_ai_reason)
    ON CONFLICT (challenge_id, account_id) DO UPDATE SET
        duration_ms   = EXCLUDED.duration_ms,
        forfeited     = false,
        found_lat     = EXCLUDED.found_lat,
        found_lng     = EXCLUDED.found_lng,
        found_heading = EXCLUDED.found_heading,
        found_pitch   = EXCLUDED.found_pitch,
        found_zoom    = EXCLUDED.found_zoom,
        ai_reason     = EXCLUDED.ai_reason,
        created_at    = now()
    WHERE daily_attempts.duration_ms IS NULL;  -- only overwrite a forfeit, never a real time

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ALREADY_SUBMITTED');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."submit_daily_attempt"("p_date" "date", "p_device_id" "text", "p_duration_ms" bigint, "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_ai_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT public.is_valid_host(p_game_id, p_current_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games SET host_id = p_new_host_id WHERE id = p_game_id;
    DELETE FROM game_host_secrets WHERE game_id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_community_preset"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller uuid := auth.uid();
    cat_count int;
    safe_mode text;
    safe_grid int;
    safe_diff text;
    updated_row community_presets;
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM community_presets WHERE id = p_id AND author_id = caller) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_OWNER_OR_MISSING');
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'EMPTY_NAME');
    END IF;

    IF jsonb_typeof(p_categories) <> 'array' OR jsonb_array_length(p_categories) < 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CATEGORIES');
    END IF;

    cat_count := jsonb_array_length(p_categories);

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_categories) c
        WHERE c->>'categoryName' IS NULL OR c->>'lat' IS NULL OR c->>'lng' IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_MISSING_VIEW');
    END IF;

    IF (
        SELECT count(DISTINCT lower(c->>'categoryName')) FROM jsonb_array_elements(p_categories) c
    ) <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_CATEGORY');
    END IF;

    safe_diff := CASE WHEN p_difficulty IN ('easy', 'medium', 'hard') THEN p_difficulty ELSE 'medium' END;
    safe_mode := CASE WHEN p_game_mode = 'bingo' THEN 'bingo' ELSE 'list' END;
    safe_grid := COALESCE(p_grid_size, 3);

    IF safe_mode = 'bingo' AND safe_grid * safe_grid <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'BINGO_GRID_MISMATCH');
    END IF;

    UPDATE community_presets SET
        name                         = trim(p_name),
        description                  = NULLIF(trim(coalesce(p_description, '')), ''),
        categories                   = p_categories,
        boundaries                   = COALESCE(p_boundaries, '[]'::jsonb),
        starting_point               = COALESCE(NULLIF(trim(p_starting_point), ''), 'open-world'),
        category_count               = cat_count,
        recommended_time             = p_recommended_time,
        difficulty                   = safe_diff,
        game_mode                    = safe_mode,
        grid_size                    = safe_grid,
        settings                     = COALESCE(p_settings, '{}'::jsonb),
        icon                         = NULLIF(trim(coalesce(p_icon, '')), ''),
        category_translations        = COALESCE(p_category_translations, '{}'::jsonb),
        title_translations           = COALESCE(p_title_translations, '{}'::jsonb),
        description_translations       = COALESCE(p_description_translations, '{}'::jsonb),
        category_hint_translations   = COALESCE(p_category_hint_translations, '{}'::jsonb),
        updated_at                   = now()
    WHERE id = p_id AND author_id = caller
    RETURNING * INTO updated_row;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(updated_row));
END;
$$;


ALTER FUNCTION "public"."update_community_preset"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    allowed_keys text[] := ARRAY[
        'categories', 'time_limit', 'game_mode', 'grid_size', 'team_mode',
        'starting_point', 'gameBoundary', 'end_condition', 'hide_minimap',
        'hide_map_symbols', 'suggested_categories', 'exclusive_mode',
        'category_source', 'generation_radius', 'generation_number',
        'category_details', 'language', 'categories_generated', 'ai_end_game',
        'ready_players', 'banned_players', 'difficulty',
        'category_translations', 'category_hint_translations', 'preset_categories',
        'scale_voting', 'translate_categories',
        'voting_mode', 'category_vote_modes'
    ];
    safe_patch jsonb;
BEGIN
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    IF safe_patch ? 'voting_mode' AND NOT (safe_patch->>'voting_mode' IN ('yes_no', 'scale', 'mixed')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_VOTING_MODE');
    END IF;

    UPDATE games SET
        categories            = COALESCE(safe_patch->'categories', categories),
        time_limit            = COALESCE((safe_patch->>'time_limit')::int, time_limit),
        game_mode             = COALESCE(safe_patch->>'game_mode', game_mode),
        grid_size             = COALESCE((safe_patch->>'grid_size')::int, grid_size),
        team_mode             = COALESCE(safe_patch->>'team_mode', team_mode),
        starting_point        = COALESCE(safe_patch->>'starting_point', starting_point),
        "gameBoundary"        = COALESCE(safe_patch->>'gameBoundary', "gameBoundary"),
        end_condition         = COALESCE(safe_patch->>'end_condition', end_condition),
        hide_minimap          = COALESCE((safe_patch->>'hide_minimap')::boolean, hide_minimap),
        hide_map_symbols      = COALESCE((safe_patch->>'hide_map_symbols')::boolean, hide_map_symbols),
        suggested_categories  = CASE WHEN safe_patch ? 'suggested_categories'
                                    THEN ARRAY(SELECT jsonb_array_elements_text(safe_patch->'suggested_categories'))
                                    ELSE suggested_categories END,
        exclusive_mode        = COALESCE((safe_patch->>'exclusive_mode')::boolean, exclusive_mode),
        category_source       = COALESCE(safe_patch->>'category_source', category_source),
        generation_radius     = COALESCE((safe_patch->>'generation_radius')::bigint, generation_radius),
        generation_number     = COALESCE((safe_patch->>'generation_number')::int, generation_number),
        category_details      = CASE WHEN safe_patch ? 'category_details'
                                    THEN ARRAY(SELECT jsonb_array_elements(safe_patch->'category_details'))
                                    ELSE category_details END,
        language              = COALESCE(safe_patch->>'language', language),
        categories_generated  = COALESCE((safe_patch->>'categories_generated')::boolean, categories_generated),
        ai_end_game           = COALESCE((safe_patch->>'ai_end_game')::boolean, ai_end_game),
        difficulty            = COALESCE(safe_patch->>'difficulty', difficulty),
        category_translations      = COALESCE(safe_patch->'category_translations', category_translations),
        category_hint_translations = COALESCE(safe_patch->'category_hint_translations', category_hint_translations),
        preset_categories          = COALESCE(safe_patch->'preset_categories', preset_categories),
        scale_voting          = COALESCE((safe_patch->>'scale_voting')::boolean, scale_voting),
        translate_categories  = COALESCE((safe_patch->>'translate_categories')::boolean, translate_categories),
        voting_mode           = COALESCE(safe_patch->>'voting_mode', voting_mode),
        category_vote_modes   = COALESCE(safe_patch->'category_vote_modes', category_vote_modes),
        ready_players         = CASE WHEN safe_patch ? 'ready_players'
                                    THEN ARRAY(SELECT jsonb_array_elements_text(safe_patch->'ready_players'))
                                    ELSE ready_players END,
        banned_players        = CASE WHEN safe_patch ? 'banned_players'
                                    THEN ARRAY(SELECT jsonb_array_elements_text(safe_patch->'banned_players'))
                                    ELSE banned_players END
    WHERE id = p_game_id;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    allowed_keys text[] := ARRAY['name', 'score', 'bingo_board', 'team', 'path', 'game_id', 'category_locale'];
    safe_patch jsonb;
    new_game_id text;
    current_game_id text;
    target_status text;
    target_banned text[];
BEGIN
    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    -- Police game_id changes (joins). Other field updates are unaffected.
    IF safe_patch ? 'game_id' THEN
        new_game_id := safe_patch->>'game_id';
        SELECT game_id INTO current_game_id FROM players WHERE id = p_id;

        SELECT status, COALESCE(banned_players, '{}'::text[])
        INTO target_status, target_banned
        FROM games WHERE id = new_game_id;

        IF target_status IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'GAME_NOT_FOUND');
        END IF;

        IF p_id::text = ANY(target_banned) THEN
            RETURN jsonb_build_object('success', false, 'error', 'BANNED');
        END IF;

        IF new_game_id IS DISTINCT FROM current_game_id AND target_status <> 'lobby' THEN
            RETURN jsonb_build_object('success', false, 'error', 'GAME_IN_PROGRESS');
        END IF;
    END IF;

    UPDATE players SET
        name         = COALESCE(safe_patch->>'name', name),
        score        = COALESCE((safe_patch->>'score')::int, score),
        bingo_board  = COALESCE(safe_patch->'bingo_board', bingo_board),
        team         = COALESCE((safe_patch->>'team')::int, team),
        path         = COALESCE(safe_patch->'path', path),
        game_id      = COALESCE(safe_patch->>'game_id', game_id),
        category_locale = COALESCE(safe_patch->>'category_locale', category_locale)
    WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vote_community_preset"("p_preset_id" "uuid", "p_device_id" "text", "p_value" smallint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    existing smallint;
    my_vote  smallint := 0;
    up_count int;
    down_count int;
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_DEVICE');
    END IF;
    IF p_value NOT IN (-1, 1) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_VALUE');
    END IF;

    -- Serialise concurrent votes on the same preset.
    PERFORM 1 FROM community_presets WHERE id = p_preset_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    SELECT value INTO existing FROM community_preset_votes
    WHERE preset_id = p_preset_id AND device_id = p_device_id;

    IF existing = p_value THEN
        DELETE FROM community_preset_votes WHERE preset_id = p_preset_id AND device_id = p_device_id;
        my_vote := 0;
    ELSE
        INSERT INTO community_preset_votes (preset_id, device_id, value)
        VALUES (p_preset_id, p_device_id, p_value)
        ON CONFLICT (preset_id, device_id) DO UPDATE SET value = EXCLUDED.value, created_at = now();
        my_vote := p_value;
    END IF;

    SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)
    INTO up_count, down_count
    FROM community_preset_votes WHERE preset_id = p_preset_id;

    UPDATE community_presets SET upvotes = up_count, downvotes = down_count WHERE id = p_preset_id;

    RETURN jsonb_build_object('success', true, 'upvotes', up_count, 'downvotes', down_count, 'my_vote', my_vote);
END;
$$;


ALTER FUNCTION "public"."vote_community_preset"("p_preset_id" "uuid", "p_device_id" "text", "p_value" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."votes_all_yes"("p_votes" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
    SELECT count(*) FILTER (WHERE key NOT LIKE 'hype:%' AND jsonb_typeof(value) = 'boolean') >= 2
       AND count(*) FILTER (WHERE key NOT LIKE 'hype:%' AND value = to_jsonb(false)) = 0
    FROM jsonb_each(coalesce(p_votes, '{}'::jsonb));
$$;


ALTER FUNCTION "public"."votes_all_yes"("p_votes" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_game_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "game_id" "text" NOT NULL,
    "finished_at" timestamp with time zone NOT NULL,
    "game_mode" "text",
    "team_mode" "text",
    "placement" integer,
    "player_count" integer,
    "score" numeric,
    "categories_found" integer,
    "won" boolean DEFAULT false NOT NULL,
    "finds" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."account_game_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_preset_votes" (
    "preset_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "value" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "community_preset_votes_value_check" CHECK (("value" = ANY (ARRAY['-1'::integer, 1])))
);


ALTER TABLE "public"."community_preset_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_presets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "author_name" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "categories" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "boundaries" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "starting_point" "text" DEFAULT 'open-world'::"text" NOT NULL,
    "category_count" integer DEFAULT 0 NOT NULL,
    "upvotes" integer DEFAULT 0 NOT NULL,
    "downvotes" integer DEFAULT 0 NOT NULL,
    "score" integer GENERATED ALWAYS AS (("upvotes" - "downvotes")) STORED,
    "status" "text" DEFAULT 'published'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recommended_time" integer,
    "difficulty" "text" DEFAULT 'medium'::"text" NOT NULL,
    "game_mode" "text" DEFAULT 'list'::"text" NOT NULL,
    "grid_size" integer DEFAULT 3 NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "icon" "text",
    "category_translations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "title_translations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "description_translations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "category_hint_translations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."community_presets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_admins" (
    "email" "text" NOT NULL
);


ALTER TABLE "public"."daily_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "device_id" "text",
    "player_name" "text",
    "duration_ms" bigint,
    "forfeited" boolean DEFAULT false NOT NULL,
    "found_lat" double precision,
    "found_lng" double precision,
    "found_heading" double precision,
    "found_pitch" double precision,
    "found_zoom" double precision,
    "ai_reason" "text",
    "downvotes" integer DEFAULT 0 NOT NULL,
    "downvoters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "removed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."daily_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_date" "date" NOT NULL,
    "candidate_id" "uuid",
    "category" "text" NOT NULL,
    "source" "text" NOT NULL,
    "lat" double precision,
    "lng" double precision,
    "heading" double precision,
    "pitch" double precision,
    "zoom" double precision,
    "boundary" "text",
    "start_lat" double precision,
    "start_lng" double precision,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category_translations" "jsonb"
);


ALTER TABLE "public"."daily_challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friend_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "addressee_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."friend_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friendships" (
    "account_id" "uuid" NOT NULL,
    "friend_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."friendships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_host_secrets" (
    "game_id" "text" NOT NULL,
    "host_token" "text" NOT NULL
);


ALTER TABLE "public"."game_host_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "text" NOT NULL,
    "inviter_id" "uuid" NOT NULL,
    "invitee_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."game_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."games" (
    "id" "text" NOT NULL,
    "status" "text" DEFAULT 'lobby'::"text",
    "categories" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ready_players" "text"[] DEFAULT '{}'::"text"[],
    "time_limit" integer DEFAULT 600,
    "host_id" "text",
    "banned_players" "text"[] DEFAULT '{}'::"text"[],
    "game_mode" "text" DEFAULT 'list'::"text",
    "grid_size" integer DEFAULT 3,
    "team_mode" "text" DEFAULT 'ffa'::"text",
    "starting_point" "text" DEFAULT 'open-world'::"text",
    "gameBoundary" "text" DEFAULT '[]'::"text" NOT NULL,
    "end_condition" "text" DEFAULT 'timer'::"text",
    "hide_minimap" boolean DEFAULT false NOT NULL,
    "hide_map_symbols" boolean DEFAULT false,
    "suggested_categories" "text"[] DEFAULT '{}'::"text"[],
    "exclusive_mode" boolean DEFAULT false NOT NULL,
    "category_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "generation_radius" bigint DEFAULT '10'::bigint NOT NULL,
    "generation_number" integer DEFAULT 10 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "category_details" "jsonb"[] DEFAULT '{}'::"jsonb"[] NOT NULL,
    "language" "text" DEFAULT 'english'::"text" NOT NULL,
    "categories_generated" boolean DEFAULT false NOT NULL,
    "ai_end_game" boolean DEFAULT false NOT NULL,
    "difficulty" "text" DEFAULT 'default'::"text" NOT NULL,
    "category_translations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "category_hint_translations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "preset_categories" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "scale_voting" boolean DEFAULT false NOT NULL,
    "finished_at" timestamp with time zone,
    "phase_started_at" timestamp with time zone,
    "translate_categories" boolean DEFAULT false NOT NULL,
    "words_harvested_at" timestamp with time zone,
    "voting_round_index" integer DEFAULT 0 NOT NULL,
    "voting_active_sub_id" "uuid",
    "voting_mode" "text" DEFAULT 'yes_no'::"text" NOT NULL,
    "category_vote_modes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "games_voting_mode_check" CHECK (("voting_mode" = ANY (ARRAY['yes_no'::"text", 'scale'::"text", 'mixed'::"text"])))
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "text" NOT NULL,
    "name" "text",
    "score" integer DEFAULT 0,
    "bingo_board" "jsonb" DEFAULT '[]'::"jsonb",
    "team" integer DEFAULT 0,
    "path" "jsonb" DEFAULT '[]'::"jsonb",
    "account_id" "uuid",
    "category_locale" "text"
);


ALTER TABLE "public"."players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "text" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "lat" double precision,
    "lng" double precision,
    "heading" double precision,
    "pitch" double precision,
    "zoom" double precision,
    "votes" "jsonb" DEFAULT '{}'::"jsonb",
    "ai_verdict" boolean,
    "ai_verified_hash" "text",
    "captured_at" bigint
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."account_game_results"
    ADD CONSTRAINT "account_game_results_account_id_game_id_finished_at_key" UNIQUE ("account_id", "game_id", "finished_at");



ALTER TABLE ONLY "public"."account_game_results"
    ADD CONSTRAINT "account_game_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_preset_votes"
    ADD CONSTRAINT "community_preset_votes_pkey" PRIMARY KEY ("preset_id", "device_id");



ALTER TABLE ONLY "public"."community_presets"
    ADD CONSTRAINT "community_presets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_admins"
    ADD CONSTRAINT "daily_admins_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."daily_attempts"
    ADD CONSTRAINT "daily_attempts_challenge_id_account_id_key" UNIQUE ("challenge_id", "account_id");



ALTER TABLE ONLY "public"."daily_attempts"
    ADD CONSTRAINT "daily_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_challenge_candidates"
    ADD CONSTRAINT "daily_challenge_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_challenges"
    ADD CONSTRAINT "daily_challenges_challenge_date_key" UNIQUE ("challenge_date");



ALTER TABLE ONLY "public"."daily_challenges"
    ADD CONSTRAINT "daily_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_requester_id_addressee_id_key" UNIQUE ("requester_id", "addressee_id");



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_pkey" PRIMARY KEY ("account_id", "friend_id");



ALTER TABLE ONLY "public"."game_host_secrets"
    ADD CONSTRAINT "game_host_secrets_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."game_invitations"
    ADD CONSTRAINT "game_invitations_inviter_id_invitee_id_game_id_key" UNIQUE ("inviter_id", "invitee_id", "game_id");



ALTER TABLE ONLY "public"."game_invitations"
    ADD CONSTRAINT "game_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_game_player_category_key" UNIQUE ("game_id", "player_id", "category");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."word_pool"
    ADD CONSTRAINT "word_pool_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."word_pool"
    ADD CONSTRAINT "word_pool_word_norm_language_key" UNIQUE ("word_norm", "language");



CREATE INDEX "account_game_results_account_idx" ON "public"."account_game_results" USING "btree" ("account_id", "finished_at" DESC);



CREATE INDEX "community_presets_author_idx" ON "public"."community_presets" USING "btree" ("author_id");



CREATE INDEX "community_presets_created_idx" ON "public"."community_presets" USING "btree" ("created_at" DESC);



CREATE INDEX "community_presets_score_idx" ON "public"."community_presets" USING "btree" ("score" DESC);



CREATE INDEX "daily_attempts_account_idx" ON "public"."daily_attempts" USING "btree" ("account_id");



CREATE INDEX "daily_attempts_challenge_idx" ON "public"."daily_attempts" USING "btree" ("challenge_id", "removed", "duration_ms");



CREATE UNIQUE INDEX "daily_candidates_norm_uniq" ON "public"."daily_challenge_candidates" USING "btree" ("category_norm");



CREATE INDEX "daily_candidates_status_idx" ON "public"."daily_challenge_candidates" USING "btree" ("status", "is_fallback", "created_at");



CREATE INDEX "daily_challenges_date_idx" ON "public"."daily_challenges" USING "btree" ("challenge_date" DESC);



CREATE INDEX "friend_requests_addressee_idx" ON "public"."friend_requests" USING "btree" ("addressee_id");



CREATE INDEX "game_invitations_invitee_idx" ON "public"."game_invitations" USING "btree" ("invitee_id");



CREATE INDEX "players_game_id_idx" ON "public"."players" USING "btree" ("game_id");



CREATE UNIQUE INDEX "profiles_username_lower_idx" ON "public"."profiles" USING "btree" ("lower"("username"));



CREATE UNIQUE INDEX "submissions_game_player_category_uniq" ON "public"."submissions" USING "btree" ("game_id", "player_id", "category");



CREATE INDEX "submissions_player_id_idx" ON "public"."submissions" USING "btree" ("player_id");



CREATE INDEX "word_pool_status_created_idx" ON "public"."word_pool" USING "btree" ("status", "created_at");



CREATE INDEX "word_pool_status_imports_idx" ON "public"."word_pool" USING "btree" ("status", "import_count" DESC);



CREATE OR REPLACE TRIGGER "harvest_daily_candidates_trg" AFTER UPDATE OF "status" ON "public"."games" FOR EACH ROW WHEN ((("new"."status" = 'finished'::"text") AND ("old"."status" IS DISTINCT FROM 'finished'::"text"))) EXECUTE FUNCTION "public"."harvest_daily_candidates"();



CREATE OR REPLACE TRIGGER "harvest_pool_words_trg" AFTER UPDATE OF "status" ON "public"."games" FOR EACH ROW WHEN ((("new"."status" = 'finished'::"text") AND ("old"."status" IS DISTINCT FROM 'finished'::"text"))) EXECUTE FUNCTION "public"."harvest_pool_words"();



CREATE OR REPLACE TRIGGER "update_games_updated_at" BEFORE UPDATE ON "public"."games" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."account_game_results"
    ADD CONSTRAINT "account_game_results_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_preset_votes"
    ADD CONSTRAINT "community_preset_votes_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "public"."community_presets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_presets"
    ADD CONSTRAINT "community_presets_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_attempts"
    ADD CONSTRAINT "daily_attempts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_attempts"
    ADD CONSTRAINT "daily_attempts_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."daily_challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_challenges"
    ADD CONSTRAINT "daily_challenges_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."daily_challenge_candidates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friend_requests"
    ADD CONSTRAINT "friend_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_friend_id_fkey" FOREIGN KEY ("friend_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_host_secrets"
    ADD CONSTRAINT "game_host_secrets_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_invitations"
    ADD CONSTRAINT "game_invitations_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_invitations"
    ADD CONSTRAINT "game_invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



CREATE POLICY "Allow public insert games" ON "public"."games" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read games" ON "public"."games" FOR SELECT USING (true);



CREATE POLICY "Allow public read players" ON "public"."players" FOR SELECT USING (true);



CREATE POLICY "Allow public read submissions" ON "public"."submissions" FOR SELECT USING (true);



CREATE POLICY "Insert players only into open lobbies" ON "public"."players" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."games"
  WHERE (("games"."id" = "players"."game_id") AND ("games"."status" = 'lobby'::"text")))));



CREATE POLICY "Public read approved pool words" ON "public"."word_pool" FOR SELECT USING (("status" = 'approved'::"text"));



CREATE POLICY "Public read profiles" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Public read published presets" ON "public"."community_presets" FOR SELECT USING (("status" = 'published'::"text"));



CREATE POLICY "Public read votes" ON "public"."community_preset_votes" FOR SELECT USING (true);



CREATE POLICY "Read own friend requests" ON "public"."friend_requests" FOR SELECT USING ((("requester_id" = "auth"."uid"()) OR ("addressee_id" = "auth"."uid"())));



CREATE POLICY "Read own friendships" ON "public"."friendships" FOR SELECT USING (("account_id" = "auth"."uid"()));



CREATE POLICY "Read own game invitations" ON "public"."game_invitations" FOR SELECT USING ((("invitee_id" = "auth"."uid"()) OR ("inviter_id" = "auth"."uid"())));



CREATE POLICY "Read own game results" ON "public"."account_game_results" FOR SELECT USING (("account_id" = "auth"."uid"()));



ALTER TABLE "public"."account_game_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_preset_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_presets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_challenge_candidates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."friend_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."friendships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_host_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."word_pool" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_friend_request"("p_requester_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_friend_request"("p_requester_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_friend_request"("p_requester_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."account_display_name"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."account_display_name"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."account_display_name"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_friend"("p_friend_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."add_friend"("p_friend_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_friend"("p_friend_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_add_candidate"("p_category" "text", "p_source" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_start_lat" double precision, "p_start_lng" double precision, "p_boundary" "text", "p_translations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_add_candidate"("p_category" "text", "p_source" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_start_lat" double precision, "p_start_lng" double precision, "p_boundary" "text", "p_translations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_add_candidate"("p_category" "text", "p_source" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_start_lat" double precision, "p_start_lng" double precision, "p_boundary" "text", "p_translations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_add_database_candidates"("p_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_add_database_candidates"("p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_add_database_candidates"("p_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_daily_candidate"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_daily_candidate"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_daily_candidate"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_daily_challenge"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_daily_challenge"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_daily_challenge"("p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_pool_word"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_pool_word"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_pool_word"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_edit_daily_candidate"("p_id" "uuid", "p_category" "text", "p_translations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_edit_daily_candidate"("p_id" "uuid", "p_category" "text", "p_translations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_edit_daily_candidate"("p_id" "uuid", "p_category" "text", "p_translations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_edit_daily_challenge"("p_date" "date", "p_category" "text", "p_translations" "jsonb", "p_clear_attempts" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_edit_daily_challenge"("p_date" "date", "p_category" "text", "p_translations" "jsonb", "p_clear_attempts" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_edit_daily_challenge"("p_date" "date", "p_category" "text", "p_translations" "jsonb", "p_clear_attempts" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_edit_pool_word"("p_id" "uuid", "p_word" "text", "p_language" "text", "p_translations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_edit_pool_word"("p_id" "uuid", "p_word" "text", "p_language" "text", "p_translations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_edit_pool_word"("p_id" "uuid", "p_word" "text", "p_language" "text", "p_translations" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."daily_challenge_candidates" TO "anon";
GRANT ALL ON TABLE "public"."daily_challenge_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_challenge_candidates" TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_daily_candidates"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_daily_candidates"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_daily_candidates"("p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_daily_challenges"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_daily_challenges"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_daily_challenges"("p_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."word_pool" TO "anon";
GRANT ALL ON TABLE "public"."word_pool" TO "authenticated";
GRANT ALL ON TABLE "public"."word_pool" TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_pool_words"("p_status" "text", "p_language" "text", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_pool_words"("p_status" "text", "p_language" "text", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_pool_words"("p_status" "text", "p_language" "text", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_reorder_daily_candidates"("p_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reorder_daily_candidates"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reorder_daily_candidates"("p_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_replace_daily_challenge"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_replace_daily_challenge"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_replace_daily_challenge"("p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_review_pool_word"("p_id" "uuid", "p_action" "text", "p_translations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_review_pool_word"("p_id" "uuid", "p_action" "text", "p_translations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_pool_word"("p_id" "uuid", "p_action" "text", "p_translations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_run_daily_scheduler"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_run_daily_scheduler"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_run_daily_scheduler"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_set_pool_word_translations"("p_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_pool_word_translations"("p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_pool_word_translations"("p_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."am_i_daily_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."am_i_daily_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."am_i_daily_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_captured_at" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_stale_games"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_stale_games"() TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_community_preset"("p_name" "text", "p_description" "text", "p_author_name" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_community_preset"("p_name" "text", "p_description" "text", "p_author_name" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_community_preset"("p_name" "text", "p_description" "text", "p_author_name" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."daily_caller_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."daily_caller_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."daily_caller_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decline_friend_request"("p_requester_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decline_friend_request"("p_requester_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decline_friend_request"("p_requester_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."dismiss_game_invitation"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."dismiss_game_invitation"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dismiss_game_invitation"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."downvote_daily_find"("p_attempt_id" "uuid", "p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."downvote_daily_find"("p_attempt_id" "uuid", "p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."downvote_daily_find"("p_attempt_id" "uuid", "p_device_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_daily_challenge"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_daily_challenge"() TO "service_role";



GRANT ALL ON FUNCTION "public"."forfeit_daily_attempt"("p_date" "date", "p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."forfeit_daily_attempt"("p_date" "date", "p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forfeit_daily_attempt"("p_date" "date", "p_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_challenge"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_challenge"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_challenge"("p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_finds"("p_date" "date", "p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_finds"("p_date" "date", "p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_finds"("p_date" "date", "p_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_leaderboard"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_leaderboard"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_leaderboard"("p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_friends_with_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_friends_with_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_friends_with_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_incoming_friend_requests"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_incoming_friend_requests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_incoming_friend_requests"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_account_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_account_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_account_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_daily_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_daily_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_daily_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_game_history"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_game_history"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_game_history"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_game_invitations"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_game_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_game_invitations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_outgoing_friend_requests"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_outgoing_friend_requests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_outgoing_friend_requests"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_recent_daily_challenges"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_recent_daily_challenges"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recent_daily_challenges"() TO "service_role";



GRANT ALL ON FUNCTION "public"."harvest_daily_candidates"() TO "anon";
GRANT ALL ON FUNCTION "public"."harvest_daily_candidates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."harvest_daily_candidates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."harvest_pool_words"() TO "anon";
GRANT ALL ON FUNCTION "public"."harvest_pool_words"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."harvest_pool_words"() TO "service_role";



GRANT ALL ON FUNCTION "public"."import_pool_words"("p_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."import_pool_words"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_pool_words"("p_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_game"("p_game_id" "text", "p_player_id" "uuid", "p_name" "text", "p_account_id" "uuid", "p_bingo_board" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_my_game_result"("p_game_id" "text", "p_player_id" "uuid", "p_game_mode" "text", "p_team_mode" "text", "p_placement" integer, "p_player_count" integer, "p_score" numeric, "p_categories_found" integer, "p_won" boolean, "p_finds" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."record_my_game_result"("p_game_id" "text", "p_player_id" "uuid", "p_game_mode" "text", "p_team_mode" "text", "p_placement" integer, "p_player_count" integer, "p_score" numeric, "p_categories_found" integer, "p_won" boolean, "p_finds" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_my_game_result"("p_game_id" "text", "p_player_id" "uuid", "p_game_mode" "text", "p_team_mode" "text", "p_placement" integer, "p_player_count" integer, "p_score" numeric, "p_categories_found" integer, "p_won" boolean, "p_finds" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_host_secret"("p_game_id" "text", "p_player_id" "text", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."register_host_secret"("p_game_id" "text", "p_player_id" "text", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_host_secret"("p_game_id" "text", "p_player_id" "text", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_hype"("p_submission_id" "uuid", "p_player_id" "text", "p_hype" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."register_hype"("p_submission_id" "uuid", "p_player_id" "text", "p_hype" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_hype"("p_submission_id" "uuid", "p_player_id" "text", "p_hype" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_scale_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_value" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."register_scale_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_value" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_scale_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_value" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_friend"("p_friend_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_friend"("p_friend_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_friend"("p_friend_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rename_my_presets_author"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rename_my_presets_author"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_my_presets_author"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reveal_daily_location"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."reveal_daily_location"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reveal_daily_location"("p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."review_daily_candidate"("p_id" "uuid", "p_decision" "text", "p_translations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."review_daily_candidate"("p_id" "uuid", "p_decision" "text", "p_translations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_daily_candidate"("p_id" "uuid", "p_decision" "text", "p_translations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."send_friend_request"("p_addressee_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."send_friend_request"("p_addressee_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_friend_request"("p_addressee_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."send_friend_request_by_username"("p_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."send_friend_request_by_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_friend_request_by_username"("p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."send_game_invitation"("p_game_id" "text", "p_invitee_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."send_game_invitation"("p_game_id" "text", "p_invitee_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_game_invitation"("p_game_id" "text", "p_invitee_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_username"("p_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_username"("p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."submission_is_valid"("p_votes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submission_is_valid"("p_votes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submission_is_valid"("p_votes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_daily_attempt"("p_date" "date", "p_device_id" "text", "p_duration_ms" bigint, "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_ai_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_daily_attempt"("p_date" "date", "p_device_id" "text", "p_duration_ms" bigint, "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_ai_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_daily_attempt"("p_date" "date", "p_device_id" "text", "p_duration_ms" bigint, "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision, "p_ai_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_community_preset"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_community_preset"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_community_preset"("p_id" "uuid", "p_name" "text", "p_description" "text", "p_categories" "jsonb", "p_boundaries" "jsonb", "p_starting_point" "text", "p_recommended_time" integer, "p_difficulty" "text", "p_game_mode" "text", "p_grid_size" integer, "p_settings" "jsonb", "p_icon" "text", "p_category_translations" "jsonb", "p_title_translations" "jsonb", "p_description_translations" "jsonb", "p_category_hint_translations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vote_community_preset"("p_preset_id" "uuid", "p_device_id" "text", "p_value" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."vote_community_preset"("p_preset_id" "uuid", "p_device_id" "text", "p_value" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vote_community_preset"("p_preset_id" "uuid", "p_device_id" "text", "p_value" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."votes_all_yes"("p_votes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."votes_all_yes"("p_votes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."votes_all_yes"("p_votes" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."account_game_results" TO "anon";
GRANT ALL ON TABLE "public"."account_game_results" TO "authenticated";
GRANT ALL ON TABLE "public"."account_game_results" TO "service_role";



GRANT ALL ON TABLE "public"."community_preset_votes" TO "anon";
GRANT ALL ON TABLE "public"."community_preset_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."community_preset_votes" TO "service_role";



GRANT ALL ON TABLE "public"."community_presets" TO "anon";
GRANT ALL ON TABLE "public"."community_presets" TO "authenticated";
GRANT ALL ON TABLE "public"."community_presets" TO "service_role";



GRANT ALL ON TABLE "public"."daily_admins" TO "anon";
GRANT ALL ON TABLE "public"."daily_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_admins" TO "service_role";



GRANT ALL ON TABLE "public"."daily_attempts" TO "anon";
GRANT ALL ON TABLE "public"."daily_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."daily_challenges" TO "anon";
GRANT ALL ON TABLE "public"."daily_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_challenges" TO "service_role";



GRANT ALL ON TABLE "public"."friend_requests" TO "anon";
GRANT ALL ON TABLE "public"."friend_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."friend_requests" TO "service_role";



GRANT ALL ON TABLE "public"."friendships" TO "anon";
GRANT ALL ON TABLE "public"."friendships" TO "authenticated";
GRANT ALL ON TABLE "public"."friendships" TO "service_role";



GRANT ALL ON TABLE "public"."game_host_secrets" TO "anon";
GRANT ALL ON TABLE "public"."game_host_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."game_host_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."game_invitations" TO "anon";
GRANT ALL ON TABLE "public"."game_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."game_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."players" TO "anon";
GRANT ALL ON TABLE "public"."players" TO "authenticated";
GRANT ALL ON TABLE "public"."players" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."submissions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







