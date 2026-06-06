-- =============================================================================
-- COMMUNITY PRESET DATABASE
-- =============================================================================
-- Saveable, shareable game setups: a list of categories (each captured WITH its
-- Street View viewpoint), allow/forbid boundaries, and a starting point.
--
-- Identity model:
--   * SUBMITTING a preset requires a real account (auth.uid()).
--   * VOTING is anonymous and keyed by a per-browser device id (one vote per
--     device per preset, enforced by the votes PK).
--   * BROWSING / IMPORTING need no login (public SELECT).
--
-- All writes go through SECURITY DEFINER RPCs, matching the rest of the schema.
-- =============================================================================

-- TABLES ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_presets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    author_name     text,
    name            text NOT NULL,
    description     text,
    categories      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- CommunityCategory[]: { categoryName, lat, lng, heading, pitch, zoom }
    boundaries      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- BoundaryPolygon[]
    starting_point  text NOT NULL DEFAULT 'open-world',   -- 'open-world' or JSON {lat,lng}
    category_count  int NOT NULL DEFAULT 0,
    upvotes         int NOT NULL DEFAULT 0,
    downvotes       int NOT NULL DEFAULT 0,
    score           int GENERATED ALWAYS AS (upvotes - downvotes) STORED,
    status          text NOT NULL DEFAULT 'published',    -- 'published' | 'hidden'
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_presets_score_idx   ON public.community_presets (score DESC);
CREATE INDEX IF NOT EXISTS community_presets_created_idx ON public.community_presets (created_at DESC);
CREATE INDEX IF NOT EXISTS community_presets_author_idx  ON public.community_presets (author_id);

CREATE TABLE IF NOT EXISTS public.community_preset_votes (
    preset_id   uuid NOT NULL REFERENCES public.community_presets(id) ON DELETE CASCADE,
    device_id   text NOT NULL,
    value       smallint NOT NULL CHECK (value IN (-1, 1)),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (preset_id, device_id)
);

-- RLS -------------------------------------------------------------------------
-- Reads are public; all writes flow through the SECURITY DEFINER RPCs below
-- (which run as owner and bypass these policies).

ALTER TABLE public.community_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_preset_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published presets" ON public.community_presets;
CREATE POLICY "Public read published presets" ON public.community_presets
    FOR SELECT USING (status = 'published');

-- Votes are not sensitive; allow public read so a browser can show how its own
-- device voted (client filters by device_id). No write policy: writes via RPC.
DROP POLICY IF EXISTS "Public read votes" ON public.community_preset_votes;
CREATE POLICY "Public read votes" ON public.community_preset_votes
    FOR SELECT USING (true);

GRANT SELECT ON public.community_presets TO anon, authenticated;
GRANT SELECT ON public.community_preset_votes TO anon, authenticated;

-- RPCs ------------------------------------------------------------------------

-- Create a preset. Requires an authenticated caller; author_id is taken from
-- the verified JWT (never trusted from the client).
CREATE OR REPLACE FUNCTION public.create_community_preset(
    p_name           text,
    p_description    text,
    p_author_name    text,
    p_categories     jsonb,
    p_boundaries     jsonb,
    p_starting_point text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller uuid := auth.uid();
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

    -- Every category must carry a Street View viewpoint (the "category with view"
    -- invariant the voting UI relies on).
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_categories) c
        WHERE c->>'categoryName' IS NULL OR c->>'lat' IS NULL OR c->>'lng' IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_MISSING_VIEW');
    END IF;

    INSERT INTO community_presets (author_id, author_name, name, description, categories, boundaries, starting_point, category_count)
    VALUES (
        caller,
        NULLIF(trim(coalesce(p_author_name, '')), ''),
        trim(p_name),
        NULLIF(trim(coalesce(p_description, '')), ''),
        p_categories,
        COALESCE(p_boundaries, '[]'::jsonb),
        COALESCE(NULLIF(trim(p_starting_point), ''), 'open-world'),
        jsonb_array_length(p_categories)
    )
    RETURNING * INTO new_row;

    RETURN jsonb_build_object('success', true, 'data', row_to_json(new_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_community_preset TO authenticated, service_role;


-- Cast / toggle a device's vote on a preset, then recompute the cached counters.
-- Re-voting the same value clears it (toggle); the opposite value flips it.
CREATE OR REPLACE FUNCTION public.vote_community_preset(
    p_preset_id uuid,
    p_device_id text,
    p_value     smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    existing smallint;
    my_vote  smallint := 0;
    up_count int;
    down_count int;
BEGIN
    IF p_device_id IS NULL OR p_device_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_DEVICE');
    END IF;
    IF p_value NOT IN (-1, 1) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_VALUE');
    END IF;

    -- Serialise concurrent votes on the same preset.
    PERFORM 1 FROM community_presets WHERE id = p_preset_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    SELECT value INTO existing FROM community_preset_votes
    WHERE preset_id = p_preset_id AND device_id = p_device_id;

    IF existing = p_value THEN
        DELETE FROM community_preset_votes WHERE preset_id = p_preset_id AND device_id = p_device_id;
        my_vote := 0;
    ELSE
        INSERT INTO community_preset_votes (preset_id, device_id, value)
        VALUES (p_preset_id, p_device_id, p_value)
        ON CONFLICT (preset_id, device_id) DO UPDATE SET value = EXCLUDED.value, created_at = now();
        my_vote := p_value;
    END IF;

    SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)
    INTO up_count, down_count
    FROM community_preset_votes WHERE preset_id = p_preset_id;

    UPDATE community_presets SET upvotes = up_count, downvotes = down_count WHERE id = p_preset_id;

    RETURN jsonb_build_object('success', true, 'upvotes', up_count, 'downvotes', down_count, 'my_vote', my_vote);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vote_community_preset TO anon, authenticated, service_role;


-- Delete a preset. Only the author may delete (votes cascade).
CREATE OR REPLACE FUNCTION public.delete_community_preset(p_preset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller uuid := auth.uid();
BEGIN
    IF caller IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    DELETE FROM community_presets WHERE id = p_preset_id AND author_id = caller;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_OWNER_OR_MISSING');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_community_preset TO authenticated, service_role;
