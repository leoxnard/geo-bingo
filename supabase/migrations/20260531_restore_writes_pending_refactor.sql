-- =============================================================================
-- RESTORE PERMISSIVE WRITE POLICIES (PENDING CLIENT REFACTOR)
-- =============================================================================
-- The previous migration (20260531_security_hardening.sql) added SECURITY
-- DEFINER RPCs for every write path and dropped the catch-all "Allow all on X"
-- policies. That was a complete-on-paper lockdown, but ~26 client call sites
-- still do direct supabase.from(...).update / insert / delete, so the app went
-- non-functional.
--
-- Until those call sites are refactored to use the new RPCs, this migration
-- re-opens UPDATE / DELETE / INSERT on the locked tables. Two things we
-- INTENTIONALLY do NOT roll back:
--
--   1. "Insert players only into open lobbies" stays — it's a genuine
--      constraint (no joining mid-round), and no current client breaks under
--      it because lobby join only fires before status leaves 'lobby'.
--
--   2. The new SECURITY DEFINER RPCs stay — they're available for gradual
--      adoption, and the SECURITY DEFINER additions to claim_exclusive_category
--      and register_vote are required for those two to keep working at all.
--
-- When the client refactor lands, this migration should be reverted (drop the
-- restored policies again) so the lockdown becomes real.
-- =============================================================================


-- games: permit any update (client uses this for status, settings,
-- ready_players, banned_players, host_id transfer, etc.).
DROP POLICY IF EXISTS "Allow public update games" ON public.games;
CREATE POLICY "Allow public update games"
    ON public.games
    FOR UPDATE
    USING (true)
    WITH CHECK (true);


-- players: permit update + delete. Insert stays governed by the
-- "Insert players only into open lobbies" policy we want to keep.
DROP POLICY IF EXISTS "Allow public update players" ON public.players;
CREATE POLICY "Allow public update players"
    ON public.players
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete players" ON public.players;
CREATE POLICY "Allow public delete players"
    ON public.players
    FOR DELETE
    USING (true);


-- submissions: permit insert / update / delete from clients.
DROP POLICY IF EXISTS "Allow public insert submissions" ON public.submissions;
CREATE POLICY "Allow public insert submissions"
    ON public.submissions
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update submissions" ON public.submissions;
CREATE POLICY "Allow public update submissions"
    ON public.submissions
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete submissions" ON public.submissions;
CREATE POLICY "Allow public delete submissions"
    ON public.submissions
    FOR DELETE
    USING (true);
