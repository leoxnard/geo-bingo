-- ============================================================================
-- UNIQUE USERNAMES & FRIEND REQUESTS
-- ============================================================================
-- Turns the free-form account display name into a globally UNIQUE username, and
-- replaces the instant one-tap friend add with a request → accept/decline flow.
--
-- Adding a friend (via invite link OR by username) now creates a pending
-- friend_request; the addressee accepts or declines it. Accepting materialises
-- the bidirectional row in `friendships` (unchanged). A reciprocal request
-- auto-accepts (both sides asked → instant friends).
--
-- Usernames live in `profiles` (one row per account, unique case-insensitively).
-- Existing accounts are backfilled from their current display name / email,
-- de-duplicated with a numeric suffix. set_username keeps community_presets'
-- author_name in sync; the client mirrors it into auth metadata for display.
-- ============================================================================

-- ── profiles: the unique username per account ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
    id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username    text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles OWNER TO postgres;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx ON public.profiles (lower(username));

-- Backfill every existing account with a unique username derived from its
-- current display name (or email local part), suffixing on collision.
DO $$
DECLARE
    u    record;
    base text;
    cand text;
    n    int;
BEGIN
    FOR u IN SELECT id, email, raw_user_meta_data->>'display_name' AS dn FROM auth.users LOOP
        IF EXISTS (SELECT 1 FROM public.profiles WHERE id = u.id) THEN CONTINUE; END IF;
        base := nullif(btrim(coalesce(u.dn, '')), '');
        IF base IS NULL THEN base := split_part(coalesce(u.email, ''), '@', 1); END IF;
        IF base IS NULL OR length(base) < 2 THEN base := 'player'; END IF;
        base := left(base, 30);
        cand := base;
        n := 1;
        WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(cand)) LOOP
            n := n + 1;
            cand := left(base, 26) || n::text;
        END LOOP;
        INSERT INTO public.profiles (id, username) VALUES (u.id, cand);
    END LOOP;
END $$;

-- ── friend_requests: pending, one row per (requester → addressee) ────────────

