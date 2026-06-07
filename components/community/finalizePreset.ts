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
}

function extractJson(text: string): string {
    const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? match[0] : cleaned;
}

export async function finalizePreset(input: { name: string; description: string; categoryNames: string[] }): Promise<FinalizeResult> {
    const { name, description, categoryNames } = input;

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

    // 2) DeepL — translate category names + the title (+ description) into every
    // app language in a single batched call per locale. The trailing slots carry
    // the name and (when present) the description.
    const hasDesc = !!description.trim();
    const texts = [...categoryNames, name, ...(hasDesc ? [description] : [])];
    const nameIdx = categoryNames.length;
    const descIdx = nameIdx + 1;

    const raw: Record<string, string[]> = {};
    try {
        const r = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts, targetLangs: LOCALE_CODES, sourceLang: language || undefined }),
        });
        if (r.ok) {
            const d = (await r.json()) as { translations?: Record<string, string[]> };
            if (d.translations && typeof d.translations === 'object') Object.assign(raw, d.translations);
        }
    } catch {
        // Ignore — back-filled with originals below.
    }

    // Split each locale's batch back into categories / title / description, and
    // guarantee a complete map: any missing/partial locale falls back to originals.
    const translations: Record<string, string[]> = {};
    const titleTranslations: Record<string, string> = {};
    const descriptionTranslations: Record<string, string> = {};
    for (const code of LOCALE_CODES) {
        const arr = raw[code];
        const ok = Array.isArray(arr) && arr.length === texts.length;
        translations[code] = ok ? arr.slice(0, categoryNames.length) : categoryNames;
        titleTranslations[code] = ok ? arr[nameIdx] : name;
        descriptionTranslations[code] = hasDesc ? (ok ? arr[descIdx] : description) : '';
    }

    return { icon, language, translations, titleTranslations, descriptionTranslations };
}
