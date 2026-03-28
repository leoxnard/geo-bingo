


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



CREATE OR REPLACE FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  result_sub RECORD;
BEGIN
  -- 1. Wir "sperren" die Game-Reihe für einen Bruchteil einer Sekunde. 
  -- Wenn 2 Spieler exakt gleichzeitig kommen, muss einer kurz in der Schlange warten.
  PERFORM 1 FROM games WHERE id = p_game_id FOR UPDATE;

  -- 2. Prüfen, ob die Kategorie in diesem Spiel schon von jemandem gefunden wurde
  IF EXISTS (SELECT 1 FROM submissions WHERE game_id = p_game_id AND category = p_category) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CLAIMED');
  END IF;

  -- 3. Wenn sie noch frei ist, fügen wir sie sicher ein!
  INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom)
  VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom)
  RETURNING * INTO result_sub;

  RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;


ALTER FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE submissions
  SET votes = jsonb_set(
    COALESCE(votes, '{}'::jsonb),
    array[p_player_id],
    to_jsonb(p_vote)
  )
  WHERE id = p_submission_id;
END;
$$;


ALTER FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."games" (
    "id" "text" NOT NULL,
    "status" "text" DEFAULT 'lobby'::"text",
    "categories" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ready_players" "text"[] DEFAULT '{}'::"text"[],
    "time_limit" integer DEFAULT 300,
    "host_id" "text",
    "banned_players" "text"[] DEFAULT '{}'::"text"[],
    "game_mode" "text" DEFAULT 'list'::"text",
    "grid_size" integer DEFAULT 3,
    "team_mode" "text" DEFAULT 'ffa'::"text",
    "bingo_board_mode" "text" DEFAULT 'shared'::"text",
    "starting_point" "text" DEFAULT 'open-world'::"text",
    "gameBoundary" "text" DEFAULT 'null'::"text",
    "end_condition" "text" DEFAULT 'timer'::"text",
    "fast_voting" boolean DEFAULT false,
    "hide_map_symbols" boolean DEFAULT false,
    "suggested_categories" "text"[] DEFAULT '{}'::"text"[],
    "exclusive_mode" boolean DEFAULT false NOT NULL
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
    "votes" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



CREATE POLICY "Allow all on games" ON "public"."games" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all on players" ON "public"."players" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all on submissions" ON "public"."submissions" USING (true) WITH CHECK (true);



CREATE POLICY "Allow public insert games" ON "public"."games" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert players" ON "public"."players" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert submissions" ON "public"."submissions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read games" ON "public"."games" FOR SELECT USING (true);



CREATE POLICY "Allow public read players" ON "public"."players" FOR SELECT USING (true);



CREATE POLICY "Allow public read submissions" ON "public"."submissions" FOR SELECT USING (true);



CREATE POLICY "Allow public update players" ON "public"."players" FOR UPDATE USING (true);



CREATE POLICY "Allow public update submissions" ON "public"."submissions" FOR UPDATE USING (true);



CREATE POLICY "Host can update their game" ON "public"."games" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Public delete submissions" ON "public"."submissions" FOR DELETE USING (true);



ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_exclusive_category"("p_game_id" "text", "p_player_id" "uuid", "p_category" "text", "p_lat" double precision, "p_lng" double precision, "p_heading" double precision, "p_pitch" double precision, "p_zoom" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_vote"("p_submission_id" "uuid", "p_player_id" "text", "p_vote" boolean) TO "service_role";



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







