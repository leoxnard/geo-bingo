-- =============================================================================
-- DAILY CHALLENGE
-- =============================================================================
-- One global challenge per day: find a single category in Street View as fast as
-- you can, race a global leaderboard, build a persistent account profile.
--
-- Identity model (mirrors community presets):
--   * RANKING / STATS / HISTORY require a real account (auth.uid()); only account
--     holders are recorded. Anonymous players play ephemerally (client-side only).
--   * DOWNVOTING a find is anonymous, keyed by a per-browser device id.
--   * The admin (allow-listed email) curates the candidate pool.
--
-- Category sourcing is fully admin-curated. Candidates flow in from:
--   (1) 'game'     — finds every player approved (unanimous yes-votes + AI-verified),
--                    auto-harvested by a trigger before cleanup_stale_games deletes them.
--   (2) 'ai'       — admin runs the Nearby Street View generator in their browser.
--   (3) 'manual'   — admin walks Street View and picks a viewpoint + category name.
--   (4) 'database' — generic built-in words, used as a FALLBACK pool only.
-- A pg_cron job materialises the next approved candidate each UTC day; categories
-- are never reused (normalised dedup).
--
-- All writes (and the sensitive reads that hide the answer location) go through
-- SECURITY DEFINER RPCs, matching the rest of the schema.
-- =============================================================================

-- TABLES ----------------------------------------------------------------------

-- The admin review/candidate pool.
CREATE TABLE IF NOT EXISTS public.daily_challenge_candidates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category      text NOT NULL,
    category_norm text NOT NULL,                       -- lower(trim(category)); dedup key
    source        text NOT NULL,                       -- 'game' | 'ai' | 'manual' | 'database'
    source_ref    text,                                -- game_id / preset_id / etc.
    lat           double precision,                    -- viewpoint => "located" challenge
    lng           double precision,
    heading       double precision,
    pitch         double precision,
    zoom          double precision,
    boundary      text,                                -- gameBoundary-style polygon JSON (reference)
    start_lat     double precision,
    start_lng     double precision,
    is_fallback   boolean NOT NULL DEFAULT false,      -- true => database fallback pool
    status        text NOT NULL DEFAULT 'pending',     -- 'pending' | 'approved' | 'rejected' | 'used'
    created_at    timestamptz NOT NULL DEFAULT now(),
    reviewed_at   timestamptz,
    reviewed_by   uuid
);

-- A category can enter the pool (and thus be used) at most once, ever.
CREATE UNIQUE INDEX IF NOT EXISTS daily_candidates_norm_uniq
    ON public.daily_challenge_candidates (category_norm);
CREATE INDEX IF NOT EXISTS daily_candidates_status_idx
    ON public.daily_challenge_candidates (status, is_fallback, created_at);

-- One materialised challenge per day.
CREATE TABLE IF NOT EXISTS public.daily_challenges (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_date date NOT NULL UNIQUE,
    candidate_id   uuid REFERENCES public.daily_challenge_candidates(id) ON DELETE SET NULL,
    category       text NOT NULL,
    source         text NOT NULL,
    lat            double precision,                   -- hidden answer viewpoint (NULL => open-world)
    lng            double precision,
    heading        double precision,
    pitch          double precision,
    zoom           double precision,
    boundary       text,
    start_lat      double precision,                  -- fixed daily start, identical for everyone
    start_lng      double precision,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_challenges_date_idx
    ON public.daily_challenges (challenge_date DESC);

-- Leaderboard entries (account holders only).
CREATE TABLE IF NOT EXISTS public.daily_attempts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id   uuid NOT NULL REFERENCES public.daily_challenges(id) ON DELETE CASCADE,
    account_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id      text,
    player_name    text,
    duration_ms    bigint,                             -- NULL while only forfeited
    forfeited      boolean NOT NULL DEFAULT false,
    found_lat      double precision,
    found_lng      double precision,
    found_heading  double precision,
    found_pitch    double precision,
    found_zoom     double precision,
    ai_reason      text,
    downvotes      int NOT NULL DEFAULT 0,
    downvoters     jsonb NOT NULL DEFAULT '{}'::jsonb, -- { <deviceId>: true }
    removed        boolean NOT NULL DEFAULT false,     -- hidden from the board (>=90% downvotes)
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (challenge_id, account_id)
);