CREATE TABLE IF NOT EXISTS public.friend_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    addressee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (requester_id, addressee_id)
);
ALTER TABLE public.friend_requests OWNER TO postgres;
CREATE INDEX IF NOT EXISTS friend_requests_addressee_idx ON public.friend_requests (addressee_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

-- Usernames are public handles (needed to render friends / requests by name).
DROP POLICY IF EXISTS "Public read profiles" ON public.profiles;
CREATE POLICY "Public read profiles" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Read own friend requests" ON public.friend_requests;
CREATE POLICY "Read own friend requests" ON public.friend_requests
    FOR SELECT USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- ── set_username: claim/rename the unique username ───────────────────────────

CREATE OR REPLACE FUNCTION public.set_username(p_username text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    uid uuid := auth.uid();
    u   text := btrim(coalesce(p_username, ''));
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    IF length(u) < 2 OR length(u) > 30 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID');
    END IF;
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
ALTER FUNCTION public.set_username(text) OWNER TO postgres;

-- ── Friend requests ──────────────────────────────────────────────────────────

-- Resolve an account's public display name (username → email local part).
CREATE OR REPLACE FUNCTION public.account_display_name(p_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT coalesce(nullif(pr.username, ''), split_part(u.email, '@', 1), 'Anonymous')
    FROM auth.users u LEFT JOIN profiles pr ON pr.id = u.id
    WHERE u.id = p_id;
$$;
ALTER FUNCTION public.account_display_name(uuid) OWNER TO postgres;

-- Send a request to a specific account. A reciprocal pending request auto-accepts.
CREATE OR REPLACE FUNCTION public.send_friend_request(p_addressee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    uid   uuid := auth.uid();
    aname text;
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    IF p_addressee_id IS NULL OR p_addressee_id = uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_addressee_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    aname := public.account_display_name(p_addressee_id);

    IF EXISTS (SELECT 1 FROM friendships WHERE account_id = uid AND friend_id = p_addressee_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ALREADY_FRIENDS', 'name', aname);
    END IF;

    -- They already asked us → accept instead of creating a second request.
    IF EXISTS (SELECT 1 FROM friend_requests WHERE requester_id = p_addressee_id AND addressee_id = uid) THEN
        DELETE FROM friend_requests
        WHERE (requester_id = p_addressee_id AND addressee_id = uid)
           OR (requester_id = uid AND addressee_id = p_addressee_id);
        INSERT INTO friendships (account_id, friend_id) VALUES (uid, p_addressee_id) ON CONFLICT DO NOTHING;
        INSERT INTO friendships (account_id, friend_id) VALUES (p_addressee_id, uid) ON CONFLICT DO NOTHING;
        RETURN jsonb_build_object('success', true, 'status', 'accepted', 'name', aname);
    END IF;

    IF EXISTS (SELECT 1 FROM friend_requests WHERE requester_id = uid AND addressee_id = p_addressee_id) THEN
        RETURN jsonb_build_object('success', true, 'status', 'requested', 'name', aname);
    END IF;

    INSERT INTO friend_requests (requester_id, addressee_id) VALUES (uid, p_addressee_id)
        ON CONFLICT (requester_id, addressee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'status', 'requested', 'name', aname);
END;
$$;
ALTER FUNCTION public.send_friend_request(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.send_friend_request_by_username(p_username text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    uid    uuid := auth.uid();
    target uuid;
    u      text := btrim(coalesce(p_username, ''));
BEGIN
    IF uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;
    SELECT id INTO target FROM profiles WHERE lower(username) = lower(u);
    IF target IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
    END IF;
    RETURN public.send_friend_request(target);
END;
$$;
ALTER FUNCTION public.send_friend_request_by_username(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.accept_friend_request(p_requester_id uuid)
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
ALTER FUNCTION public.accept_friend_request(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.decline_friend_request(p_requester_id uuid)
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
    DELETE FROM friend_requests WHERE requester_id = p_requester_id AND addressee_id = uid;
    RETURN jsonb_build_object('success', true);
END;
$$;
ALTER FUNCTION public.decline_friend_request(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_incoming_friend_requests()
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
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC)
        FROM (
            SELECT fr.requester_id AS id, public.account_display_name(fr.requester_id) AS name, fr.created_at
            FROM friend_requests fr
            WHERE fr.addressee_id = uid
        ) r
    ), '[]'::jsonb));
END;
$$;
ALTER FUNCTION public.get_incoming_friend_requests() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_outgoing_friend_requests()
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
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC)
        FROM (
            SELECT fr.addressee_id AS id, public.account_display_name(fr.addressee_id) AS name, fr.created_at
            FROM friend_requests fr
            WHERE fr.requester_id = uid
        ) r
    ), '[]'::jsonb));
END;
$$;
ALTER FUNCTION public.get_outgoing_friend_requests() OWNER TO postgres;

-- ── get_friends_with_stats: name now comes from the unique username ──────────

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
ALTER FUNCTION public.get_friends_with_stats() OWNER TO postgres;

-- ── Extend self-service account deletion ─────────────────────────────────────

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

    DELETE FROM community_presets    WHERE author_id = caller;  -- votes cascade
    DELETE FROM daily_attempts       WHERE account_id = caller;
    DELETE FROM account_game_results WHERE account_id = caller;
    DELETE FROM friend_requests      WHERE requester_id = caller OR addressee_id = caller;
    DELETE FROM friendships          WHERE account_id = caller OR friend_id = caller;
    DELETE FROM profiles             WHERE id = caller;

    DELETE FROM auth.users WHERE id = caller;

    RETURN jsonb_build_object('success', true);
END;
$$;
ALTER FUNCTION public.delete_my_account() OWNER TO postgres;

-- ── Grants ───────────────────────────────────────────────────────────────────

GRANT ALL ON FUNCTION public.set_username(text)                       TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.account_display_name(uuid)               TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.send_friend_request(uuid)                TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.send_friend_request_by_username(text)    TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.accept_friend_request(uuid)              TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.decline_friend_request(uuid)             TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.get_incoming_friend_requests()           TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.get_outgoing_friend_requests()           TO anon, authenticated, service_role;

GRANT SELECT ON TABLE public.profiles        TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.friend_requests TO anon, authenticated, service_role;
