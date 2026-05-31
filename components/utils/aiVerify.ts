/*
================================================================================
AI VERIFY UTILITY
================================================================================
Verifies player submissions against their category using Gemini multimodal API.
Each submission's Street View image is fetched + sent to Gemini in parallel.
Caches verdicts via a hash of (lat,lng,heading,pitch,zoom) so unchanged
submissions are not re-verified on subsequent runs.
================================================================================
*/

import { Submission } from './types';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'];

export const computeSubmissionHash = (sub: Pick<Submission, 'lat' | 'lng' | 'heading' | 'pitch' | 'zoom'>): string => {
    return `${sub.lat.toFixed(6)}|${sub.lng.toFixed(6)}|${sub.heading.toFixed(2)}|${sub.pitch.toFixed(2)}|${sub.zoom.toFixed(2)}`;
};

export interface VerifyResult {
    submissionId: string;
    category: string;
    passed: boolean;
    hash: string;
    fromCache: boolean;
    error?: string;
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; data: string }> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Street View image fetch failed: ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            const commaIdx = result.indexOf(',');
            const meta = result.slice(0, commaIdx);
            const data = result.slice(commaIdx + 1);
            const mime = meta.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
            resolve({ mime, data });
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function verifyOneAgainstGemini(sub: Submission, mapsKey: string, geminiKey: string): Promise<boolean> {
    const fov = sub.zoom ? 180 / Math.pow(2, sub.zoom) : 90;
    let safeHeading = sub.heading % 360;
    if (safeHeading < 0) safeHeading += 360;
    const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${sub.lat},${sub.lng}&heading=${safeHeading}&pitch=${sub.pitch}&fov=${fov}&key=${mapsKey}`;

    const { mime, data } = await fetchImageAsBase64(imageUrl);

    const prompt = `You are a STRICT verifier for a Google Street View Bingo game.
The player claims this image shows: "${sub.category}".

Your job is to approve ONLY when the category is clearly and unambiguously visible as the obvious subject of the image.

REJECT (answer NO) if ANY of these apply:
- The item is not centered or is a minor detail in the image, rather than the main focus
- The item is small, distant, or blurry and you cannot identify it with high confidence
- The item is only partially visible or heavily occluded by other objects
- The image shows something visually similar but not the exact category
- The match relies on guessing, context, or inference rather than direct visual evidence
- You are not highly confident — when in doubt, REJECT

Be skeptical. Most submissions should only be approved if a human reviewer would obviously agree.

Reply with ONLY one word: YES or NO. No punctuation, no explanation.`;

    const body = JSON.stringify({
        contents: [
            {
                parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }],
            },
        ],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 2000,
            // Cap thinking so it cannot consume the entire output budget and leave
            // nothing for the YES/NO reply (the failure mode we recover from below).
            thinkingConfig: { thinkingBudget: 1024 },
        },
    });

    let lastErr: unknown = null;
    for (let i = 0; i < GEMINI_MODELS.length; i++) {
        const model = GEMINI_MODELS[i];
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const msg = errBody?.error?.message || res.statusText;
                console.warn(`[aiVerify] ${model} HTTP ${res.status} for "${sub.category}":`, msg);
                lastErr = new Error(`Gemini ${model}: ${msg}`);
                continue;
            }
            const json = await res.json();
            const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const finishReason: string = json?.candidates?.[0]?.finishReason || '';
            const upper = text.trim().toUpperCase();
            console.log(`[aiVerify] ${model} "${sub.category}" → "${text}" (finish: ${finishReason})`);

            // Empty response usually means token budget exhausted (thinking) or safety block.
            // Don't silently say NO — fall through to next model so we can recover.
            if (!upper) {
                lastErr = new Error(`Gemini ${model} returned empty text (finishReason=${finishReason}) for "${sub.category}"`);
                continue;
            }
            // Strict parse: match a leading YES or NO token, ignoring trailing punctuation.
            const firstToken = upper.match(/^[A-Z]+/)?.[0];
            if (firstToken === 'YES') return true;
            if (firstToken === 'NO') return false;
            // Unrecognized reply — try next model.
            lastErr = new Error(`Gemini ${model} unrecognized reply for "${sub.category}": ${text}`);
        } catch (err) {
            console.warn(`[aiVerify] ${model} threw for "${sub.category}":`, err);
            lastErr = err;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All Gemini models failed');
}

export async function verifySubmissions(submissions: Submission[], mapsKey: string, geminiKey: string): Promise<VerifyResult[]> {
    const tasks = submissions.map(async (sub): Promise<VerifyResult> => {
        const hash = computeSubmissionHash(sub);
        const cachedHash = sub.ai_verified_hash;
        const cachedVerdict = sub.ai_verdict;
        if (cachedHash === hash && (cachedVerdict === true || cachedVerdict === false)) {
            return { submissionId: sub.id, category: sub.category, passed: cachedVerdict, hash, fromCache: true };
        }
        try {
            const passed = await verifyOneAgainstGemini(sub, mapsKey, geminiKey);
            return { submissionId: sub.id, category: sub.category, passed, hash, fromCache: false };
        } catch (err) {
            return { submissionId: sub.id, category: sub.category, passed: false, hash, fromCache: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
    });
    return await Promise.all(tasks);
}
