-- =============================================================================
-- DAILY SERVER-SIDE TIMING
-- =============================================================================
-- Adds started_at to daily_attempts so the server can:
--   (1) detect in-progress sessions after a browser crash (crash recovery), and
--   (2) validate that the client-submitted duration can't be shorter than what
--       the server actually measured (anti-cheat).
-- get_daily_challenge gains a my_attempt field so the client uses the DB as the
-- authoritative source of play state instead of localStorage.
-- =============================================================================

-- 1. Schema change -------------------------------------------------------

ALTER TABLE public.daily_attempts ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- 2. start_daily_attempt -------------------------------------------------
-- Called by the client as soon as the player begins a run. Creates the attempt
-- row (with started_at = now()) or returns/resets an existing one.
-- p_force = true is an admin-only escape hatch to replay a finished challenge.

CREATE OR REPLACE FUNCTION public.start_daily_attempt(
    p_date      date,
    p_device_id text    DEFAULT '',
    p_force     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid      uuid := auth.uid();
    cid      uuid;
    cdate    date;
    existing daily_attempts%ROWTYPE;
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

    SELECT * INTO existing FROM daily_attempts WHERE challenge_id = cid AND account_id = uid;

    IF FOUND THEN
        IF (existing.duration_ms IS NOT NULL OR existing.forfeited) AND NOT p_force THEN
            RETURN jsonb_build_object(
                'success', false, 'error', 'ALREADY_COMPLETED',
                'forfeited',    existing.forfeited,
                'duration_ms',  existing.duration_ms
            );
        END IF;
        -- Reset the row (in-progress refresh or admin force)
        UPDATE daily_attempts
        SET started_at    = now(),
            duration_ms   = NULL,
            forfeited     = false,
            found_lat     = NULL, found_lng     = NULL,
            found_heading = NULL, found_pitch   = NULL, found_zoom = NULL,
            ai_reason     = NULL
        WHERE challenge_id = cid AND account_id = uid;
        RETURN jsonb_build_object('success', true, 'started_at', now());
    END IF;

    -- Fresh attempt
    INSERT INTO daily_attempts (challenge_id, account_id, device_id, player_name, started_at)
    VALUES (cid, uid, p_device_id, public.daily_caller_name(), now());
    RETURN jsonb_build_object('success', true, 'started_at', now());
END;
$$;

ALTER FUNCTION public.start_daily_attempt(date, text, boolean) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.start_daily_attempt(date, text, boolean) TO authenticated, service_role;

-- 3. Update get_daily_challenge -------------------------------------------
-- Now returns my_attempt for authenticated callers so the client never needs
-- localStorage to decide whether to show the play or done screen.

CREATE OR REPLACE FUNCTION public.get_daily_challenge(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c   daily_challenges%ROWTYPE;
    uid uuid := auth.uid();
BEGIN
    SELECT * INTO c FROM daily_challenges WHERE challenge_date = p_date;
    IF c.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CHALLENGE');
    END IF;
    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
        'id',                   c.id,
        'challenge_date',       c.challenge_date,
        'category',             c.category,
        'category_translations', c.category_translations,
        'source',               c.source,
        'has_location',         (c.lat IS NOT NULL),
        'boundary',             c.boundary,
        'start_lat',            c.start_lat,
        'start_lng',            c.start_lng,
        'created_at',           c.created_at,
        'my_attempt', CASE
            WHEN uid IS NULL THEN NULL::jsonb
            ELSE (
                SELECT jsonb_build_object(
                    'started_at',  a.started_at,
                    'duration_ms', a.duration_ms,
                    'forfeited',   a.forfeited
                )
                FROM daily_attempts a
                WHERE a.challenge_id = c.id AND a.account_id = uid
            )
        END
    ));
END;
$$;

-- 4. Update submit_daily_attempt ------------------------------------------
-- Validates that the client-submitted duration is not suspiciously shorter
-- than what the server measured (started_at → now()), catching obvious cheats.

CREATE OR REPLACE FUNCTION public.submit_daily_attempt(
    p_date        date,
    p_device_id   text,
    p_duration_ms bigint,
    p_lat         double precision,
    p_lng         double precision,
    p_heading     double precision,
    p_pitch       double precision,
    p_zoom        double precision,
    p_ai_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid          uuid := auth.uid();
    cid          uuid;
    cdate        date;
    v_started_at timestamptz;
    v_server_ms  bigint;
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

    -- Anti-cheat: client can't claim a time shorter than 80% of server-measured elapsed
    SELECT started_at INTO v_started_at
    FROM daily_attempts WHERE challenge_id = cid AND account_id = uid;
    IF v_started_at IS NOT NULL THEN
        v_server_ms := EXTRACT(EPOCH FROM (now() - v_started_at)) * 1000;
        IF p_duration_ms < v_server_ms * 0.8 THEN
            RETURN jsonb_build_object('success', false, 'error', 'DURATION_MISMATCH');
        END IF;
    END IF;

    INSERT INTO daily_attempts
        (challenge_id, account_id, device_id, player_name, duration_ms, forfeited,
         found_lat, found_lng, found_heading, found_pitch, found_zoom, ai_reason,
         started_at)
    VALUES
        (cid, uid, p_device_id, public.daily_caller_name(), p_duration_ms, false,
         p_lat, p_lng, p_heading, p_pitch, p_zoom, p_ai_reason,
         coalesce(v_started_at, now()))
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
