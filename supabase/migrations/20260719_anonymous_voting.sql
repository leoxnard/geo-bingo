-- ============================================================================
-- Anonymous voting: hide the submission author's identity during voting
-- ============================================================================
-- Host-controlled, set at lobby time. When on, the voting phase never names the
-- player whose journey/submission is being voted on (the replay still shows the
-- path, just not who it belongs to). Purely presentational — the vote plumbing
-- is unchanged.
-- ============================================================================

-- 1. Column --------------------------------------------------------------------
ALTER TABLE "public"."games"
    ADD COLUMN IF NOT EXISTS "anonymous_voting" boolean NOT NULL DEFAULT false;

-- 2. Allow it through the host-only settings writer ----------------------------
CREATE OR REPLACE FUNCTION "public"."update_game_settings"("p_game_id" "text", "p_host_id" "text", "p_patch" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
        'voting_mode', 'category_vote_modes', 'anonymous_voting'
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
        anonymous_voting      = COALESCE((safe_patch->>'anonymous_voting')::boolean, anonymous_voting),
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
