


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



CREATE OR REPLACE FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) RETURNS "jsonb"
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


ALTER FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result_sub RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    -- Lock the game row briefly so two simultaneous claimers serialise.
    PERFORM 1 FROM games WHERE id = p_game_id FOR UPDATE;

    -- Reject if the category was already claimed in this game.
    IF EXISTS (SELECT 1 FROM submissions WHERE game_id = p_game_id AND category = p_category) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CLAIMED');
    END IF;

    INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom)
    VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom)
    RETURNING * INTO result_sub;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;


ALTER FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    DELETE FROM submissions WHERE game_id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") OWNER TO "postgres";


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

    IF NOT EXISTS (SELECT 1 FROM games WHERE id = target_game_id AND host_id = p_host_id) THEN
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

    -- Dedupe-append: union the existing ready_players array with the caller.
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


CREATE OR REPLACE FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE submissions
    SET votes = jsonb_set(COALESCE(votes, '{}'::jsonb), array[p_player_id], to_jsonb(p_vote))
    WHERE id = p_submission_id;
END;
$$;


ALTER FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF p_status NOT IN ('lobby', 'playing', 'voting', 'finished') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_STATUS');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_host_id) THEN
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
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_current_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    UPDATE games SET host_id = p_new_host_id WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    allowed_keys text[] := ARRAY[
        'categories', 'time_limit', 'game_mode', 'grid_size', 'team_mode',
        'starting_point', 'gameBoundary', 'end_condition', 'hide_mini_map',
        'hide_map_symbols', 'suggested_categories', 'exclusive_mode',
        'category_source', 'generation_radius', 'generation_number',
        'category_details', 'language', 'categories_generated', 'ai_end_game',
        'ready_players', 'banned_players'
    ];
    safe_patch jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    -- Strip any keys that aren't on the allowlist.
    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    -- Scalar / jsonb columns use COALESCE because ->/->> return NULL for absent
    -- keys, and COALESCE then picks the existing value. text[] and jsonb[]
    -- columns must use CASE on `?` (key existence) because converting an
    -- absent key through jsonb_array_elements_text(...) yields an empty
    -- array, not NULL, which would wipe the column on every partial patch.
    UPDATE games SET
        categories            = COALESCE(safe_patch->'categories', categories),
        time_limit            = COALESCE((safe_patch->>'time_limit')::int, time_limit),
        game_mode             = COALESCE(safe_patch->>'game_mode', game_mode),
        grid_size             = COALESCE((safe_patch->>'grid_size')::int, grid_size),
        team_mode             = COALESCE(safe_patch->>'team_mode', team_mode),
        starting_point        = COALESCE(safe_patch->>'starting_point', starting_point),
        "gameBoundary"        = COALESCE(safe_patch->>'gameBoundary', "gameBoundary"),
        end_condition         = COALESCE(safe_patch->>'end_condition', end_condition),
        hide_mini_map         = COALESCE((safe_patch->>'hide_mini_map')::boolean, hide_mini_map),
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
    allowed_keys text[] := ARRAY['name', 'score', 'bingo_board', 'team', 'path'];
    safe_patch jsonb;
BEGIN
    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    UPDATE players SET
        name         = COALESCE(safe_patch->>'name', name),
        score        = COALESCE((safe_patch->>'score')::int, score),
        bingo_board  = COALESCE(safe_patch->'bingo_board', bingo_board),
        team         = COALESCE((safe_patch->>'team')::int, team),
        path         = COALESCE(safe_patch->'path', path)
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

SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    "hide_mini_map" boolean DEFAULT false NOT NULL,
    "hide_map_symbols" boolean DEFAULT false,
    "suggested_categories" "text"[] DEFAULT '{}'::"text"[],
    "exclusive_mode" boolean DEFAULT false NOT NULL,
    "category_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "generation_radius" bigint DEFAULT '10'::bigint NOT NULL,
    "generation_number" integer DEFAULT 10 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "category_details" "jsonb"[] DEFAULT '{}'::"jsonb"[] NOT NULL,
    "language" "text" DEFAULT '''german''::text'::"text" NOT NULL,
    "categories_generated" boolean DEFAULT false NOT NULL,
    "ai_end_game" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "text",
    "name" "text",
    "score" integer DEFAULT 0,
    "bingo_board" "jsonb" DEFAULT '[]'::"jsonb",
    "team" integer DEFAULT 0,
    "path" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "text",
    "player_id" "uuid",
    "category" "text",
    "lat" double precision,
    "lng" double precision,
    "heading" double precision,
    "pitch" double precision,
    "zoom" double precision,
    "is_valid" boolean,
    "votes" "jsonb" DEFAULT '{}'::"jsonb",
    "ai_verdict" boolean,
    "ai_verified_hash" "text"
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



CREATE OR REPLACE TRIGGER "update_games_updated_at" BEFORE UPDATE ON "public"."games" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



CREATE POLICY "Allow public delete players" ON "public"."players" FOR DELETE USING (true);



CREATE POLICY "Allow public delete submissions" ON "public"."submissions" FOR DELETE USING (true);



CREATE POLICY "Allow public insert games" ON "public"."games" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert submissions" ON "public"."submissions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read games" ON "public"."games" FOR SELECT USING (true);



CREATE POLICY "Allow public read players" ON "public"."players" FOR SELECT USING (true);



CREATE POLICY "Allow public read submissions" ON "public"."submissions" FOR SELECT USING (true);



CREATE POLICY "Allow public update games" ON "public"."games" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Allow public update players" ON "public"."players" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Allow public update submissions" ON "public"."submissions" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Insert players only into open lobbies" ON "public"."players" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."games"
  WHERE (("games"."id" = "players"."game_id") AND ("games"."status" = 'lobby'::"text")))));



ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_submissions_for_game"("p_game_id" "text", "p_host_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_player"("p_id" "uuid", "p_host_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_submission"("p_id" "uuid", "p_player_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_suggest_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_vote_to_end_round"("p_game_id" "text", "p_player_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_game_status"("p_game_id" "text", "p_host_id" "text", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_submission_ai_verdict"("p_id" "uuid", "p_player_id" "uuid", "p_verdict" boolean, "p_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_host"("p_game_id" "text", "p_current_host_id" "text", "p_new_host_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player"("p_id" "uuid", "p_patch" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



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