CREATE INDEX IF NOT EXISTS daily_attempts_challenge_idx
    ON public.daily_attempts (challenge_id, removed, duration_ms);
CREATE INDEX IF NOT EXISTS daily_attempts_account_idx
    ON public.daily_attempts (account_id);

-- Admin allow-list (by email; resolved from the verified JWT).
CREATE TABLE IF NOT EXISTS public.daily_admins (
    email text PRIMARY KEY
);

-- RLS -------------------------------------------------------------------------
-- No SELECT/INSERT/UPDATE policies are defined, so direct table access by anon /
-- authenticated returns nothing and all reads + writes must go through the
-- SECURITY DEFINER RPCs below (which run as owner and bypass RLS). This keeps the
-- hidden answer location and the gated find-feed off the public API surface.

ALTER TABLE public.daily_challenge_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_challenges           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_attempts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_admins               ENABLE ROW LEVEL SECURITY;

-- HELPERS ---------------------------------------------------------------------

-- True when at least one non-hype boolean vote on a submission is YES.
-- Used to harvest finds that got at least one approval vote.
CREATE OR REPLACE FUNCTION public.votes_all_yes(p_votes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT count(*) FILTER (WHERE key NOT LIKE 'hype:%' AND value = to_jsonb(true)) >= 1
    FROM jsonb_each(coalesce(p_votes, '{}'::jsonb));
$$;

ALTER FUNCTION public.votes_all_yes(jsonb) OWNER TO postgres;

-- Is the current (authenticated) caller an allow-listed daily-challenge admin?
CREATE OR REPLACE FUNCTION public.am_i_daily_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM daily_admins
        WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

ALTER FUNCTION public.am_i_daily_admin() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.am_i_daily_admin() TO anon, authenticated, service_role;

-- The account display name for the verified caller (metadata display_name → email
-- local part → 'Anonymous'); mirrors displayNameFor() on the client.
CREATE OR REPLACE FUNCTION public.daily_caller_name()
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(
        NULLIF(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', '')), ''),
        NULLIF(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
        'Anonymous'
    );
$$;

ALTER FUNCTION public.daily_caller_name() OWNER TO postgres;

-- HARVEST (game source) -------------------------------------------------------
-- When a game transitions to 'finished', copy every located submission
-- that received at least one yes-vote into the candidate pool (deduped, never reusing
-- a category that already exists in the pool). Best-effort: a failure here must
-- never roll back the game's status change.
CREATE OR REPLACE FUNCTION public.harvest_daily_candidates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

ALTER FUNCTION public.harvest_daily_candidates() OWNER TO postgres;

DROP TRIGGER IF EXISTS harvest_daily_candidates_trg ON public.games;
CREATE TRIGGER harvest_daily_candidates_trg
    AFTER UPDATE OF status ON public.games
    FOR EACH ROW
    WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM 'finished')
    EXECUTE FUNCTION public.harvest_daily_candidates();

-- ADMIN RPCs ------------------------------------------------------------------

-- List candidates (optionally filtered by status) for the admin window.
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
        ORDER BY created_at DESC
        LIMIT 500;
END;
$$;

ALTER FUNCTION public.admin_list_daily_candidates(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_list_daily_candidates(text) TO authenticated, service_role;

-- Approve / reject a candidate (used for the game-harvested queue).
CREATE OR REPLACE FUNCTION public.review_daily_candidate(p_id uuid, p_decision text)
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
    SET status = p_decision, reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = p_id AND status <> 'used';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND_OR_USED');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.review_daily_candidate(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.review_daily_candidate(uuid, text) TO authenticated, service_role;

-- Add a pre-approved candidate (AI generation or manual selection). A candidate
-- carries EITHER a hidden answer viewpoint (p_lat/p_lng → revealed after the
-- player finishes) and/or an admin-validated start point (p_start_lat/p_start_lng
-- → where players spawn). With no start point the challenge is open-world.
DROP FUNCTION IF EXISTS public.admin_add_candidate(text, text, double precision, double precision, double precision, double precision, double precision, text);

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
    p_boundary text DEFAULT NULL
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
        (category, category_norm, source, lat, lng, heading, pitch, zoom, start_lat, start_lng, boundary, status, reviewed_at, reviewed_by)
    VALUES
        (trim(p_category), lower(trim(p_category)), p_source, p_lat, p_lng,
         coalesce(p_heading, 0), coalesce(p_pitch, 0), coalesce(p_zoom, 1),
         p_start_lat, p_start_lng,
         p_boundary, 'approved', now(), auth.uid())
    ON CONFLICT (category_norm) DO NOTHING;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION public.admin_add_candidate(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_add_candidate(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, text) TO authenticated, service_role;

-- Bulk-add generic database categories into the fallback pool.
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
        SELECT DISTINCT ON (lower(trim(v))) trim(v) AS cat, lower(trim(v)) AS norm
        FROM jsonb_array_elements_text(p_items) AS t(v)
        WHERE trim(v) <> ''
    ),
    ins AS (
        INSERT INTO daily_challenge_candidates
            (category, category_norm, source, is_fallback, status, reviewed_at, reviewed_by)
        SELECT cat, norm, 'database', true, 'approved', now(), auth.uid()
        FROM cleaned
        ON CONFLICT (category_norm) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO added FROM ins;

    RETURN jsonb_build_object('success', true, 'added', added);
END;
$$;

ALTER FUNCTION public.admin_add_database_candidates(jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_add_database_candidates(jsonb) TO authenticated, service_role;

-- SCHEDULER -------------------------------------------------------------------
-- Materialise today's challenge if it doesn't exist yet. Prefers curated approved
-- candidates (non-fallback, oldest first), then the database fallback pool. Never
-- reuses a category already used by a past challenge. Internal-only: invoked by
-- pg_cron and the admin wrapper below.
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
    ORDER BY reviewed_at NULLS LAST, created_at
    LIMIT 1;

    IF cand.id IS NULL THEN
        SELECT * INTO cand FROM daily_challenge_candidates
        WHERE status = 'approved' AND is_fallback = true
          AND category_norm NOT IN (SELECT lower(trim(category)) FROM daily_challenges)
        ORDER BY created_at
        LIMIT 1;
    END IF;

    IF cand.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CANDIDATE');
    END IF;

    -- The start point is ONLY ever the admin-validated one on the candidate. When
    -- the admin didn't set one (start_lat/lng NULL), the challenge is true
    -- open-world: the play view drops the player on a world map to navigate freely
    -- (no forced spawn that could trap them indoors).
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
REVOKE ALL ON FUNCTION public.ensure_daily_challenge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_daily_challenge() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_daily_challenge() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_daily_challenge() TO service_role;

-- Admin-triggered "generate today's challenge now" (after curating the queue).
CREATE OR REPLACE FUNCTION public.admin_run_daily_scheduler()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    RETURN public.ensure_daily_challenge();
END;
$$;

ALTER FUNCTION public.admin_run_daily_scheduler() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_run_daily_scheduler() TO authenticated, service_role;

-- PLAY / LEADERBOARD RPCs -----------------------------------------------------

-- Today's (or a given day's) challenge WITHOUT the hidden answer coordinates.
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
GRANT EXECUTE ON FUNCTION public.get_daily_challenge(date) TO anon, authenticated, service_role;

-- The last 7 days of challenges with the caller's per-day status (account only).
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
GRANT EXECUTE ON FUNCTION public.get_recent_daily_challenges() TO anon, authenticated, service_role;

-- Ranked leaderboard for a day (account holders, non-removed, fastest first).
CREATE OR REPLACE FUNCTION public.get_daily_leaderboard(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'rank', rn, 'name', player_name, 'duration_ms', duration_ms, 'created_at', created_at
        ) ORDER BY rn)
        FROM (
            SELECT a.player_name, a.duration_ms, a.created_at,
                   row_number() OVER (ORDER BY a.duration_ms ASC, a.created_at ASC) AS rn
            FROM daily_attempts a
            JOIN daily_challenges dc ON dc.id = a.challenge_id
            WHERE dc.challenge_date = p_date AND NOT a.removed AND a.duration_ms IS NOT NULL
        ) ranked
        WHERE rn <= 100
    ), '[]'::jsonb);
END;
$$;

ALTER FUNCTION public.get_daily_leaderboard(date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_daily_leaderboard(date) TO anon, authenticated, service_role;

-- The caller's lifetime stats (completed / won).
CREATE OR REPLACE FUNCTION public.get_my_daily_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

ALTER FUNCTION public.get_my_daily_stats() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_my_daily_stats() TO anon, authenticated, service_role;

-- The find feed for a day. Hidden until the caller has their own attempt (account
-- holders); anonymous callers are gated client-side (consistent with client-trust).
CREATE OR REPLACE FUNCTION public.get_daily_finds(p_date date, p_device_id text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
            'name', a.player_name,
            'duration_ms', a.duration_ms,
            'lat', a.found_lat, 'lng', a.found_lng,
            'heading', a.found_heading, 'pitch', a.found_pitch, 'zoom', a.found_zoom,
            'downvotes', a.downvotes,
            'my_downvote', (a.downvoters ? p_device_id)
        ) ORDER BY a.duration_ms ASC NULLS LAST)
        FROM daily_attempts a
        WHERE a.challenge_id = cid AND NOT a.removed AND a.duration_ms IS NOT NULL
    ), '[]'::jsonb));
