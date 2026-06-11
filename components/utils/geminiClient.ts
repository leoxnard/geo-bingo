/*
================================================================================
GEMINI CLIENT HELPER
================================================================================
Calls the server-side Gemini proxy (/api/gemini), which holds the API key, so
no Gemini key is ever shipped to the browser. Returns the raw fetch Response so
callers keep their existing `.ok` / `.json()` handling against Gemini's
response shape.

The `tier` picks which server-side key the proxy uses: 'free' for low-volume
text work (category generation) and 'paid' for the verification bursts that can
blow past the free tier's per-minute limit. See app/api/gemini/route.ts.

Model fallback: `withModelFallback` tries the last known-good model first, then
the full list from the top, until one succeeds — and remembers the winner so we
don't keep hammering a rate-limited ("full") model on every call. The remembered
model is kept per-tier (free/paid have separate keys and quotas). This list must
stay a subset of the proxy's ALLOWED_MODELS or calls will 400.
================================================================================
*/

export type GeminiTier = 'free' | 'paid';

// Strongest first. Must match the proxy allowlist in app/api/gemini/route.ts.
export const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

export async function callGemini(model: string, payload: unknown, tier: GeminiTier = 'free'): Promise<Response> {
    return fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, payload, tier }),
    });
}

const LAST_GOOD_MODEL_PREFIX = 'geoBingoLastGoodGeminiModel';
const rememberedKey = (tier: GeminiTier) => `${LAST_GOOD_MODEL_PREFIX}:${tier}`;

function getRememberedModel(tier: GeminiTier): string | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        const m = localStorage.getItem(rememberedKey(tier));
        return m && GEMINI_MODELS.includes(m) ? m : null;
    } catch {
        return null;
    }
}

function rememberModel(tier: GeminiTier, model: string): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(rememberedKey(tier), model);
    } catch {
        /* ignore (private mode / disabled storage) */
    }
}

// Last known-good model first (fast path), then the full list from the top so a
// recovered/stronger model gets picked back up once the remembered one fails.
function getModelOrder(tier: GeminiTier): string[] {
    const remembered = getRememberedModel(tier);
    if (remembered) {
        return [remembered, ...GEMINI_MODELS.filter((m) => m !== remembered)];
    }
    return [...GEMINI_MODELS];
}

/**
 * Runs `run` against Gemini models until one succeeds, remembering the winner.
 * `run` should THROW to signal "try the next model" (429/empty/unparseable reply).
 */
export async function withModelFallback<T>(run: (model: string) => Promise<T>, tier: GeminiTier = 'free'): Promise<T> {
    const order = getModelOrder(tier);
    let lastErr: unknown = null;
    for (const model of order) {
        try {
            const result = await run(model);
            rememberModel(tier, model);
            return result;
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All Gemini models failed.');
}
