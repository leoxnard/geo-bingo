-- ============================================================================
-- Voting cursor: server-authoritative "current submission" pointer
-- ============================================================================
-- The voting phase previously had NO shared pointer for which submission
-- everyone is voting on: each device animated + advanced on its own, so a
-- single client could drift one card ahead and stay there (even across
-- reloads). This adds an authoritative cursor on the games row that the host
-- (and only the host) writes; every device — including reloads — renders the
-- submission the cursor names.
--
--   voting_round_index   which round (player/team journey) is active
--   voting_active_sub_id which submission within it is open for voting
--                        (NULL = round start / animating before the first card)
-- ============================================================================

-- 1. Cursor columns -----------------------------------------------------------
ALTER TABLE "public"."games"
    ADD COLUMN IF NOT EXISTS "voting_round_index" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "voting_active_sub_id" "uuid";

-- 2. Host-only writer ---------------------------------------------------------
-- p_host_id carries the host capability TOKEN, not a player id (see is_valid_host).
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
GRANT ALL ON FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_voting_cursor"("p_game_id" "text", "p_host_id" "text", "p_round_index" integer, "p_active_sub_id" "uuid") TO "service_role";

-- 3. Reset the cursor on every transition INTO voting (and back to lobby) ------
-- A fresh voting phase must always start at (0, NULL); stale values from a
-- previous round would strand reloaders on a submission that no longer exists.

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
