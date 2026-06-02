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
================================================================================
*/

export type GeminiTier = 'free' | 'paid';

export async function callGemini(model: string, payload: unknown, tier: GeminiTier = 'free'): Promise<Response> {
    return fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, payload, tier }),
    });
}
