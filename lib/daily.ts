/*
================================================================================
DAILY CHALLENGE — DATA LAYER
================================================================================
Thin wrappers over the daily-challenge SECURITY DEFINER RPCs (see
supabase/migrations/20260628_daily_challenge.sql). Mirrors lib/community.ts:
playing / leaderboard / stats work logged out (the anon identity is the
device id), while ranking + admin actions are enforced server-side via
auth.uid() / the admin allow-list.
================================================================================
*/

import { callGemini, withModelFallback } from '@/components/utils/geminiClient';
import type { DailyAdminChallenge, DailyCandidate, DailyChallenge, DailyFind, DailyLeaderboardEntry, DailyRecentChallenge, DailyStats, DailyViewpoint } from '@/components/utils/types';

import { track } from './analytics';
import { getDeviceId } from './deviceId';
import { LOCALE_CODES } from './i18n/locales';
import { supabase } from './supabase';

/** A category's per-locale text. Missing locales fall back to the original. */
export type CategoryTranslations = Record<string, string>;

function extractJsonArray(text: string): string {
    const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

// Gemini translates short scavenger-hunt labels into every locale in ONE
// context-aware call. Unlike DeepL's per-target auto-detect — which echoes
// compounds it can't translate ("Bauzaun") and drifts to different senses per
// language for ambiguous words ("Weg" → en "Gone" but fr "Route") — Gemini picks
// one concrete visual meaning and renders it consistently. Returns null on any
// failure so the caller can fall back to DeepL.
async function translateCategoriesViaGemini(texts: string[]): Promise<CategoryTranslations[] | null> {
    if (texts.length === 0) return [];
    const prompt = `You translate short category labels for a Google Street View visual scavenger-hunt game.
Each label names something a player must SPOT in Street View — a physical object, vehicle, building, sign, terrain feature, etc. Labels may be written in any language.

Translate every label into these locales (ISO 639-1): ${LOCALE_CODES.join(', ')}.
Rules:
- Choose the concrete, VISUAL meaning: the physical thing you could see from a street.
- Pick ONE meaning per label and translate that same meaning into every locale — never let different languages drift to different meanings.
- Always translate: never leave a label in its source language for a different locale (e.g. a German word must still become real English/Spanish/French/Chinese, not be copied verbatim).
- Keep each translation a short, natural noun phrase.

Labels (JSON array — keep this exact order):
${JSON.stringify(texts)}

Return ONLY a JSON array with one object per label, in the same order, each object having exactly these keys: ${LOCALE_CODES.map((c) => `"${c}"`).join(', ')}.`;

    try {
        const res = await withModelFallback(async (model) => {
            const r = await callGemini(
                model,
                {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: 'application/json' },
                },
                'free',
            );
            if (!r.ok) throw new Error('gemini request failed');
            return r;
        }, 'free');
        const data = await res.json();
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const parsed = JSON.parse(extractJsonArray(text)) as unknown;
        if (!Array.isArray(parsed) || parsed.length !== texts.length) return null;
        return texts.map((tx, i) => {
            const item = parsed[i] as Record<string, unknown> | undefined;
            const map: CategoryTranslations = {};
            for (const c of LOCALE_CODES) {
                const v = item?.[c];
                map[c] = typeof v === 'string' && v.trim() ? v.trim() : tx;
            }
            return map;
        });
    } catch {
        return null;
    }
}

// DeepL fallback: auto-detect the source per target and fill `out` in place.
async function deeplTranslateInto(slice: string[], out: CategoryTranslations[], offset: number): Promise<void> {
    try {
        const r = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: slice, targetLangs: LOCALE_CODES }),
        });
        if (!r.ok) return;
        const d = (await r.json()) as { translations?: Record<string, string[]> };
        if (!d.translations) return;
        for (const code of LOCALE_CODES) {
            const arr = d.translations[code];
            if (!Array.isArray(arr)) continue;
            slice.forEach((_, j) => {
                if (typeof arr[j] === 'string' && arr[j].trim()) out[offset + j][code] = arr[j];
            });
        }
    } catch {
        // keep originals for this chunk
    }
}

// Translate each name into every app locale. Gemini is primary (consistent,
// context-aware); DeepL covers any chunk Gemini couldn't return. Best-effort —
// anything still missing falls back to the original so adding never blocks.
export async function translateCategories(texts: string[]): Promise<CategoryTranslations[]> {
    const out: CategoryTranslations[] = texts.map((tx) => Object.fromEntries(LOCALE_CODES.map((c) => [c, tx])));
    const CHUNK = 40;
    for (let i = 0; i < texts.length; i += CHUNK) {
        const slice = texts.slice(i, i + CHUNK);
        const gem = await translateCategoriesViaGemini(slice);
        if (gem) {
            slice.forEach((_, j) => (out[i + j] = gem[j]));
            continue;
        }
        await deeplTranslateInto(slice, out, i);
    }
    return out;
}

