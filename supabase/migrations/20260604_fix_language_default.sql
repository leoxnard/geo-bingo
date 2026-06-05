-- ============================================================================
-- Fix the games.language default
-- ----------------------------------------------------------------------------
-- The default was stored as the literal string  'english'::text  (the EXPRESSION
-- text, quotes and cast included) instead of the value  english . Any games row
-- created relying on the DB default — rather than an explicit, client-supplied
-- language — therefore got a garbage value in `language`. The client normally
-- inserts an explicit language, so this rarely bit in practice, but it is a real
-- data-quality defect. Set the correct default and repair affected rows.
-- ============================================================================

ALTER TABLE public.games
    ALTER COLUMN language SET DEFAULT 'english';

-- Self-healing repair: rows that inherited the broken default literally contain
-- the 15-character string  'english'::text . Match it (note the doubled quotes
-- escape the embedded apostrophes) and reset to a valid language word.
UPDATE public.games
SET language = 'english'
WHERE language = '''english''::text';
