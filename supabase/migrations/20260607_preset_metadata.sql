-- =============================================================================
-- COMMUNITY PRESET METADATA
-- =============================================================================
-- Adds author-supplied play hints to a preset:
--   * recommended_time : suggested round length in seconds
--   * difficulty       : 'easy' | 'medium' | 'hard' (informational)
--   * game_mode        : 'list' | 'bingo'
--   * grid_size        : bingo grid side (only meaningful when game_mode='bingo';
--                        requires category_count = grid_size^2)
-- The create RPC is replaced to accept and validate these.
-- =============================================================================

ALTER TABLE public.community_presets
    ADD COLUMN IF NOT EXISTS recommended_time int,
    ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'medium',
    ADD COLUMN IF NOT EXISTS game_mode text NOT NULL DEFAULT 'list',
    ADD COLUMN IF NOT EXISTS grid_size int NOT NULL DEFAULT 3;

-- Replace the create RPC with the extended signature (the old 6-arg version is
-- dropped so this is a true replace, not an overload).
DROP FUNCTION IF EXISTS public.create_community_preset(text, text, text, jsonb, jsonb, text);

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
    p_grid_size        int
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

    -- Every category must carry a Street View viewpoint.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_categories) c
        WHERE c->>'categoryName' IS NULL OR c->>'lat' IS NULL OR c->>'lng' IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_MISSING_VIEW');
    END IF;

    -- Reject duplicate category names (case-insensitive) defensively.
    IF (
        SELECT count(DISTINCT lower(c->>'categoryName')) FROM jsonb_array_elements(p_categories) c
    ) <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_CATEGORY');
    END IF;

    safe_diff := CASE WHEN p_difficulty IN ('easy', 'medium', 'hard') THEN p_difficulty ELSE 'medium' END;
    safe_mode := CASE WHEN p_game_mode = 'bingo' THEN 'bingo' ELSE 'list' END;
    safe_grid := COALESCE(p_grid_size, 3);

    -- Bingo requires a perfect-square category count matching the grid.
    IF safe_mode = 'bingo' AND safe_grid * safe_grid <> cat_count THEN
        RETURN jsonb_build_object('success', false, 'error', 'BINGO_GRID_MISMATCH');
    END IF;

    INSERT INTO community_presets (
        author_id, author_name, name, description, categories, boundaries,
        starting_point, category_count, recommended_time, difficulty, game_mode, grid_size
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
        safe_grid
    )
    RETURNING * INTO new_row;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(new_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_community_preset TO authenticated, service_role;
