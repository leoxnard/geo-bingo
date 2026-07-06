-- ============================================================================
-- PLAYER PROFILES & FRIENDS
-- ============================================================================
-- Persists per-account multiplayer outcomes (so a signed-in player builds a
-- profile: games played, win-rate, categories found, and find coordinates for a
-- future heatmap) and adds a lightweight friends list with one-tap invites.
--
-- Multiplayer games are otherwise ephemeral: games/players/submissions are
-- discarded on "Back to Lobby", and the same game_id is REUSED for replays. So a
-- recorded result is keyed on (account_id, game_id, finished_at): games.finished_at
-- is stamped once per round by set_game_status, giving each replay a distinct row
-- while a re-render/refresh within the same finished phase stays idempotent.
--
-- Results are recorded client-side from the podium (the only place the full
-- score is computed). The RPC re-validates membership and clamps the numbers; a
-- player can only ever write their OWN stats, so the trust surface is their own
-- profile — there is no global leaderboard riding on this data.
-- ============================================================================

-- ── Schema additions ────────────────────────────────────────────────────────

-- Round marker: stamped when a game enters 'finished' (see set_game_status).
ALTER TABLE public.games        ADD COLUMN IF NOT EXISTS finished_at timestamptz;

-- Links an in-game player to the account that was signed in when they joined.
-- Best-effort attribution for future surfaces; recording does not depend on it.
ALTER TABLE public.players      ADD COLUMN IF NOT EXISTS account_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- One row per account per finished multiplayer round.
CREATE TABLE IF NOT EXISTS public.account_game_results (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    game_id           text NOT NULL,
    finished_at       timestamptz NOT NULL,
    game_mode         text,
    team_mode         text,
    placement         int,
    player_count      int,
    score             numeric,
    categories_found  int,
    won               boolean NOT NULL DEFAULT false,
    finds             jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{lat,lng,category}]
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, game_id, finished_at)
);
ALTER TABLE public.account_game_results OWNER TO postgres;
CREATE INDEX IF NOT EXISTS account_game_results_account_idx
    ON public.account_game_results (account_id, finished_at DESC);

-- Symmetric friendship: a row per direction (both inserted by add_friend), so
-- "my friends" is a plain WHERE account_id = me lookup.
CREATE TABLE IF NOT EXISTS public.friendships (
    account_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    friend_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, friend_id)
);
ALTER TABLE public.friendships OWNER TO postgres;

-- ── RLS: own rows readable; all writes go through SECURITY DEFINER RPCs ───────

ALTER TABLE public.account_game_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own game results" ON public.account_game_results;
CREATE POLICY "Read own game results" ON public.account_game_results
    FOR SELECT USING (account_id = auth.uid());

DROP POLICY IF EXISTS "Read own friendships" ON public.friendships;
CREATE POLICY "Read own friendships" ON public.friendships
    FOR SELECT USING (account_id = auth.uid());

-- ── set_game_status: stamp finished_at on the transition into 'finished' ─────

