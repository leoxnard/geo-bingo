-- ============================================================================
-- COMMUNITY WORD POOL
-- ============================================================================
-- Crowd-sources a pool of category words from real finished games. A trigger
-- on games.status -> 'finished' harvests each qualifying board's words into
-- word_pool with per-word stats (games played in, times found & voted valid,
-- times imported via the lobby's Explore overlay). Manually-typed words wait
-- in an admin approval queue (reusing the daily-challenge admin allow-list);
-- AI-generated words are auto-approved. Nearby-places / nearby-street-view
-- games are never harvested (their words are hyper-local).
--
-- Words are stored in the game's category language (source language) and
-- carry a `translations` object with all five category languages, filled by
-- the admin's browser through the existing /api/translate proxy (Postgres
-- cannot call DeepL): at approve time for manual words, plus a backfill sweep
-- over untranslated rows whenever the admin page loads (covers auto-approved
-- AI words).
-- ============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.word_pool (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    word text NOT NULL,
    word_norm text NOT NULL,
    language text DEFAULT 'english'::text NOT NULL,
    translations jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    games_count integer DEFAULT 0 NOT NULL,
    found_count integer DEFAULT 0 NOT NULL,
    import_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by text,
    CONSTRAINT word_pool_pkey PRIMARY KEY (id),
    CONSTRAINT word_pool_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT word_pool_word_check CHECK (char_length(word) BETWEEN 1 AND 80),
    CONSTRAINT word_pool_word_norm_language_key UNIQUE (word_norm, language)
);

CREATE INDEX word_pool_status_imports_idx ON public.word_pool USING btree (status, import_count DESC);
CREATE INDEX word_pool_status_created_idx ON public.word_pool USING btree (status, created_at);

ALTER TABLE public.word_pool ENABLE ROW LEVEL SECURITY;

-- Clients may only see approved words; every write goes through the RPCs
-- below (no insert/update/delete policies, same as the daily tables).
CREATE POLICY "Public read approved pool words" ON public.word_pool FOR SELECT USING (status = 'approved');

GRANT ALL ON TABLE public.word_pool TO anon;
GRANT ALL ON TABLE public.word_pool TO authenticated;
GRANT ALL ON TABLE public.word_pool TO service_role;

-- Once-per-round harvest guard. Rematches re-stamp phase_started_at on the
-- next lobby -> playing transition, so a rematch round harvests again.
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS words_harvested_at timestamp with time zone;

-- ── Vote validity ────────────────────────────────────────────────────────────

