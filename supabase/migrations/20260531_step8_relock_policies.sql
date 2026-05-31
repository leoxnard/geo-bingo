-- =============================================================================
-- STEP 8 — RE-LOCK THE WRITE POLICIES (the real lockdown)
-- =============================================================================
-- 20260531_restore_writes_pending_refactor.sql re-opened UPDATE / DELETE /
-- INSERT on games / players / submissions so the app kept working while the
-- ~26 client call sites were migrated onto the SECURITY DEFINER RPCs. That
-- refactor is now done: every privileged mutation goes through an RPC that
-- validates host_id / player_id and whitelists the columns it touches.
--
-- So we drop the catch-all write policies. SECURITY DEFINER functions run as
-- the table owner and bypass RLS, so the RPCs keep working; only *direct*
-- client writes are now denied.
--
-- Final policy surface after this migration:
--   games        SELECT (open) + INSERT (open, game creation is the entry point)
--   players      SELECT (open) + INSERT (only into lobbies, status = 'lobby')
--   submissions  SELECT (open)
--   everything else (games/players UPDATE+DELETE, all submission writes) → RPC only
-- =============================================================================


-- games: drop direct UPDATE. status / settings / host transfer all go through
-- set_game_status, update_game_settings, transfer_host. INSERT stays open.
DROP POLICY IF EXISTS "Allow public update games" ON public.games;


-- players: drop direct UPDATE + DELETE. Self-edits go through update_player;
-- kick/ban go through delete_player. INSERT stays governed by
-- "Insert players only into open lobbies".
DROP POLICY IF EXISTS "Allow public update players" ON public.players;
DROP POLICY IF EXISTS "Allow public delete players" ON public.players;


-- submissions: drop direct INSERT / UPDATE / DELETE. Claims go through
-- claim_category / claim_exclusive_category; AI verdicts through
-- set_submission_ai_verdict; votes through register_vote; deletes through
-- delete_submission / clear_submissions_for_game.
DROP POLICY IF EXISTS "Allow public insert submissions" ON public.submissions;
DROP POLICY IF EXISTS "Allow public update submissions" ON public.submissions;
DROP POLICY IF EXISTS "Allow public delete submissions" ON public.submissions;
