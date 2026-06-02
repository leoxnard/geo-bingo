import { NextRequest, NextResponse } from 'next/server';

/*
================================================================================
GEMINI PROXY
================================================================================
Holds the Gemini API key server-side so it never ships in the client bundle.
The browser POSTs { model, payload } here; we inject the key and forward the
request to Google, mirroring the upstream status + JSON back so existing client
parsing is unchanged.

Hardening: only known models are allowed and the request body is size-capped,
so this endpoint can't be turned into an open-ended Gemini relay. Pair this with
a budget/quota cap on the key in Google AI Studio for defence in depth.

Two keys, one per tier: 'free' serves low-volume text work (category generation)
and 'paid' serves the verification bursts that can exceed the free tier's
per-minute limit. Each tier falls back to the single legacy GEMINI_API_KEY so an
existing one-key deployment keeps working unchanged.
================================================================================
*/

const ALLOWED_MODELS = new Set(['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);

const MAX_BODY_BYTES = 8 * 1024 * 1024; // generous: one Street View image as base64

function resolveKey(tier: unknown): string | undefined {
    const legacy = process.env.GEMINI_API_KEY;
    if (tier === 'paid') return process.env.GEMINI_API_KEY_PAID || legacy;
    return process.env.GEMINI_API_KEY_FREE || legacy;
}

export async function POST(req: NextRequest) {
    // Cap on the ACTUAL body, not the content-length header (which can be
    // missing or lie). Vercel also enforces a platform body limit, so this is
    // belt-and-suspenders.
    let raw: string;
    try {
        raw = await req.text();
    } catch {
        return NextResponse.json({ error: { message: 'Invalid request body.' } }, { status: 400 });
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        return NextResponse.json({ error: { message: 'Payload too large.' } }, { status: 413 });
    }

    let parsed: { model?: unknown; payload?: unknown; tier?: unknown };
    try {
        parsed = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: { message: 'Invalid JSON body.' } }, { status: 400 });
    }

    const { model, payload, tier } = parsed;
    if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
        return NextResponse.json({ error: { message: 'Unsupported model.' } }, { status: 400 });
    }
    if (!payload || typeof payload !== 'object') {
        return NextResponse.json({ error: { message: 'Missing payload.' } }, { status: 400 });
    }

    // Resolve the key after validating the request so a missing key reads as the
    // selected tier being unconfigured, not a generic failure.
    const key = resolveKey(tier);
    if (!key) {
        return NextResponse.json({ error: { message: 'AI is not configured.' } }, { status: 503 });
    }

    let upstream: Response;
    try {
        upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch {
        return NextResponse.json({ error: { message: 'Upstream request failed.' } }, { status: 502 });
    }

    // Mirror upstream status + body verbatim so callers keep their .ok / .json() handling.
    const text = await upstream.text();
    return new NextResponse(text, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
    });
}
