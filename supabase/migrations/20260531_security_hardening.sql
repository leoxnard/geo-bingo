-- =============================================================================
-- SECURITY HARDENING
-- =============================================================================
-- Before this migration, every table had a catch-all
--   CREATE POLICY ... USING (true) WITH CHECK (true)
-- which let any anon client INSERT / UPDATE / DELETE any row in any game.
--
-- This migration replaces direct table writes with SECURITY DEFINER RPCs
-- that validate the caller's player/host identity inside the function body,
-- then drops the open policies.
--
-- The app has no Supabase Auth — players are identified by the random UUIDs
-- they stash in localStorage. The trust model after this migration is:
--   "knowing a player_id (or host_id) authorises acting as that player".
-- That is strictly stronger than the previous "knowing the short game id
-- authorises anything", because UUIDs are not shared in the lobby UI.
--
-- Apply with:  psql ... -f supabase/migrations/20260531_security_hardening.sql
-- (or paste into Supabase Studio SQL editor).
-- After applying, run `npm run generate:schema` to refresh schema.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Add SECURITY DEFINER to pre-existing functions
-- -----------------------------------------------------------------------------
-- claim_exclusive_category and register_vote were created BEFORE this hardening
-- pass; they worked only because of the catch-all "Allow all on submissions"
-- policy this migration drops. Re-issue them as SECURITY DEFINER so they can
-- still write submissions / votes under the tightened policy set, and add the
-- "caller is actually a player in this game" validation to claim_exclusive_category
-- to match the new claim_category function below.

CREATE OR REPLACE FUNCTION public.claim_exclusive_category(
    p_game_id text,
    p_player_id uuid,
    p_category text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.claim_exclusive_category TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.register_vote(
    p_submission_id uuid,
    p_player_id text,
    p_vote boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE submissions
    SET votes = jsonb_set(COALESCE(votes, '{}'::jsonb), array[p_player_id], to_jsonb(p_vote))
    WHERE id = p_submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_vote TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 1. Helper: non-exclusive category claim
-- -----------------------------------------------------------------------------
-- Mirrors claim_exclusive_category for games where multiple players can claim
-- the same category. Validates that the caller is actually a player in the game
-- before inserting.
CREATE OR REPLACE FUNCTION public.claim_category(
    p_game_id text,
    p_player_id uuid,
    p_category text,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result_sub RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PLAYER');
    END IF;

    INSERT INTO submissions (game_id, player_id, category, lat, lng, heading, pitch, zoom)
    VALUES (p_game_id, p_player_id, p_category, p_lat, p_lng, p_heading, p_pitch, p_zoom)
    RETURNING * INTO result_sub;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(result_sub));
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_category TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. Host-only game settings patch
-- -----------------------------------------------------------------------------
-- Applies an arbitrary partial update to a game row, but only if the supplied
-- host_id matches what the database has. Whitelists which columns may be
-- patched so a malicious client can't, e.g., flip host_id to themselves.
CREATE OR REPLACE FUNCTION public.update_game_settings(
    p_game_id text,
    p_host_id text,
    p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    allowed_keys text[] := ARRAY[
        'categories', 'time_limit', 'game_mode', 'grid_size', 'team_mode',
        'starting_point', 'gameBoundary', 'end_condition', 'hide_minimap',
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
        hide_minimap         = COALESCE((safe_patch->>'hide_minimap')::boolean, hide_minimap),
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

GRANT EXECUTE ON FUNCTION public.update_game_settings TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. Host-only status change
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_game_status(
    p_game_id text,
    p_host_id text,
    p_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.set_game_status TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. Submission owner: AI verdict write
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_submission_ai_verdict(
    p_id uuid,
    p_player_id uuid,
    p_verdict boolean,
    p_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.set_submission_ai_verdict TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. Submission owner: delete
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_submission(
    p_id uuid,
    p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM submissions WHERE id = p_id AND player_id = p_player_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_OWNER_OR_MISSING');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_submission TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. Player owner: self-update
-- -----------------------------------------------------------------------------
-- Knowing a player's id is treated as authorisation to act as that player
-- (same trust model as before, just channeled through one validated path).
-- Only an allowlisted set of columns can change.
CREATE OR REPLACE FUNCTION public.update_player(
    p_id uuid,
    p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.update_player TO anon, authenticated, service_role;


-- =============================================================================
-- 7. Tighten RLS policies
-- =============================================================================
-- After applying the policies below, direct INSERT/UPDATE/DELETE on the locked
-- tables is denied unless the caller is service_role. SECURITY DEFINER RPCs
-- above continue to work because they run as the function owner.
-- =============================================================================

-- games
DROP POLICY IF EXISTS "Allow all on games" ON public.games;
DROP POLICY IF EXISTS "Host can update their game" ON public.games;
-- Reads stay open (lobbies are observable).
-- Inserts stay open (game creation is the entry point).
-- Updates: no direct policy -> denied. update_game_settings / set_game_status are the only paths.

-- players
DROP POLICY IF EXISTS "Allow all on players" ON public.players;
DROP POLICY IF EXISTS "Allow public update players" ON public.players;
DROP POLICY IF EXISTS "Allow public insert players" ON public.players;
DROP POLICY IF EXISTS "Insert players only into open lobbies" ON public.players;
-- Replacement insert policy: game must exist and still be in lobby.
CREATE POLICY "Insert players only into open lobbies"
    ON public.players
    FOR INSERT
    WITH CHECK (
        EXISTS (SELECT 1 FROM games WHERE id = game_id AND status = 'lobby')
    );
-- Updates: no direct policy -> denied. update_player is the only path.

-- submissions
DROP POLICY IF EXISTS "Allow all on submissions" ON public.submissions;
DROP POLICY IF EXISTS "Allow public insert submissions" ON public.submissions;
DROP POLICY IF EXISTS "Allow public update submissions" ON public.submissions;
DROP POLICY IF EXISTS "Public delete submissions" ON public.submissions;
-- Inserts: no direct policy -> denied. claim_category / claim_exclusive_category are the only paths.
-- Updates: no direct policy -> denied. register_vote / set_submission_ai_verdict are the only paths.
-- Deletes: no direct policy -> denied. delete_submission is the only path.
