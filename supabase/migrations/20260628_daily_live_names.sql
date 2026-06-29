-- ============================================================================
-- Daily challenge: live account names + identity-based leaderboard highlight
-- ----------------------------------------------------------------------------
-- daily_attempts.player_name is a denormalized snapshot taken at submit time.
-- Renames only propagate forward, so rows created before a rename (or before
-- rename propagation existed) keep a stale name, and the hub highlight — which
-- matched the caller's row by NAME — silently breaks once the names diverge.
--
-- Fix: derive the display name LIVE from auth.users (mirroring displayNameFor:
-- display_name -> email local part -> stored name -> 'Anonymous'), so existing
-- and future rows always show the current name with no backfill. The
-- leaderboard also returns a `mine` flag keyed on account_id so the highlight
-- is identity-based and immune to name changes.
-- ============================================================================

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
