-- =============================================================================
-- ONE SUBMISSION PER (GAME, PLAYER, CATEGORY)
-- =============================================================================
-- claim_category already does a SELECT-then-UPSERT under a row lock, but there is
-- no DB-level guarantee, so a race or legacy data could leave duplicate rows for
-- the same (game_id, player_id, category). Duplicates make the voting board /
-- replay pick an arbitrary (often stale) row. Deduplicate, then enforce it.
--
-- Keep the most recently captured row per group (highest captured_at, NULLs last;
-- ctid as a stable final tiebreak).
-- =============================================================================

DELETE FROM public.submissions a
USING public.submissions b
WHERE a.game_id = b.game_id
  AND a.player_id = b.player_id
  AND a.category = b.category
  AND a.ctid <> b.ctid
  AND (
        COALESCE(a.captured_at, 0) < COALESCE(b.captured_at, 0)
        OR (COALESCE(a.captured_at, 0) = COALESCE(b.captured_at, 0) AND a.ctid < b.ctid)
  );

ALTER TABLE public.submissions
    ADD CONSTRAINT submissions_game_player_category_key UNIQUE (game_id, player_id, category);
