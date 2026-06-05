-- =============================================================================
-- HOST SECRET: make registration self-healing (upsert instead of claim-once)
-- =============================================================================
-- Bug: host transfer left the new host unable to do anything (every host RPC
-- returned NOT_HOST). transfer_host deletes the server-side secret; the new host
-- is then supposed to register a fresh token. But the client only re-registered
-- when it had NO local token, and register_host_secret used ON CONFLICT DO
-- NOTHING. So if a client ever held a stale/invalid local token (e.g. a prior
-- registration that raced or failed), it would skip re-registration and the
-- server secret stayed missing — permanently poisoning the host: a reload didn't
-- help because the local-token guard still saw a token.
--
-- Fix (server side): register_host_secret now UPSERTS. The host_id == caller
-- check still gates it (host_id is only ever set via game creation or the
-- token-gated transfer_host, so only the legitimate public host passes), so
-- letting that host overwrite the secret is safe and lets a poisoned state
-- self-heal. The client change re-registers unconditionally on an actual host
-- transition, which together with this upsert keeps local token and server
-- secret in sync.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_host_secret(p_game_id text, p_player_id text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = p_player_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    -- Upsert: the rightful host (host_id == caller) can always (re)claim the
    -- secret, repairing a missing/mismatched server secret after a transfer.
    INSERT INTO game_host_secrets (game_id, host_token)
    VALUES (p_game_id, p_token)
    ON CONFLICT (game_id) DO UPDATE SET host_token = EXCLUDED.host_token;

    RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_host_secret(text, text, text) TO anon, authenticated, service_role;
