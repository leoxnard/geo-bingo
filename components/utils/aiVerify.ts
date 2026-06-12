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

import { callGemini, withModelFallback } from './geminiClient';
import { Submission } from './types';

export const computeSubmissionHash = (sub: Pick<Submission, 'lat' | 'lng' | 'heading' | 'pitch' | 'zoom'>): string => {
    return `${sub.lat.toFixed(6)}|${sub.lng.toFixed(6)}|${sub.heading.toFixed(2)}|${sub.pitch.toFixed(2)}|${sub.zoom.toFixed(2)}`;
};

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

// Coarse reverse-geocode cache, keyed by ~1 km rounded coordinates so nearby
// submissions reuse one lookup. Values: a short "Region, Country" string, or
// null when the lookup failed / returned nothing.
const locationCache = new Map<string, string | null>();

// Best-effort coarse location (e.g. "Bavaria, Germany") for a submission. Used
// only as a soft hint to the verifier — never blocks verification on failure.
async function reverseGeocodeCoarse(lat: number, lng: number, mapsKey: string): Promise<string | null> {
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cached = locationCache.get(key);
    if (cached !== undefined) return cached;

    let label: string | null = null;
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=locality|administrative_area_level_1|country&key=${mapsKey}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = (await res.json()) as { results?: { address_components?: { long_name: string; types: string[] }[] }[] };
            const comps = data.results?.[0]?.address_components ?? [];
            const pick = (type: string) => comps.find((c) => c.types.includes(type))?.long_name;
            const parts = [pick('locality') || pick('administrative_area_level_1'), pick('country')].filter(Boolean) as string[];
            label = parts.length > 0 ? parts.join(', ') : null;
        }
    } catch {
        label = null; // network/parse failure — proceed without location context
    }
    locationCache.set(key, label);
    return label;
}

async function verifyOneAgainstGemini(sub: Submission, mapsKey: string): Promise<{ passed: boolean; reason: string }> {
    const fov = sub.zoom ? 180 / Math.pow(2, sub.zoom) : 90;
    let safeHeading = sub.heading % 360;
    if (safeHeading < 0) safeHeading += 360;
    const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${sub.lat},${sub.lng}&heading=${safeHeading}&pitch=${sub.pitch}&fov=${fov}&key=${mapsKey}`;

    const [{ mime, data }, location] = await Promise.all([fetchImageAsBase64(imageUrl), reverseGeocodeCoarse(sub.lat, sub.lng, mapsKey)]);

    const locationLine = location ? `\nFor context, this Street View location is in: ${location}. Use this only as a soft plausibility hint (e.g. for region-specific categories) — judge primarily by what is actually visible, and do not approve something that isn't clearly shown just because the location fits.\n` : '';

    const prompt = `You are a STRICT verifier for a Google Street View Bingo game.
The player claims this image shows: "${sub.category}".
${locationLine}
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
            thinkingConfig: { thinkingBudget: 1024 },
        },
    };

    return await withModelFallback(async (model) => {
        const res = await callGemini(model, payload, 'paid');
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const msg = errBody?.error?.message || res.statusText;
            console.warn(`[aiVerify] ${model} HTTP ${res.status} for "${sub.category}":`, msg);
            throw new Error(`Gemini ${model}: ${msg}`);
        }
        const json = await res.json();
        const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const finishReason: string = json?.candidates?.[0]?.finishReason || '';
        const upper = text.trim().toUpperCase();

        if (!upper) {
            console.warn(`[aiVerify] ${model} returned empty text for "${sub.category}" (finish: ${finishReason})`);
            throw new Error(`Gemini ${model} returned empty text (finishReason=${finishReason}) for "${sub.category}"`);
        }
        const firstToken = upper.match(/^[A-Z]+/)?.[0];
        if (firstToken === 'YES' || firstToken === 'NO') {
            const reason = text
                .trim()
                .replace(/^[A-Za-z]+[\s\-–—:.]*/, '')
                .trim();
            return { passed: firstToken === 'YES', reason };
        }
        console.warn(`[aiVerify] ${model} unrecognized reply for "${sub.category}": "${text}"`);
        throw new Error(`Gemini ${model} unrecognized reply for "${sub.category}": ${text}`);
    }, 'paid');
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