export async function translateCategory(text: string): Promise<CategoryTranslations> {
    return (await translateCategories([text]))[0];
}

/** Resolve a challenge's category in the given locale, falling back to the canonical. */
export function resolveDailyCategory(c: { category: string; category_translations?: CategoryTranslations | null } | null | undefined, locale: string): string {
    if (!c) return '';
    return c.category_translations?.[locale]?.trim() || c.category;
}

/** Today's challenge date as a UTC 'YYYY-MM-DD' string (matches the DB scheduler). */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** Format a millisecond duration as m:ss (or h:mm:ss past an hour). */
export const formatDuration = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
};

export async function getDailyChallenge(date: string): Promise<DailyChallenge | null> {
    const { data, error } = await supabase.rpc('get_daily_challenge', { p_date: date });
    if (error) throw error;
    return data?.success ? (data.data as DailyChallenge) : null;
}

export async function getRecentDailyChallenges(): Promise<DailyRecentChallenge[]> {
    const { data, error } = await supabase.rpc('get_recent_daily_challenges');
    if (error) throw error;
    return (data ?? []) as DailyRecentChallenge[];
}

export async function getDailyLeaderboard(date: string): Promise<DailyLeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_daily_leaderboard', { p_date: date });
    if (error) throw error;
    return (data ?? []) as DailyLeaderboardEntry[];
}

export async function getMyDailyStats(): Promise<DailyStats | null> {
    const { data, error } = await supabase.rpc('get_my_daily_stats');
    if (error) throw error;
    return data?.success ? { completed: data.completed as number, won: data.won as number } : null;
}

export interface DailyFindsResult {
    success: boolean;
    error?: string;
    finds: DailyFind[];
}

export async function getDailyFinds(date: string): Promise<DailyFindsResult> {
    const { data, error } = await supabase.rpc('get_daily_finds', { p_date: date, p_device_id: getDeviceId() });
    if (error) throw error;
    if (!data?.success) return { success: false, error: data?.error, finds: [] };
    return { success: true, finds: (data.data ?? []) as DailyFind[] };
}

export interface DailyRpcResult {
    success: boolean;
    error?: string;
}

export interface StartAttemptResult {
    success: boolean;
    error?: string;
    started_at?: string;
    // returned when error === 'ALREADY_COMPLETED'
    forfeited?: boolean;
    duration_ms?: number;
}

export async function startDailyAttempt(date: string, force = false): Promise<StartAttemptResult> {
    const { data, error } = await supabase.rpc('start_daily_attempt', {
        p_date: date,
        p_device_id: getDeviceId(),
        p_force: force,
    });
    if (error) throw error;
    return data as StartAttemptResult;
}

export async function submitDailyAttempt(date: string, durationMs: number, view: DailyViewpoint, aiReason: string | null): Promise<DailyRpcResult> {
    const { data, error } = await supabase.rpc('submit_daily_attempt', {
        p_date: date,
        p_device_id: getDeviceId(),
        p_duration_ms: durationMs,
        p_lat: view.lat,
        p_lng: view.lng,
        p_heading: view.heading,
        p_pitch: view.pitch,
        p_zoom: view.zoom,
        p_ai_reason: aiReason,
    });
    if (error) throw error;
    // Duration only, rounded to whole seconds — no device id, no account, no
    // viewpoint. Enough to see whether the daily is too hard, nothing more.
    if (data?.success !== false) track('daily_completed', { duration_s: Math.round(durationMs / 1000) });
    return data as DailyRpcResult;
}

export async function forfeitDailyAttempt(date: string): Promise<DailyRpcResult> {
    const { data, error } = await supabase.rpc('forfeit_daily_attempt', { p_date: date, p_device_id: getDeviceId() });
    if (error) throw error;
    if (data?.success !== false) track('daily_forfeited');
    return data as DailyRpcResult;
}

export interface RevealResult {
    hasLocation: boolean;
    viewpoint?: DailyViewpoint;
}

export async function revealDailyLocation(date: string): Promise<RevealResult> {
    const { data, error } = await supabase.rpc('reveal_daily_location', { p_date: date });
    if (error) throw error;
    if (!data?.success || !data.has_location) return { hasLocation: false };
    return { hasLocation: true, viewpoint: data.data as DailyViewpoint };
}

export interface DownvoteResult {
    success: boolean;
    error?: string;
    downvotes: number;
    removed: boolean;
    my_downvote: boolean;
}

export async function downvoteDailyFind(attemptId: string): Promise<DownvoteResult> {
    const { data, error } = await supabase.rpc('downvote_daily_find', { p_attempt_id: attemptId, p_device_id: getDeviceId() });
    if (error) throw error;
    return data as DownvoteResult;
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function amIDailyAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('am_i_daily_admin');
    if (error) return false;
    return data === true;
}

export async function listDailyCandidates(status?: string): Promise<DailyCandidate[]> {
    const { data, error } = await supabase.rpc('admin_list_daily_candidates', { p_status: status ?? null });
    if (error) throw error;
    return (data ?? []) as DailyCandidate[];
}

