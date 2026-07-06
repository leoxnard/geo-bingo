-- Server-authoritative round timing.
--
-- Previously the round deadline was seeded into localStorage by whichever
-- client first observed status = 'playing', so a player who refreshed or
-- joined mid-round computed a fresh full-length timer — and if that client
-- was (or became) host, its wrong clock drove the real phase transition.
--
-- phase_started_at is stamped server-side in the same UPDATE that flips the
-- game into 'playing', so every client derives the same deadline from
-- phase_started_at + time_limit.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS phase_started_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.set_game_status(p_game_id text, p_host_id text, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF p_status NOT IN ('lobby', 'playing', 'voting', 'finished') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_STATUS');
    END IF;
    IF NOT public.is_valid_host(p_game_id, p_host_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_HOST');
    END IF;
    UPDATE games
    SET status = p_status,
        phase_started_at = CASE WHEN p_status = 'playing' AND status IS DISTINCT FROM 'playing' THEN now() ELSE phase_started_at END,
        finished_at = CASE WHEN p_status = 'finished' THEN now() ELSE finished_at END
    WHERE id = p_game_id;
    RETURN jsonb_build_object('success', true);
END;
$$;
