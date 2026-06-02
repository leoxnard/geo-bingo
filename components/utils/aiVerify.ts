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

import { callGemini } from './geminiClient';
import { Submission } from './types';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'];

export const computeSubmissionHash = (sub: Pick<Submission, 'lat' | 'lng' | 'heading' | 'pitch' | 'zoom'>): string => {
    return `${sub.lat.toFixed(6)}|${sub.lng.toFixed(6)}|${sub.heading.toFixed(2)}|${sub.pitch.toFixed(2)}|${sub.zoom.toFixed(2)}`;
};

// A submission is already verified (and so skipped on the next run, no Gemini
// call, no charge) when its stored verdict still matches its current view hash.
// Shared by verifySubmissions and the UI so the toast count reflects only the
// submissions that will actually be sent to the AI.
export const isSubmissionVerified = (sub: Submission): boolean => {
    return sub.ai_verified_hash === computeSubmissionHash(sub) && (sub.ai_verdict === true || sub.ai_verdict === false);
};

export interface VerifyResult {
    submissionId: string;
    category: string;
    passed: boolean;
    hash: string;
    fromCache: boolean;
    error?: string;
    // The AI's one-line reason for this verdict. Absent for cached results (no
    // fresh call was made) and on error.
    reason?: string;
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

async function verifyOneAgainstGemini(sub: Submission, mapsKey: string): Promise<{ passed: boolean; reason: string }> {
    const fov = sub.zoom ? 180 / Math.pow(2, sub.zoom) : 90;
    let safeHeading = sub.heading % 360;
    if (safeHeading < 0) safeHeading += 360;
    const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${sub.lat},${sub.lng}&heading=${safeHeading}&pitch=${sub.pitch}&fov=${fov}&key=${mapsKey}`;

    const { mime, data } = await fetchImageAsBase64(imageUrl);

    const prompt = `You are a STRICT verifier for a Google Street View Bingo game.
The player claims this image shows: "${sub.category}".

Your job is to approve ONLY when the category is clearly and unambiguously visible as the obvious subject of the image. It is okay if its in distance or a little small.

REJECT (answer NO) if ANY of these apply:
- The item is only partially visible or heavily occluded by other objects
- The image shows something visually similar but not the exact category
- The match relies on guessing, context, or inference rather than direct visual evidence
- You are not highly confident — when in doubt, REJECT

Be skeptical. Most submissions should only be approved if a human reviewer would obviously agree.

Reply with your verdict as the FIRST word — exactly YES or NO — then " - " and a brief one-sentence reason for your decision. Example: "NO - The bicycle is too far in the background to identify with confidence."`;

    const payload = {
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
    };

    let lastErr: unknown = null;
    for (let i = 0; i < GEMINI_MODELS.length; i++) {
        const model = GEMINI_MODELS[i];
        try {
            const res = await callGemini(model, payload, 'paid');
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

            // Empty response usually means token budget exhausted (thinking) or safety block.
            // Don't silently say NO — fall through to next model so we can recover.
            if (!upper) {
                console.warn(`[aiVerify] ${model} returned empty text for "${sub.category}" (finish: ${finishReason})`);
                lastErr = new Error(`Gemini ${model} returned empty text (finishReason=${finishReason}) for "${sub.category}"`);
                continue;
            }
            // Strict parse: match a leading YES or NO token, ignoring trailing punctuation.
            const firstToken = upper.match(/^[A-Z]+/)?.[0];
            if (firstToken === 'YES' || firstToken === 'NO') {
                // Strip the leading verdict word + separators to leave the AI's reason,
                // surfaced on hover over the verdict label in the UI.
                const reason = text
                    .trim()
                    .replace(/^[A-Za-z]+[\s\-–—:.]*/, '')
                    .trim();
                return { passed: firstToken === 'YES', reason };
            }
            // Unrecognized reply — try next model.
            console.warn(`[aiVerify] ${model} unrecognized reply for "${sub.category}": "${text}"`);
            lastErr = new Error(`Gemini ${model} unrecognized reply for "${sub.category}": ${text}`);
        } catch (err) {
            console.warn(`[aiVerify] ${model} threw for "${sub.category}":`, err);
            lastErr = err;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All Gemini models failed');
}

const VERIFY_CONCURRENCY = 3;

export async function verifySubmissions(submissions: Submission[], mapsKey: string): Promise<VerifyResult[]> {
    const hashes = submissions.map(computeSubmissionHash);
    const results: VerifyResult[] = new Array(submissions.length);
    const pending: number[] = [];

    submissions.forEach((sub, i) => {
        const hash = hashes[i];
        if (isSubmissionVerified(sub)) {
            results[i] = { submissionId: sub.id, category: sub.category, passed: sub.ai_verdict === true, hash, fromCache: true };
        } else {
            pending.push(i);
        }
    });

    let cursor = 0;
    const workerCount = Math.min(VERIFY_CONCURRENCY, pending.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < pending.length) {
            const i = pending[cursor++];
            const sub = submissions[i];
            const hash = hashes[i];
            try {
                const { passed, reason } = await verifyOneAgainstGemini(sub, mapsKey);
                results[i] = { submissionId: sub.id, category: sub.category, passed, hash, fromCache: false, reason };
            } catch (err) {
                results[i] = { submissionId: sub.id, category: sub.category, passed: false, hash, fromCache: false, error: err instanceof Error ? err.message : 'Unknown error' };
            }
        }
    });
    await Promise.all(workers);

    return results;
}
