-- Per-player category translation.
--
-- When the host enables translate_categories, every player may pick their own
-- category display language (independent of the shared board language). The
-- category names shown to that player are translated client-side — reusing an
-- imported preset's aligned translations when available, otherwise via DeepL.
-- The canonical category strings stay the identity used for submissions and
-- voting, so this flag only affects display. Server-side we just persist the
-- host's on/off choice via update_game_settings.
--
-- Each player's chosen display language is persisted to their players row
-- (category_locale) so the host can see who has chosen and only start the game
-- once every player has picked one.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS translate_categories boolean DEFAULT false NOT NULL;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS category_locale text;

CREATE OR REPLACE FUNCTION public.update_game_settings(p_game_id text, p_host_id text, p_patch jsonb) RETURNS jsonb
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
        'scale_voting', 'translate_categories'
    ];
    safe_patch jsonb;
BEGIN
    -- p_host_id carries the host capability TOKEN, not a player id.
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;

    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
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

CREATE OR REPLACE FUNCTION public.update_player(p_id uuid, p_patch jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    allowed_keys text[] := ARRAY['name', 'score', 'bingo_board', 'team', 'path', 'game_id', 'category_locale'];
    safe_patch jsonb;
    new_game_id text;
    current_game_id text;
    target_status text;
    target_banned text[];
BEGIN
    SELECT jsonb_object_agg(key, value) INTO safe_patch
    FROM jsonb_each(p_patch)
    WHERE key = ANY(allowed_keys);

    IF safe_patch IS NULL OR safe_patch = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_VALID_KEYS');
    END IF;

    -- Police game_id changes (joins). Other field updates are unaffected.
    IF safe_patch ? 'game_id' THEN
        new_game_id := safe_patch->>'game_id';
        SELECT game_id INTO current_game_id FROM players WHERE id = p_id;

        SELECT status, COALESCE(banned_players, '{}'::text[])
        INTO target_status, target_banned
        FROM games WHERE id = new_game_id;

        IF target_status IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'GAME_NOT_FOUND');
        END IF;

        IF p_id::text = ANY(target_banned) THEN
            RETURN jsonb_build_object('success', false, 'error', 'BANNED');
        END IF;

        IF new_game_id IS DISTINCT FROM current_game_id AND target_status <> 'lobby' THEN
            RETURN jsonb_build_object('success', false, 'error', 'GAME_IN_PROGRESS');
        END IF;
    END IF;

    UPDATE players SET
        name         = COALESCE(safe_patch->>'name', name),
        score        = COALESCE((safe_patch->>'score')::int, score),
        bingo_board  = COALESCE(safe_patch->'bingo_board', bingo_board),
        team         = COALESCE((safe_patch->>'team')::int, team),
        path         = COALESCE(safe_patch->'path', path),
        game_id      = COALESCE(safe_patch->>'game_id', game_id),
        category_locale = COALESCE(safe_patch->>'category_locale', category_locale)
    WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;
