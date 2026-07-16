/*
================================================================================
COMMUNITY WORD POOL — DATA LAYER
================================================================================
Thin wrappers over the word-pool SECURITY DEFINER RPCs (see
supabase/migrations/20260710_word_pool.sql). Mirrors lib/daily.ts: browsing and
import counting work logged out, while moderation is enforced server-side via
the daily-challenge admin allow-list.

Words are harvested from finished games in the game's category language and
carry a `translations` object with all five category languages so any lobby
can import them. Translation runs in the admin's browser (Postgres cannot call
DeepL/Gemini): at approve time for manual words, plus a backfill sweep on the
admin page for auto-approved AI words.
================================================================================
*/

import { translateCategories } from './daily';
import { LOCALES, LOCALE_CODES, type CategoryLanguage } from './i18n/locales';
import { supabase } from './supabase';

export type PoolWordStatus = 'pending' | 'approved' | 'rejected';

/** A word's per-category-language text ('german' / 'english' / …). */
export type PoolWordTranslations = Partial<Record<CategoryLanguage, string>>;

export interface PoolWord {
    id: string;
    word: string;
    word_norm: string;
    /** SOURCE language — the category language of the game it was harvested from. */
    language: CategoryLanguage;
    translations: PoolWordTranslations;
    status: PoolWordStatus;
    /** Qualifying rounds the word appeared in. */
    games_count: number;
    /** Rounds with at least one valid (vote-accepted) find of it. */
    found_count: number;
    /** Times added or suggested via the Explore overlay (any language). */
    import_count: number;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
}

/**
 * The word's text in the given category language, or null when it has no
 * translation there yet (the overlay hides such rows until the admin
 * backfill sweep has translated them).
 */
export function displayWordFor(w: PoolWord, lang: CategoryLanguage): string | null {
    const translated = w.translations?.[lang]?.trim();
    if (translated) return translated;
    return w.language === lang ? w.word : null;
}

/** Share of qualifying rounds in which the word was found, or null before any round. */
export function findRateOf(w: PoolWord): number | null {
    return w.games_count > 0 ? w.found_count / w.games_count : null;
}

/**
 * All approved pool words (RLS hides pending/rejected rows), one pool for
 * every language. Filtering, sorting and search happen client-side over the
 * translated display names.
 */
export async function listPoolWords(): Promise<PoolWord[]> {
    const { data, error } = await supabase.from('word_pool').select('*').order('import_count', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data ?? []) as PoolWord[];
}

/** Bump the popularity counter for imported/suggested words. Best-effort. */
export async function registerWordImports(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
        await supabase.rpc('import_pool_words', { p_ids: ids });
    } catch {
        // counter is best-effort; never surface an error for it
    }
}

/**
 * Translate words into every category language (Gemini primary, DeepL
 * fallback — same pipeline as daily-challenge categories), keyed by the
 * category-language words the word_pool.translations column uses.
 */
export async function translatePoolWords(words: string[]): Promise<PoolWordTranslations[]> {
    const byLocale = await translateCategories(words);
    return byLocale.map((m) => {
        const out: PoolWordTranslations = {};
        for (const code of LOCALE_CODES) {
            const v = m?.[code];
            if (typeof v === 'string' && v.trim()) out[LOCALES[code].aiName] = v.trim();
        }
        return out;
    });
}

export async function translatePoolWord(word: string): Promise<PoolWordTranslations> {
    return (await translatePoolWords([word]))[0];
}

/** True when the word already has a non-empty text for every category language. */
export function isFullyTranslated(w: PoolWord): boolean {
    return LOCALE_CODES.every((code) => {
        const lang = LOCALES[code].aiName;
        return !!(w.translations?.[lang]?.trim() || (w.language === lang && w.word.trim()));
    });
}

// ── Admin (daily-challenge admin allow-list) ─────────────────────────────────

export interface PoolRpcResult {
    success: boolean;
    error?: string;
}

export interface PoolWordFilters {
    status?: PoolWordStatus | null;
    language?: CategoryLanguage | null;
    search?: string | null;
}

/** Full-dataset listing for /admin/words; omitted filters mean "all". */
export async function adminListPoolWords(filters: PoolWordFilters = {}): Promise<PoolWord[]> {
    const { data, error } = await supabase.rpc('admin_list_pool_words', {
        p_status: filters.status ?? null,
        p_language: filters.language ?? null,
        p_search: filters.search?.trim() || null,
    });
    if (error) throw error;
    return (data ?? []) as PoolWord[];
}

/**
 * Approve/reject a word (any status — approved words can be retro-rejected).
 * On approve, pass the translations just fetched via translatePoolWord so the
 * word becomes importable in every category language.
 */
export async function adminReviewPoolWord(id: string, action: 'approved' | 'rejected', translations: PoolWordTranslations | null = null): Promise<PoolRpcResult> {
    const { data, error } = await supabase.rpc('admin_review_pool_word', { p_id: id, p_action: action, p_translations: translations });
    if (error) throw error;
    return data as PoolRpcResult;
}

/**
 * Edit a word's text and/or source language (omitted fields stay unchanged).
 * Editing the text should pass freshly re-translated `translations`. Returns
 * error 'DUPLICATE' when the (word, language) pair already exists.
 */
export async function adminEditPoolWord(id: string, patch: { word?: string; language?: CategoryLanguage; translations?: PoolWordTranslations }): Promise<PoolRpcResult> {
    const { data, error } = await supabase.rpc('admin_edit_pool_word', {
        p_id: id,
        p_word: patch.word ?? null,
        p_language: patch.language ?? null,
        p_translations: patch.translations ?? null,
    });
    if (error) throw error;
    return data as PoolRpcResult;
}

/** Batch translation backfill used by the admin page's automatic sweep (cap 100). */
export async function adminSetPoolWordTranslations(items: { id: string; translations: PoolWordTranslations }[]): Promise<{ success: boolean; error?: string; updated?: number }> {
    const { data, error } = await supabase.rpc('admin_set_pool_word_translations', { p_items: items });
    if (error) throw error;
    return data as { success: boolean; error?: string; updated?: number };
}

export async function adminDeletePoolWord(id: string): Promise<PoolRpcResult> {
    const { data, error } = await supabase.rpc('admin_delete_pool_word', { p_id: id });
    if (error) throw error;
    return data as PoolRpcResult;
}
