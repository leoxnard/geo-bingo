-- =============================================================================
-- GAME PRESET CATEGORY POSITIONS
-- =============================================================================
-- When a game is forked from a community preset, the preset's category target
-- spots ([{ categoryName, lat, lng }, ...]) are copied onto the game so the
-- voting map can mark them for every player (and after a reload), not just the
-- importing host who held them in memory.
-- =============================================================================

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS preset_categories jsonb NOT NULL DEFAULT '[]'::jsonb;
