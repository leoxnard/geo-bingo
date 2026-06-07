-- =============================================================================
-- COMMUNITY PRESET EDITING + ACCOUNT-WIDE AUTHOR NAME
-- =============================================================================
-- Two related capabilities:
--   1. update_community_preset  — lets an author edit one of their own presets
--      (same validation as create; ownership enforced via author_id = auth.uid()).
--   2. rename_my_presets_author — gives each account a single display name shown
--      under every one of its presets: renaming rewrites author_name on ALL of
--      the caller's presets at once. The canonical name also lives in the auth
--      user's metadata (set client-side), so new presets pick it up too.
-- =============================================================================

-- 1) UPDATE -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_community_preset(
    p_id               uuid,
    p_name             text,
    p_description      text,
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
    updated_row community_presets;
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM community_presets WHERE id = p_id AND author_id = caller) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_OWNER_OR_MISSING');
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

    UPDATE community_presets SET
        name             = trim(p_name),
        description      = NULLIF(trim(coalesce(p_description, '')), ''),
        categories       = p_categories,
        boundaries       = COALESCE(p_boundaries, '[]'::jsonb),
        starting_point   = COALESCE(NULLIF(trim(p_starting_point), ''), 'open-world'),
        category_count   = cat_count,
        recommended_time = p_recommended_time,
        difficulty       = safe_diff,
        game_mode        = safe_mode,
        grid_size        = safe_grid,
        settings         = COALESCE(p_settings, '{}'::jsonb),
        icon             = NULLIF(trim(coalesce(p_icon, '')), ''),
        updated_at       = now()
    WHERE id = p_id AND author_id = caller
    RETURNING * INTO updated_row;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(updated_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_community_preset TO authenticated, service_role;

-- 2) ACCOUNT-WIDE RENAME ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_my_presets_author(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller uuid := auth.uid();
    safe_name text;
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    safe_name := NULLIF(trim(coalesce(p_name, '')), '');

    UPDATE community_presets SET author_name = safe_name WHERE author_id = caller;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_my_presets_author TO authenticated, service_role;
