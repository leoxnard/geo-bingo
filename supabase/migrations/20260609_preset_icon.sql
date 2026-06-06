-- =============================================================================
-- COMMUNITY PRESET ICON
-- =============================================================================
-- Each preset carries a single display icon (an emoji) shown as the card banner
-- in the browse list, replacing the Street View thumbnails. Stored as plain text
-- (one emoji such as '🌍' or a country flag). Chosen by the author in the last
-- step of the builder.
-- =============================================================================

ALTER TABLE public.community_presets
    ADD COLUMN IF NOT EXISTS icon text;

-- Replace the create RPC with the +icon signature (drop the 11-arg version).
DROP FUNCTION IF EXISTS public.create_community_preset(text, text, text, jsonb, jsonb, text, int, text, text, int, jsonb);

CREATE OR REPLACE FUNCTION public.create_community_preset(
    p_name             text,
    p_description      text,
    p_author_name      text,
    p_categories       jsonb,
    p_boundaries       jsonb,
    p_starting_point   text,
    p_recommended_time int,
    p_difficulty       text,
    p_game_mode        text,
    p_grid_size        int,
    p_settings         jsonb,
    p_icon             text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller uuid := auth.uid();
    cat_count int;
    safe_mode text;
    safe_grid int;
    safe_diff text;
    new_row community_presets;
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'EMPTY_NAME');
    END IF;

    IF jsonb_typeof(p_categories) <> 'array' OR jsonb_array_length(p_categories) < 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_CATEGORIES');
    END IF;

    cat_count := jsonb_array_length(p_categories);

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_categories) c
        WHERE c->>'categoryName' IS NULL OR c->>'lat' IS NULL OR c->>'lng' IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_MISSING_VIEW');
    END IF;

    IF (
        SELECT count(DISTINCT lower(c->>'categoryName')) FROM jsonb_array_elements(p_categories) c
    ) <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_CATEGORY');
    END IF;

    safe_diff := CASE WHEN p_difficulty IN ('easy', 'medium', 'hard') THEN p_difficulty ELSE 'medium' END;
    safe_mode := CASE WHEN p_game_mode = 'bingo' THEN 'bingo' ELSE 'list' END;
    safe_grid := COALESCE(p_grid_size, 3);

    IF safe_mode = 'bingo' AND safe_grid * safe_grid <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'BINGO_GRID_MISMATCH');
    END IF;

    INSERT INTO community_presets (
        author_id, author_name, name, description, categories, boundaries,
        starting_point, category_count, recommended_time, difficulty, game_mode, grid_size, settings, icon
    )
    VALUES (
        caller,
        NULLIF(trim(coalesce(p_author_name, '')), ''),
        trim(p_name),
        NULLIF(trim(coalesce(p_description, '')), ''),
        p_categories,
        COALESCE(p_boundaries, '[]'::jsonb),
        COALESCE(NULLIF(trim(p_starting_point), ''), 'open-world'),
        cat_count,
        p_recommended_time,
        safe_diff,
        safe_mode,
        safe_grid,
        COALESCE(p_settings, '{}'::jsonb),
        NULLIF(trim(coalesce(p_icon, '')), '')
    )
    RETURNING * INTO new_row;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(new_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_community_preset TO authenticated, service_role;
