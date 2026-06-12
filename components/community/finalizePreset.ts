/*
================================================================================
PRESET FINALIZE (icon + language + translations)
================================================================================
Replaces the manual emoji picker. On publish we ask Gemini (one request) to:
  * pick a single emoji that represents the whole preset, and
  * detect the ISO 639-1 language the categories are written in.
Then DeepL (/api/translate) translates the category names into every app
language so an imported game can display them in any single board language.

Everything degrades gracefully: a failed Gemini call yields an empty icon (the
caller keeps the existing/fallback emoji) and a failed/partial DeepL call is
back-filled with the original names, so publishing never blocks on the AI.
================================================================================
*/

import { callGemini, withModelFallback } from '@/components/utils/geminiClient';
import { LOCALE_CODES } from '@/lib/i18n/locales';

export interface FinalizeResult {
    /** Gemini-picked emoji, or '' when the call failed (caller supplies a fallback). */
    icon: string;
    /** Detected ISO 639-1 language code of the categories (best-effort, may be ''). */
    language: string;
    /** Category names per app locale, aligned to the input order; always complete. */
    translations: Record<string, string[]>;
    /** Preset name per app locale; always complete (falls back to the original). */
    titleTranslations: Record<string, string>;
    /** Preset description per app locale; always complete (falls back to the original). */
    descriptionTranslations: Record<string, string>;
    /** Category hints per app locale, aligned to the input order; always complete. */
    hintTranslations: Record<string, string[]>;
}

// /api/translate caps each request at 60 texts, so translate in chunks and stitch
// the per-locale arrays back together. A failed chunk leaves its locale short,
// which the caller's length check back-fills with the originals.
const TRANSLATE_CHUNK = 50;

async function translateInChunks(texts: string[], sourceLang: string | undefined): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (let i = 0; i < texts.length; i += TRANSLATE_CHUNK) {
        const slice = texts.slice(i, i + TRANSLATE_CHUNK);
        try {
            const r = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts: slice, targetLangs: LOCALE_CODES, sourceLang }),
            });
            if (!r.ok) continue;
            const d = (await r.json()) as { translations?: Record<string, string[]> };
            if (!d.translations) continue;
            for (const code of LOCALE_CODES) {
                const arr = d.translations[code];
                if (Array.isArray(arr)) (out[code] ??= []).push(...arr);
            }
        } catch {
            // Skip this chunk; the caller's length check falls back to originals.
        }
    }
    return out;
}

function extractJson(text: string): string {
    const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? match[0] : cleaned;
}

export async function finalizePreset(input: { name: string; description: string; categoryNames: string[]; categoryHints?: string[] }): Promise<FinalizeResult> {
    const { name, description, categoryNames, categoryHints = [] } = input;

    // 1) Gemini — one request for both the emoji and the source language.
    let icon = '';
    let language = '';
    try {
        const prompt = `You are labelling a geography street-view mini-game preset.
Preset name: ${name}
Description: ${description || '(none)'}
Categories players hunt for: ${categoryNames.join(', ')}

Return ONLY a compact JSON object with exactly these two keys:
- "emoji": a single emoji that best represents this preset as a whole.
- "language": the ISO 639-1 code (two lowercase letters) of the language the categories are written in.
Example: {"emoji":"🗼","language":"fr"}`;

        const res = await withModelFallback(async (model) => {
            const r = await callGemini(model, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' },
            });
            if (!r.ok) throw new Error('gemini request failed');
            return r;
        });
        const data = await res.json();
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const parsed = JSON.parse(extractJson(text)) as { emoji?: unknown; language?: unknown };
        if (typeof parsed.emoji === 'string') icon = parsed.emoji.trim();
        if (typeof parsed.language === 'string') language = parsed.language.trim().toLowerCase();
    } catch {
        // Leave icon/language empty — handled by fallbacks below + the caller.
    }

    // 2) DeepL — translate into every app language, letting DeepL auto-detect the
    // source per batch. We deliberately do NOT pin Gemini's detected `language`:
    // it's inferred from a prompt that also contains the title, so a title written
    // in a different language than the categories biased it to the wrong code —
    // and a wrong source_lang makes DeepL return the text untranslated (e.g. German
    // categories came back unchanged for English). Title/description are a separate
    // batch from categories/hints since they're often in different languages.
    const hasDesc = !!description.trim();
    const catTexts = [...categoryNames, ...categoryHints];
    const metaTexts = [name, ...(hasDesc ? [description] : [])];

    const [rawCats, rawMeta] = await Promise.all([catTexts.length ? translateInChunks(catTexts, undefined) : Promise.resolve<Record<string, string[]>>({}), translateInChunks(metaTexts, undefined)]);

    // Split each locale's batches back into categories / hints and title / description,
    // and guarantee a complete map: any missing/partial locale falls back to originals.
    const translations: Record<string, string[]> = {};
    const titleTranslations: Record<string, string> = {};
    const descriptionTranslations: Record<string, string> = {};
    const hintTranslations: Record<string, string[]> = {};
    for (const code of LOCALE_CODES) {
        const cArr = rawCats[code];
        const cOk = Array.isArray(cArr) && cArr.length === catTexts.length;
        translations[code] = cOk ? cArr.slice(0, categoryNames.length) : categoryNames;
        hintTranslations[code] = cOk ? cArr.slice(categoryNames.length) : categoryHints;

        const mArr = rawMeta[code];
        const mOk = Array.isArray(mArr) && mArr.length === metaTexts.length;
        titleTranslations[code] = mOk ? mArr[0] : name;
        descriptionTranslations[code] = hasDesc ? (mOk ? mArr[1] : description) : '';
    }

    return { icon, language, translations, titleTranslations, descriptionTranslations, hintTranslations };
}
