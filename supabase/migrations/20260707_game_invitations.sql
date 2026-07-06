-- ============================================================================
-- GAME INVITATIONS
-- ============================================================================
-- Lets a player already in a lobby pull a friend straight into the current game.
-- The invitee gets a realtime toast (postgres_changes INSERT on this table) with
-- a Join button and — after the toast is gone — the invite stays reachable from
-- the invitations button next to the options gear until it expires.
--
-- Invitations are valid for 2 MINUTES. Expiry is SILENT: get_my_game_invitations
-- only returns rows younger than 2 minutes, and send_game_invitation prunes stale
-- rows opportunistically. Only friends can be invited. game_id is the games.id
-- (text) join code; no FK, because games are ephemeral and reused across replays.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.game_invitations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id     text NOT NULL,
    inviter_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invitee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (inviter_id, invitee_id, game_id)
);
ALTER TABLE public.game_invitations OWNER TO postgres;
CREATE INDEX IF NOT EXISTS game_invitations_invitee_idx ON public.game_invitations (invitee_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.game_invitations ENABLE ROW LEVEL SECURITY;

-- Either party may read the invitation (the invitee to receive it, the inviter
-- for symmetry). Writes go only through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "Read own game invitations" ON public.game_invitations;
CREATE POLICY "Read own game invitations" ON public.game_invitations
    FOR SELECT USING (invitee_id = auth.uid() OR inviter_id = auth.uid());

-- ── Realtime: the invitee subscribes to INSERTs on their own rows ─────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'game_invitations'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.game_invitations;
    END IF;
END $$;

-- ── send_game_invitation: invite a friend into a game ────────────────────────

CREATE OR REPLACE FUNCTION public.send_game_invitation(p_game_id text, p_invitee_id uuid)
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
    IF p_game_id IS NULL OR btrim(p_game_id) = '' OR p_invitee_id IS NULL OR p_invitee_id = uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM friendships WHERE account_id = uid AND friend_id = p_invitee_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FRIENDS');
    END IF;

    -- Opportunistic prune so the table never grows past live invitations.
    DELETE FROM game_invitations WHERE created_at < now() - interval '2 minutes';

    -- Re-inviting to the same game refreshes the 2-minute window.
    INSERT INTO game_invitations (game_id, inviter_id, invitee_id)
    VALUES (p_game_id, uid, p_invitee_id)
    ON CONFLICT (inviter_id, invitee_id, game_id) DO UPDATE SET created_at = now();

    RETURN jsonb_build_object('success', true, 'name', public.account_display_name(p_invitee_id));
END;
$$;
ALTER FUNCTION public.send_game_invitation(text, uuid) OWNER TO postgres;

-- ── get_my_game_invitations: my live (< 2 min) invitations, newest first ─────

CREATE OR REPLACE FUNCTION public.get_my_game_invitations()
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
        SELECT jsonb_agg(row_to_json(i) ORDER BY i.created_at DESC)
        FROM (
            SELECT gi.id,
                   gi.game_id,
                   gi.inviter_id,
                   public.account_display_name(gi.inviter_id) AS inviter_name,
                   gi.created_at
            FROM game_invitations gi
            WHERE gi.invitee_id = uid
              AND gi.created_at > now() - interval '2 minutes'
        ) i
    ), '[]'::jsonb));
END;
$$;
ALTER FUNCTION public.get_my_game_invitations() OWNER TO postgres;

-- ── dismiss_game_invitation: the invitee drops an invite (declined / joined) ──

CREATE OR REPLACE FUNCTION public.dismiss_game_invitation(p_id uuid)
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
    DELETE FROM game_invitations WHERE id = p_id AND invitee_id = uid;
    RETURN jsonb_build_object('success', true);
END;
$$;
ALTER FUNCTION public.dismiss_game_invitation(uuid) OWNER TO postgres;

-- ── Extend self-service account deletion to drop invitations both ways ───────

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
    DELETE FROM game_invitations     WHERE inviter_id = caller OR invitee_id = caller;
    DELETE FROM friend_requests      WHERE requester_id = caller OR addressee_id = caller;
    DELETE FROM friendships          WHERE account_id = caller OR friend_id = caller;
    DELETE FROM profiles             WHERE id = caller;

    DELETE FROM auth.users WHERE id = caller;

    RETURN jsonb_build_object('success', true);
END;
$$;
ALTER FUNCTION public.delete_my_account() OWNER TO postgres;

-- ── Grants ───────────────────────────────────────────────────────────────────

GRANT ALL ON FUNCTION public.send_game_invitation(text, uuid) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.get_my_game_invitations()        TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.dismiss_game_invitation(uuid)    TO anon, authenticated, service_role;

GRANT SELECT ON TABLE public.game_invitations TO anon, authenticated, service_role;
