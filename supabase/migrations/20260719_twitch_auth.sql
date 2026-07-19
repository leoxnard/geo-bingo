-- ============================================================================
-- TWITCH AUTH — link Twitch identities & gate joins on a linked Twitch account
-- ============================================================================
-- Two pieces:
--   1. A host lobby setting (games.require_twitch) that only lets players who
--      have connected a Twitch account join the game.
--   2. Server-side enforcement of that flag.
--
-- STORAGE DECISION (see task): the linked Twitch handle is NOT copied into a
-- profile column. Supabase already records the OAuth identity in auth.identities
-- when the user links Twitch (supabase.auth.linkIdentity / signInWithOAuth), so
-- that table is the single source of truth — no sync RPC, no drift on unlink.
-- The enforcement helper current_user_has_twitch() reads it directly (as
-- postgres, since auth.identities isn't readable by anon/authenticated). The UI
-- reads the handle for display via supabase.auth.getUserIdentities() client-side.
--
-- ENFORCEMENT SURFACE: joining a game is a direct RLS-guarded INSERT into
-- public.players (there is no join RPC), so the gate lives in that table's
-- INSERT policy — server-side and unbypassable. The host is always exempt so a
-- host who enabled the flag is never locked out of their own lobby.
-- ============================================================================

-- ── Schema: the host flag ────────────────────────────────────────────────────

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS require_twitch boolean NOT NULL DEFAULT false;

-- ── Helper: does the calling account have a linked Twitch identity? ──────────
-- SECURITY DEFINER so it can read auth.identities (owned by postgres). Returns
-- false for guests (auth.uid() IS NULL).

CREATE OR REPLACE FUNCTION public.current_user_has_twitch()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.identities
        WHERE user_id = auth.uid() AND provider = 'twitch'
    );
$$;
ALTER FUNCTION public.current_user_has_twitch() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.current_user_has_twitch() TO anon, authenticated, service_role;

-- ── Enforcement: extend the players INSERT policy ────────────────────────────
-- Original allowed any insert into a lobby-status game. Now, when the game has
-- require_twitch on, the inserted player must either BE the host row
-- (players.id = games.host_id) or belong to a Twitch-linked account.

DROP POLICY IF EXISTS "Insert players only into open lobbies" ON public.players;
CREATE POLICY "Insert players only into open lobbies" ON public.players
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.games
            WHERE games.id = players.game_id
              AND games.status = 'lobby'
              AND (
                  games.require_twitch = false
                  OR players.id::text = games.host_id
                  OR public.current_user_has_twitch()
              )
        )
    );

-- ── Allow the host to toggle the flag via update_game_settings ───────────────
-- Adds 'require_twitch' to the whitelist and the UPDATE clause.

CREATE OR REPLACE FUNCTION public.update_game_settings(p_game_id text, p_host_id text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    allowed_keys text[] := ARRAY[
        'categories', 'time_limit', 'game_mode', 'grid_size', 'team_mode',
        'starting_point', 'gameBoundary', 'end_condition', 'hide_minimap',
        'hide_map_symbols', 'suggested_categories', 'exclusive_mode',
        'category_source', 'generation_radius', 'generation_number',
        'category_details', 'language', 'categories_generated', 'ai_end_game',
        'ready_players', 'banned_players', 'difficulty',
        'category_translations', 'category_hint_translations', 'preset_categories',
        'scale_voting', 'translate_categories',
        'voting_mode', 'category_vote_modes', 'require_twitch'
    ];
    safe_patch jsonb;
BEGIN
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    IF safe_patch ? 'voting_mode' AND NOT (safe_patch->>'voting_mode' IN ('yes_no', 'scale', 'mixed')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_VOTING_MODE');
    END IF;

    UPDATE games SET
        categories            = COALESCE(safe_patch->'categories', categories),
        time_limit            = COALESCE((safe_patch->>'time_limit')::int, time_limit),
        game_mode             = COALESCE(safe_patch->>'game_mode', game_mode),
        grid_size             = COALESCE((safe_patch->>'grid_size')::int, grid_size),
        team_mode             = COALESCE(safe_patch->>'team_mode', team_mode),
        starting_point        = COALESCE(safe_patch->>'starting_point', starting_point),
        "gameBoundary"        = COALESCE(safe_patch->>'gameBoundary', "gameBoundary"),
        end_condition         = COALESCE(safe_patch->>'end_condition', end_condition),
        hide_minimap          = COALESCE((safe_patch->>'hide_minimap')::boolean, hide_minimap),
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
        difficulty            = COALESCE(safe_patch->>'difficulty', difficulty),
        category_translations      = COALESCE(safe_patch->'category_translations', category_translations),
        category_hint_translations = COALESCE(safe_patch->'category_hint_translations', category_hint_translations),
        preset_categories          = COALESCE(safe_patch->'preset_categories', preset_categories),
        scale_voting          = COALESCE((safe_patch->>'scale_voting')::boolean, scale_voting),
        translate_categories  = COALESCE((safe_patch->>'translate_categories')::boolean, translate_categories),
        voting_mode           = COALESCE(safe_patch->>'voting_mode', voting_mode),
        category_vote_modes   = COALESCE(safe_patch->'category_vote_modes', category_vote_modes),
        require_twitch        = COALESCE((safe_patch->>'require_twitch')::boolean, require_twitch),
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
ALTER FUNCTION public.update_game_settings(text, text, jsonb) OWNER TO postgres;