CREATE OR REPLACE FUNCTION public.set_game_status(p_game_id text, p_host_id text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF p_status NOT IN ('lobby', 'playing', 'voting', 'finished') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_STATUS');
    END IF;
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games
    SET status = p_status,
        finished_at = CASE WHEN p_status = 'finished' THEN now() ELSE finished_at END
    WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;
ALTER FUNCTION public.set_game_status(text, text, text) OWNER TO postgres;

-- ── record_my_game_result ────────────────────────────────────────────────────
-- The signed-in player records their own outcome for a finished game. Idempotent
-- per round via the finished_at round marker. Guests (uid NULL) record nothing.

CREATE OR REPLACE FUNCTION public.record_my_game_result(
    p_game_id          text,
    p_player_id        uuid,
    p_game_mode        text,
    p_team_mode        text,
    p_placement        int,
    p_player_count     int,
    p_score            numeric,
    p_categories_found int,
    p_won              boolean,
    p_finds            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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

    -- Sanity clamps: a player can only inflate their own profile, but keep the
    -- numbers internally consistent regardless.
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
ALTER FUNCTION public.record_my_game_result(text, uuid, text, text, int, int, numeric, int, boolean, jsonb) OWNER TO postgres;

-- ── get_my_account_stats ─────────────────────────────────────────────────────
-- Lifetime multiplayer summary. Win-rate is computed over multiplayer games only
-- (player_count >= 2) so solo rooms don't trivially inflate it.

CREATE OR REPLACE FUNCTION public.get_my_account_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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
ALTER FUNCTION public.get_my_account_stats() OWNER TO postgres;

-- ── get_my_game_history ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_game_history(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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
ALTER FUNCTION public.get_my_game_history(int) OWNER TO postgres;

-- ── Friends ──────────────────────────────────────────────────────────────────
-- A friend's "code" is simply their account id (used in the invite link). add_friend
-- creates a bidirectional friendship in one tap — no accept step, by design.

CREATE OR REPLACE FUNCTION public.add_friend(p_friend_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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
ALTER FUNCTION public.add_friend(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.remove_friend(p_friend_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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
ALTER FUNCTION public.remove_friend(uuid) OWNER TO postgres;

-- Each friend with their name + lifetime summary. Runs as postgres so it can read
-- auth.users for names and aggregate friends' results (which their own RLS hides).
CREATE OR REPLACE FUNCTION public.get_friends_with_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    RETURN jsonb_build_object('success', true, 'data', coalesce((
        SELECT jsonb_agg(row_to_json(f) ORDER BY lower(f.name))
        FROM (
            SELECT
                fr.friend_id AS id,
                coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1), 'Anonymous') AS name,
                (SELECT count(*) FROM account_game_results r WHERE r.account_id = fr.friend_id) AS games_played,
                (SELECT count(*) FROM account_game_results r WHERE r.account_id = fr.friend_id AND r.won) AS games_won,
                (SELECT coalesce(sum(r.categories_found), 0) FROM account_game_results r WHERE r.account_id = fr.friend_id) AS categories_found,
                (SELECT count(*) FROM daily_attempts a WHERE a.account_id = fr.friend_id AND NOT a.removed AND a.duration_ms IS NOT NULL) AS daily_completed
            FROM friendships fr
            JOIN auth.users u ON u.id = fr.friend_id
            WHERE fr.account_id = uid
        ) f
    ), '[]'::jsonb));
END;
$$;
ALTER FUNCTION public.get_friends_with_stats() OWNER TO postgres;

-- ── Extend self-service account deletion to the new tables ───────────────────
-- account_game_results cascades off auth.users; friendships rows where the caller
-- is the friend_id also cascade. Both are deleted explicitly first so the intent
-- and the exact data removed stay unambiguous (matches the original function).

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    caller uuid := auth.uid();
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    DELETE FROM community_presets   WHERE author_id = caller;  -- votes cascade
    DELETE FROM daily_attempts      WHERE account_id = caller;
    DELETE FROM account_game_results WHERE account_id = caller;
    DELETE FROM friendships         WHERE account_id = caller OR friend_id = caller;

    DELETE FROM auth.users WHERE id = caller;

    RETURN jsonb_build_object('success', true);
END;
$$;
ALTER FUNCTION public.delete_my_account() OWNER TO postgres;

-- ── Grants (mirror the codebase: anon + authenticated + service_role) ────────

GRANT ALL ON FUNCTION public.record_my_game_result(text, uuid, text, text, int, int, numeric, int, boolean, jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.get_my_account_stats()  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.get_my_game_history(int) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.add_friend(uuid)         TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.remove_friend(uuid)      TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.get_friends_with_stats() TO anon, authenticated, service_role;

GRANT SELECT ON TABLE public.account_game_results TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.friendships          TO anon, authenticated, service_role;
