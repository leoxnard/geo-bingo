/*
================================================================================
GEMINI CLIENT HELPER
================================================================================
Calls the server-side Gemini proxy (/api/gemini), which holds the API key, so
no Gemini key is ever shipped to the browser. Returns the raw fetch Response so
callers keep their existing `.ok` / `.json()` handling against Gemini's
response shape.
================================================================================
*/

export async function callGemini(model: string, payload: unknown): Promise<Response> {
    return fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, payload }),
    });
}
