-- ============================================================================
-- Scheduled cleanup of stale games  (storage + spam protection)
-- ----------------------------------------------------------------------------
-- Games / players / submissions accrue forever otherwise, and game creation is a
-- public, unauthenticated INSERT — an easy way to bloat the database. This adds a
-- pg_cron job that hourly deletes any game with no activity for 24h. The FK
-- ON DELETE CASCADE chains then clean up players, submissions and
-- game_host_secrets automatically.
--
-- `updated_at` is set to now() on insert and bumped by the
-- update_games_updated_at trigger on every games UPDATE (status changes, setting
-- edits), so it tracks the last meaningful activity. A game untouched for 24h is
-- finished or abandoned.
--
-- NOTE: pg_cron must be enabled on the database. On Supabase you can also toggle
-- it under Database → Extensions; `CREATE EXTENSION` below is the SQL equivalent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.cleanup_stale_games()
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    deleted_count integer;
BEGIN
    WITH deleted AS (
        DELETE FROM public.games
        WHERE updated_at < now() - interval '24 hours'
        RETURNING id
    )
    SELECT count(*) INTO deleted_count FROM deleted;
    RETURN deleted_count;
END;
$$;

ALTER FUNCTION public.cleanup_stale_games() OWNER TO postgres;

-- Destructive + internal-only: never expose it to the public API roles. (Supabase
-- default privileges auto-grant EXECUTE on new public functions to anon/
-- authenticated, so the explicit REVOKEs are required, not just belt-and-braces.)
REVOKE ALL ON FUNCTION public.cleanup_stale_games() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_stale_games() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_stale_games() FROM authenticated;

-- (Re)register the hourly job idempotently — drop any existing job of the same
-- name first so re-running this migration doesn't create duplicates.
SELECT cron.unschedule('cleanup-stale-games')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stale-games');

SELECT cron.schedule('cleanup-stale-games', '0 * * * *', $$SELECT public.cleanup_stale_games();$$);