END;
$$;

ALTER FUNCTION public.get_daily_finds(date, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_daily_finds(date, text) TO anon, authenticated, service_role;

-- Record a (client-AI-verified) completion. Account holders only; one per day;
-- overwrites only a prior forfeit, never an existing time. Challenges expire after 7 days.
CREATE OR REPLACE FUNCTION public.submit_daily_attempt(
    p_date date,
    p_device_id text,
    p_duration_ms bigint,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_pitch double precision,
    p_zoom double precision,
    p_ai_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

ALTER FUNCTION public.submit_daily_attempt(date, text, bigint, double precision, double precision, double precision, double precision, double precision, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.submit_daily_attempt(date, text, bigint, double precision, double precision, double precision, double precision, double precision, text) TO authenticated, service_role;

-- Mark a forfeit (account holders); frees the location reveal. No-op if an attempt exists.
CREATE OR REPLACE FUNCTION public.forfeit_daily_attempt(p_date date, p_device_id text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

ALTER FUNCTION public.forfeit_daily_attempt(date, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.forfeit_daily_attempt(date, text) TO authenticated, service_role;

-- Reveal the answer location (called by the client only after success / forfeit).
-- Returns nothing for open-world (database-sourced) challenges.
CREATE OR REPLACE FUNCTION public.reveal_daily_location(p_date date)
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
    IF c.lat IS NULL THEN
        RETURN jsonb_build_object('success', true, 'has_location', false);
    END IF;
    RETURN jsonb_build_object('success', true, 'has_location', true, 'data', jsonb_build_object(
        'lat', c.lat, 'lng', c.lng, 'heading', c.heading, 'pitch', c.pitch, 'zoom', c.zoom
    ));
END;
$$;

ALTER FUNCTION public.reveal_daily_location(date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.reveal_daily_location(date) TO anon, authenticated, service_role;

-- Toggle a device's downvote on a find, recompute the count, and remove the find
-- from the board once >=90% of the day's other completers (>=3 votes) downvoted it.
CREATE OR REPLACE FUNCTION public.downvote_daily_find(p_attempt_id uuid, p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

ALTER FUNCTION public.downvote_daily_find(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.downvote_daily_find(uuid, text) TO anon, authenticated, service_role;

-- GRANTS (tables) -------------------------------------------------------------
-- Base-table privileges are granted to match Supabase defaults; RLS (no policies)
-- still blocks all direct access, forcing everything through the RPCs above.
GRANT ALL ON TABLE public.daily_challenge_candidates TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.daily_challenges           TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.daily_attempts             TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.daily_admins               TO anon, authenticated, service_role;

-- SEED + SCHEDULE -------------------------------------------------------------

-- Admin allow-list. leoxnard123@gmail.com is the app's Supabase Auth account;
-- leonardsima02@gmail.com is kept too. Add more rows to grant admin to others.
INSERT INTO public.daily_admins (email) VALUES
    ('leoxnard123@gmail.com'),
    ('leonardsima02@gmail.com')
ON CONFLICT DO NOTHING;

-- pg_cron is already enabled by 20260604_cleanup_stale_games.sql; ensure it here
-- too so this migration is safe to apply standalone.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Daily at 00:00 UTC. Re-register idempotently.
SELECT cron.unschedule('ensure-daily-challenge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ensure-daily-challenge');

SELECT cron.schedule('ensure-daily-challenge', '0 0 * * *', $$SELECT public.ensure_daily_challenge();$$);

-- Try to materialise today's challenge immediately (no-op if no approved candidates yet).
SELECT public.ensure_daily_challenge();