export async function reviewDailyCandidate(id: string, decision: 'approved' | 'rejected' | 'pending', translations: CategoryTranslations | null = null): Promise<DailyRpcResult> {
    const { data, error } = await supabase.rpc('review_daily_candidate', { p_id: id, p_decision: decision, p_translations: translations });
    if (error) throw error;
    return data as DailyRpcResult;
}

// Persist a new queue order (candidate ids in the desired top-to-bottom order).
export async function reorderDailyCandidates(ids: string[]): Promise<DailyRpcResult> {
    const { data, error } = await supabase.rpc('admin_reorder_daily_candidates', { p_ids: ids });
    if (error) throw error;
    return data as DailyRpcResult;
}

// Rename a queued candidate, optionally re-storing its per-locale translations
// (the admin's client re-detects the language so renamed categories stay
// consistent across every app locale).
export async function editDailyCandidate(id: string, category: string, translations: CategoryTranslations | null = null): Promise<DailyRpcResult> {
    const { data, error } = await supabase.rpc('admin_edit_daily_candidate', { p_id: id, p_category: category, p_translations: translations });
    if (error) throw error;
    return data as DailyRpcResult;
}

// Remove a candidate from the queue outright (pending/approved; used ones stay).
export async function deleteDailyCandidate(id: string): Promise<DailyRpcResult> {
    const { data, error } = await supabase.rpc('admin_delete_daily_candidate', { p_id: id });
    if (error) throw error;
    return data as DailyRpcResult;
}

// Recent materialised challenges (today + previous days) for the admin editor.
export async function listAdminDailyChallenges(limit = 30): Promise<DailyAdminChallenge[]> {
    const { data, error } = await supabase.rpc('admin_list_daily_challenges', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as DailyAdminChallenge[];
}

// Edit a materialised challenge's category (+ re-stored translations). When the
// task changed, pass clearAttempts to also wipe that day's recorded plays.
export async function editDailyChallenge(date: string, category: string, translations: CategoryTranslations | null, clearAttempts: boolean): Promise<{ success: boolean; error?: string; cleared?: number }> {
    const { data, error } = await supabase.rpc('admin_edit_daily_challenge', { p_date: date, p_category: category, p_translations: translations, p_clear_attempts: clearAttempts });
    if (error) throw error;
    return data as { success: boolean; error?: string; cleared?: number };
}

// Add a candidate carrying a hidden answer viewpoint (`view`) and/or an
// admin-validated start point (`start`, where players spawn). With no start the
// resulting challenge is open-world.
export async function addDailyCandidate(category: string, source: 'ai' | 'manual', view: DailyViewpoint | null, start: { lat: number; lng: number } | null = null, boundary: string | null = null, translations: CategoryTranslations | null = null): Promise<DailyRpcResult> {
    const { data, error } = await supabase.rpc('admin_add_candidate', {
        p_category: category,
        p_source: source,
        p_lat: view?.lat ?? null,
        p_lng: view?.lng ?? null,
        p_heading: view?.heading ?? null,
        p_pitch: view?.pitch ?? null,
        p_zoom: view?.zoom ?? null,
        p_start_lat: start?.lat ?? null,
        p_start_lng: start?.lng ?? null,
        p_boundary: boundary,
        p_translations: translations,
    });
    if (error) throw error;
    return data as DailyRpcResult;
}

export interface DatabaseCandidateItem {
    name: string;
    translations: CategoryTranslations | null;
}

export async function addDatabaseCandidates(items: DatabaseCandidateItem[]): Promise<{ success: boolean; error?: string; added: number }> {
    const { data, error } = await supabase.rpc('admin_add_database_candidates', { p_items: items });
    if (error) throw error;
    return data as { success: boolean; error?: string; added: number };
}

export async function runDailyScheduler(): Promise<{ success: boolean; error?: string; created?: boolean; category?: string }> {
    const { data, error } = await supabase.rpc('admin_run_daily_scheduler');
    if (error) throw error;
    return data as { success: boolean; error?: string; created?: boolean; category?: string };
}

// Swap a day's challenge for the next approved candidate in the queue. The
// outgoing category returns to the queue; that day's attempts are cleared.
export async function replaceDailyChallenge(date: string): Promise<{ success: boolean; error?: string; category?: string }> {
    const { data, error } = await supabase.rpc('admin_replace_daily_challenge', { p_date: date });
    if (error) throw error;
    return data as { success: boolean; error?: string; category?: string };
}

// Delete a challenge entirely (wipes attempts, returns candidate to queue) and
// immediately replace it with the next approved candidate. If the queue is empty
// the day is left challengeless.
export async function deleteDailyChallenge(date: string): Promise<{ success: boolean; error?: string; category?: string }> {
    const { data, error } = await supabase.rpc('admin_delete_daily_challenge', { p_date: date });
    if (error) throw error;
    return data as { success: boolean; error?: string; category?: string };
}
