/*
================================================================================
GEMINI MODEL CONFIG
================================================================================
Single source of truth for which Gemini models the app will call, strongest
first. Three places used to hardcode this same list independently (the client
fallback order, the server allowlist, and the dev prompt-comparison tool) —
rolling a model meant editing all three and hoping they stayed in sync. Now
there is one place to edit.

GEMINI_MODELS is what the client tries, in order (see geminiClient.ts). The
server's ALLOWED_MODELS (app/api/gemini/route.ts) must stay a superset of this
list or calls 400 — importing it here instead of duplicating the array is what
guarantees that.
================================================================================
*/

// old ones: , 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'

export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