-- Whether a submission's votes make it "found & accepted", mirroring the
-- client rules (components/utils/votes.ts + PodiumView): hype:* keys and the
-- host_continued sentinel never count; boolean yes/no votes present -> strict
-- majority yes; otherwise numeric scale votes present -> average >= 6; no real
-- votes -> not valid. (votes_all_yes is intentionally stricter — unanimous,
-- >= 2 boolean voters — and stays reserved for daily-challenge harvesting.)
CREATE OR REPLACE FUNCTION public.submission_is_valid(p_votes jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE
        WHEN count(*) FILTER (WHERE jsonb_typeof(value) = 'boolean') > 0
            THEN count(*) FILTER (WHERE value = to_jsonb(true)) * 2
                 > count(*) FILTER (WHERE jsonb_typeof(value) = 'boolean')
        WHEN count(*) FILTER (WHERE jsonb_typeof(value) = 'number') > 0
            THEN (avg((value #>> '{}')::numeric) FILTER (WHERE jsonb_typeof(value) = 'number')) >= 6
        ELSE false
    END
    FROM jsonb_each(coalesce(p_votes, '{}'::jsonb))
    WHERE key NOT LIKE 'hype:%' AND key <> 'host_continued';
$$;

-- ── Harvest trigger ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.harvest_pool_words() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    src_language text;
    word_status text;
BEGIN
    BEGIN
        -- Nearby-source boards name hyper-local features; never harvest them.
        IF NEW.category_source IN ('nearbyPlaces', 'nearbyStreetView') THEN
            RETURN NEW;
        END IF;

        -- Once per round (a rematch re-stamps phase_started_at, so it passes).
        IF NEW.words_harvested_at IS NOT NULL
           AND NEW.phase_started_at IS NOT NULL
           AND NEW.words_harvested_at >= NEW.phase_started_at THEN
            RETURN NEW;
        END IF;

        -- Quality gates: a real round, actually played out.
        -- Elapsed time is measured from the playing transition and includes
        -- voting time (there is no voting_started_at column) — acceptable,
        -- the admin queue is the real gate.
        IF NEW.phase_started_at IS NULL
           OR now() - NEW.phase_started_at
              < LEAST(make_interval(secs => coalesce(NEW.time_limit, 600)), interval '5 minutes') THEN
            RETURN NEW;
        END IF;
        IF (SELECT count(*) FROM players WHERE game_id = NEW.id) < 2 THEN
            RETURN NEW;
        END IF;
        IF (SELECT count(DISTINCT lower(btrim(w)))
            FROM jsonb_array_elements_text(coalesce(NEW.categories, '[]'::jsonb)) AS t(w)
            WHERE btrim(w) <> '') < 4 THEN
            RETURN NEW;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM submissions s
            WHERE s.game_id = NEW.id AND public.submission_is_valid(s.votes)
        ) THEN
            RETURN NEW;
        END IF;

        src_language := coalesce(nullif(NEW.language, ''), 'english');
        -- Only manually-typed words need admin review; AI words are pre-vetted
        -- by generation + this round's quality gates.
        word_status := CASE WHEN NEW.category_source = 'ai' THEN 'approved' ELSE 'pending' END;

        INSERT INTO word_pool (word, word_norm, language, status, games_count, found_count)
        SELECT DISTINCT ON (lower(btrim(w)))
            btrim(w),
            lower(btrim(w)),
            src_language,
            word_status,
            1,
            CASE WHEN EXISTS (
                SELECT 1 FROM submissions s
                WHERE s.game_id = NEW.id
                  AND lower(btrim(s.category)) = lower(btrim(w))
                  AND public.submission_is_valid(s.votes)
            ) THEN 1 ELSE 0 END
        FROM jsonb_array_elements_text(NEW.categories) AS t(w)
        WHERE btrim(w) <> '' AND char_length(btrim(w)) <= 80
        ORDER BY lower(btrim(w))
        ON CONFLICT (word_norm, language) DO UPDATE
        SET games_count = word_pool.games_count + 1,
            found_count = word_pool.found_count + EXCLUDED.found_count;

        -- Plain column update — does not re-fire the UPDATE OF status triggers.
        UPDATE games SET words_harvested_at = now() WHERE id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
        -- harvesting is best-effort; swallow any error so the game flow is unaffected
        NULL;
    END;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER harvest_pool_words_trg
    AFTER UPDATE OF status ON public.games
    FOR EACH ROW
    WHEN ((new.status = 'finished'::text) AND (old.status IS DISTINCT FROM 'finished'::text))
    EXECUTE FUNCTION public.harvest_pool_words();

GRANT ALL ON FUNCTION public.submission_is_valid(p_votes jsonb) TO anon;
GRANT ALL ON FUNCTION public.submission_is_valid(p_votes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.submission_is_valid(p_votes jsonb) TO service_role;

GRANT ALL ON FUNCTION public.harvest_pool_words() TO anon;
GRANT ALL ON FUNCTION public.harvest_pool_words() TO authenticated;
GRANT ALL ON FUNCTION public.harvest_pool_words() TO service_role;

-- ── Import counter ───────────────────────────────────────────────────────────

-- Best-effort popularity counter, bumped when a word is added or suggested via
-- the Explore overlay. Ids (not words) because with cross-language display the
-- row id is the stable identity. Unauthenticated by design; the 50-id cap
-- limits per-call abuse.
CREATE OR REPLACE FUNCTION public.import_pool_words(p_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) > 50 THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_IDS');
    END IF;

    UPDATE word_pool
    SET import_count = import_count + 1
    WHERE status = 'approved' AND id = ANY (p_ids);

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT ALL ON FUNCTION public.import_pool_words(p_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.import_pool_words(p_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.import_pool_words(p_ids uuid[]) TO service_role;

-- ── Admin RPCs (daily-challenge admin allow-list) ────────────────────────────

-- Full-dataset listing for /admin/words: NULL params mean "no filter"; the
-- client sorts further. Non-admins get an empty set.
CREATE OR REPLACE FUNCTION public.admin_list_pool_words(p_status text DEFAULT NULL, p_language text DEFAULT NULL, p_search text DEFAULT NULL) RETURNS SETOF public.word_pool
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT * FROM word_pool w
    WHERE (p_status IS NULL OR w.status = p_status)
      AND (p_language IS NULL OR w.language = p_language)
      AND (p_search IS NULL OR btrim(p_search) = '' OR w.word_norm ILIKE '%' || lower(btrim(p_search)) || '%')
    ORDER BY w.created_at DESC
    LIMIT 1000;
END;
$$;

-- Approve / reject a word (any status — an approved word can be retro-
-- rejected). On approve the admin browser passes the DeepL translations it
-- just fetched so the word becomes importable in every category language.
CREATE OR REPLACE FUNCTION public.admin_review_pool_word(p_id uuid, p_action text, p_translations jsonb DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    IF p_action NOT IN ('approved', 'rejected') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_ACTION');
    END IF;

    UPDATE word_pool
    SET status = p_action,
        reviewed_at = now(),
        reviewed_by = auth.jwt() ->> 'email',
        translations = CASE WHEN jsonb_typeof(p_translations) = 'object' THEN p_translations ELSE translations END
    WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Edit a word's text and/or source language (NULL param = unchanged). Editing
-- the text re-normalizes and expects freshly re-translated p_translations.
CREATE OR REPLACE FUNCTION public.admin_edit_pool_word(p_id uuid, p_word text DEFAULT NULL, p_language text DEFAULT NULL, p_translations jsonb DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    new_word text;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    IF p_word IS NOT NULL THEN
        new_word := btrim(p_word);
        IF char_length(new_word) NOT BETWEEN 1 AND 80 THEN
            RETURN jsonb_build_object('success', false, 'error', 'BAD_WORD');
        END IF;
    END IF;
    IF p_language IS NOT NULL AND p_language NOT IN ('german', 'english', 'spanish', 'french', 'chinese') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_LANGUAGE');
    END IF;

    BEGIN
        UPDATE word_pool
        SET word = coalesce(new_word, word),
            word_norm = lower(coalesce(new_word, word)),
            language = coalesce(p_language, language),
            translations = CASE WHEN jsonb_typeof(p_translations) = 'object' THEN p_translations ELSE translations END
        WHERE id = p_id;
    EXCEPTION WHEN unique_violation THEN
        -- The (word, language) pair already exists as another row; the admin
        -- deletes one copy instead (counter merging is a later enhancement).
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE');
    END;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Batch translation backfill ([{id, translations}, ...], cap 100) used by the
-- admin page's automatic sweep over rows with empty translations — notably
-- auto-approved AI words the harvest trigger could not translate itself.
CREATE OR REPLACE FUNCTION public.admin_set_pool_word_translations(p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    updated int;
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_ITEMS');
    END IF;

    WITH cleaned AS (
        SELECT (elem ->> 'id')::uuid AS id, elem -> 'translations' AS tr
        FROM jsonb_array_elements(p_items) AS t(elem)
        WHERE jsonb_typeof(elem -> 'translations') = 'object'
    ),
    upd AS (
        UPDATE word_pool w
        SET translations = cleaned.tr
        FROM cleaned
        WHERE w.id = cleaned.id
        RETURNING 1
    )
    SELECT count(*) INTO updated FROM upd;

    RETURN jsonb_build_object('success', true, 'updated', updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_pool_word(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.am_i_daily_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
    END IF;

    DELETE FROM word_pool WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT ALL ON FUNCTION public.admin_list_pool_words(p_status text, p_language text, p_search text) TO anon;
GRANT ALL ON FUNCTION public.admin_list_pool_words(p_status text, p_language text, p_search text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_pool_words(p_status text, p_language text, p_search text) TO service_role;

GRANT ALL ON FUNCTION public.admin_review_pool_word(p_id uuid, p_action text, p_translations jsonb) TO anon;
GRANT ALL ON FUNCTION public.admin_review_pool_word(p_id uuid, p_action text, p_translations jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.admin_review_pool_word(p_id uuid, p_action text, p_translations jsonb) TO service_role;

GRANT ALL ON FUNCTION public.admin_edit_pool_word(p_id uuid, p_word text, p_language text, p_translations jsonb) TO anon;
GRANT ALL ON FUNCTION public.admin_edit_pool_word(p_id uuid, p_word text, p_language text, p_translations jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.admin_edit_pool_word(p_id uuid, p_word text, p_language text, p_translations jsonb) TO service_role;

GRANT ALL ON FUNCTION public.admin_set_pool_word_translations(p_items jsonb) TO anon;
GRANT ALL ON FUNCTION public.admin_set_pool_word_translations(p_items jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_pool_word_translations(p_items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.admin_delete_pool_word(p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_delete_pool_word(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_delete_pool_word(p_id uuid) TO service_role;
