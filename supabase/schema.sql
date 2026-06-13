


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


CREATE OR REPLACE FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_game_id text;
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


CREATE OR REPLACE FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    UPDATE games SET status = 'voting'
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
        UPDATE games SET ready_players = new_ready, status = 'voting'
        WHERE id = p_game_id AND status = 'playing';
    ELSE
        UPDATE games SET ready_players = new_ready WHERE id = p_game_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'ready_count', array_length(new_ready, 1), 'total_players', total_players);
END;
$$;


ALTER FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") OWNER TO "postgres";


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

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."rename_my_presets_author"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF p_status NOT IN ('lobby', 'playing', 'voting', 'finished') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_STATUS');
    END IF;
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games SET status = p_status WHERE id = p_game_id;
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
        'scale_voting'
    ];
    safe_patch jsonb;
BEGIN
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
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
    allowed_keys text[] := ARRAY['name', 'score', 'bingo_board', 'team', 'path', 'game_id'];
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

        -- Banned players can never (re)join, even by reconnecting.
        IF p_id::text = ANY(target_banned) THEN
            RETURN jsonb_build_object('success', false, 'error', 'BANNED');
        END IF;

        -- Moving INTO a different game is only allowed while it is a lobby.
        -- (Reconnecting to the game you are already in keeps working mid-round.)
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
        game_id      = COALESCE(safe_patch->>'game_id', game_id)
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

SET default_tablespace = '';

SET default_table_access_method = "heap";


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


CREATE TABLE IF NOT EXISTS "public"."game_host_secrets" (
    "game_id" "text" NOT NULL,
    "host_token" "text" NOT NULL
);


ALTER TABLE "public"."game_host_secrets" OWNER TO "postgres";


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
    "scale_voting" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "text" NOT NULL,
    "name" "text",
    "score" integer DEFAULT 0,
    "bingo_board" "jsonb" DEFAULT '[]'::"jsonb",
    "team" integer DEFAULT 0,
    "path" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."players" OWNER TO "postgres";


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


ALTER TABLE ONLY "public"."community_preset_votes"
    ADD CONSTRAINT "community_preset_votes_pkey" PRIMARY KEY ("preset_id", "device_id");



ALTER TABLE ONLY "public"."community_presets"
    ADD CONSTRAINT "community_presets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_host_secrets"
    ADD CONSTRAINT "game_host_secrets_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_game_player_category_key" UNIQUE ("game_id", "player_id", "category");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



CREATE INDEX "community_presets_author_idx" ON "public"."community_presets" USING "btree" ("author_id");



CREATE INDEX "community_presets_created_idx" ON "public"."community_presets" USING "btree" ("created_at" DESC);



CREATE INDEX "community_presets_score_idx" ON "public"."community_presets" USING "btree" ("score" DESC);



CREATE INDEX "players_game_id_idx" ON "public"."players" USING "btree" ("game_id");



CREATE UNIQUE INDEX "submissions_game_player_category_uniq" ON "public"."submissions" USING "btree" ("game_id", "player_id", "category");



CREATE INDEX "submissions_player_id_idx" ON "public"."submissions" USING "btree" ("player_id");



CREATE OR REPLACE TRIGGER "update_games_updated_at" BEFORE UPDATE ON "public"."games" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."community_preset_votes"
    ADD CONSTRAINT "community_preset_votes_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "public"."community_presets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_presets"
    ADD CONSTRAINT "community_presets_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_host_secrets"
    ADD CONSTRAINT "game_host_secrets_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



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



CREATE POLICY "Public read published presets" ON "public"."community_presets" FOR SELECT USING (("status" = 'published'::"text"));



CREATE POLICY "Public read votes" ON "public"."community_preset_votes" FOR SELECT USING (true);



ALTER TABLE "public"."community_preset_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_presets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_host_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



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



GRANT ALL ON FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_community_preset"("p_preset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_valid_host"("p_game_id" "text", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "service_role";



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



GRANT ALL ON FUNCTION "public"."rename_my_presets_author"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rename_my_presets_author"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_my_presets_author"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "service_role";



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



GRANT ALL ON TABLE "public"."community_preset_votes" TO "anon";
GRANT ALL ON TABLE "public"."community_preset_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."community_preset_votes" TO "service_role";



GRANT ALL ON TABLE "public"."community_presets" TO "anon";
GRANT ALL ON TABLE "public"."community_presets" TO "authenticated";
GRANT ALL ON TABLE "public"."community_presets" TO "service_role";



GRANT ALL ON TABLE "public"."game_host_secrets" TO "anon";
GRANT ALL ON TABLE "public"."game_host_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."game_host_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."players" TO "anon";
GRANT ALL ON TABLE "public"."players" TO "authenticated";
GRANT ALL ON TABLE "public"."players" TO "service_role";



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







