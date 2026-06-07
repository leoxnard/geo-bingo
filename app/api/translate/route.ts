import { NextRequest, NextResponse } from 'next/server';

/*
================================================================================
DEEPL PROXY
================================================================================
Holds the DeepL API key server-side (DEEPL_API_KEY) so it never ships to the
browser. The client POSTs { texts, targetLangs, sourceLang? } where targetLangs
are app locale codes (en/de/es/fr/zh); we map them to DeepL language codes,
translate `texts` into each target, and return { translations: { <locale>: [...] } }
with one array per locale (aligned to the input order).

Used when publishing a community preset: the category names are translated into
every app language so an imported game can show them in any single shared board
language. A target equal to the detected source is returned unchanged (no call).
================================================================================
*/

// App locale -> DeepL target code (DeepL requires a regional variant for EN/PT).
const DEEPL_TARGET: Record<string, string> = { en: 'EN-US', de: 'DE', es: 'ES', fr: 'FR', zh: 'ZH' };
// App locale / ISO 639-1 -> DeepL source code (no regional variant for source).
const DEEPL_SOURCE: Record<string, string> = { en: 'EN', de: 'DE', es: 'ES', fr: 'FR', zh: 'ZH' };

const MAX_TEXTS = 60;
const MAX_TEXT_LEN = 600; // category names are short; preset descriptions can be a sentence or two

export async function POST(req: NextRequest) {
    const key = process.env.DEEPL_API_KEY;
    if (!key) {
        return NextResponse.json({ error: 'Translation is not configured.' }, { status: 503 });
    }

    let body: { texts?: unknown; targetLangs?: unknown; sourceLang?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const texts = Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, MAX_TEXT_LEN)) : [];
    const targetLangs = Array.isArray(body.targetLangs) ? body.targetLangs.filter((l): l is string => typeof l === 'string') : [];
    const sourceLang = typeof body.sourceLang === 'string' ? body.sourceLang.toLowerCase() : undefined;

    if (texts.length === 0 || texts.length > MAX_TEXTS || targetLangs.length === 0) {
        return NextResponse.json({ error: 'Nothing to translate.' }, { status: 400 });
    }

    // Free keys end with ':fx' and use the free host.
    const endpoint = key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
    const deeplSource = sourceLang && DEEPL_SOURCE[sourceLang] ? DEEPL_SOURCE[sourceLang] : undefined;

    const translations: Record<string, string[]> = {};

    await Promise.all(
        targetLangs.map(async (locale) => {
            const target = DEEPL_TARGET[locale];
            if (!target) return;
            // Translating into the detected source language is a no-op — keep originals.
            if (deeplSource && DEEPL_SOURCE[locale] === deeplSource) {
                translations[locale] = texts;
                return;
            }
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: texts, target_lang: target, ...(deeplSource ? { source_lang: deeplSource } : {}) }),
                });
                if (!res.ok) return;
                const data = (await res.json()) as { translations?: { text: string }[] };
                if (Array.isArray(data.translations) && data.translations.length === texts.length) {
                    translations[locale] = data.translations.map((t) => t.text);
                }
            } catch {
                // Leave this locale out; the client fills missing locales with originals.
            }
        }),
    );

    return NextResponse.json({ translations });
}
