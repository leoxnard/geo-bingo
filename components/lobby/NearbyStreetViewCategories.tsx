/*
================================================================================
NEARBY STREET VIEW CATEGORIES MODULE
================================================================================
Generates bingo categories using AI analysis of street view locations.
Combines Google Street View API with Gemini AI for creative categories.
Finds interesting visual elements and landmarks within game area.

Pipeline: sample random points inside the radius in parallel waves, keep only
distinct panoramas (pano_id dedupe + a minimum spacing so the pool covers the
whole area instead of clustering on the same scene), photograph each with a
random heading/FOV, then analyze the pool in small parallel Gemini batches so
every image gets real attention. Results are merged, deduped against
already-taken categories, and ranked by score with a small random jitter so
two runs on the same spot don't produce the same board.
================================================================================
*/

import { callGemini, withModelFallback } from '../utils/geminiClient';
import { BingoCategory } from '../utils/types';
import { getPromptForStreetViewCategories } from './prompts/StreetViewPrompts';

type LatLng = { lat: number; lng: number };
type PanoImage = { id: string; lat: number; lng: number; base64: string };
type RawAIItem = { categoryName: string; imageId: string; score: number };

const METADATA_WAVE_SIZE = 16; // concurrent metadata probes per sampling wave
const SAMPLING_BUDGET_MS = 20000; // hard cap on the metadata sampling phase — proceed with what we have
const GEMINI_BATCH_SIZE = 6; // images per Gemini call — small batches keep per-image attention high

const normalizeName = (name: string) => name.toLowerCase().trim();

// Equirectangular approximation — plenty accurate for spacing checks under 10 km.
const distanceMeters = (a: LatLng, b: LatLng): number => {
    const dLat = (b.lat - a.lat) * 111320;
    const dLng = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    return Math.sqrt(dLat * dLat + dLng * dLng);
};

export const generateNearbyStreetViewCategories = async (startPos: { lat: number; lng: number }, radius: number, requiredCount: number, difficulty: 'default' | 'easy' | 'hard', language: string, excludeCategories: string[] = []): Promise<BingoCategory[]> => {
    try {
        const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!googleApiKey) throw new Error('API Keys missing!');

        const radiusMeters = radius * 100;
        // Spread accepted panoramas out so the pool shows distinct scenes.
        const minSpacingMeters = Math.min(100, Math.max(25, radiusMeters / 8));

        const getRandomLocation = (center: LatLng, radMeters: number): LatLng => {
            const r = radMeters * Math.sqrt(Math.random());
            const theta = Math.random() * 2 * Math.PI;
            const dx = r * Math.cos(theta);
            const dy = r * Math.sin(theta);
            const lat = center.lat + dy / 111320;
            const lng = center.lng + dx / (111320 * Math.cos((center.lat * Math.PI) / 180));
            return { lat, lng };
        };

        // Fetch a pool of panoramas larger than the active count so the AI always has
        // enough material for both the active list and the suggestions.
        const poolImageTarget = Math.min(Math.max(requiredCount + 6, 12), 24);
        const maxAttempts = poolImageTarget * 10;

        // PHASE 1 — metadata-only sampling. Cheap tiny JSON probes in big parallel
        // waves; nothing heavier blocks the loop. Over-collect slightly since some
        // spots will still fail the geocode filter or image fetch in phase 2. A
        // hard time budget keeps sparse areas (water, countryside) from grinding
        // through the whole attempt budget — we proceed with whatever we have.
        const candidateTarget = Math.ceil(poolImageTarget * 1.3);
        const seenPanos = new Set<string>();
        const acceptedSpots: LatLng[] = [];
        let attempts = 0;
        const samplingDeadline = Date.now() + SAMPLING_BUDGET_MS;

        while (acceptedSpots.length < candidateTarget && attempts < maxAttempts && Date.now() < samplingDeadline) {
            const wave = Array.from({ length: METADATA_WAVE_SIZE }, () => getRandomLocation(startPos, radiusMeters));
            attempts += wave.length;

            const metas = await Promise.all(
                wave.map(async (loc) => {
                    try {
                        const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc.lat},${loc.lng}&source=outdoor&key=${googleApiKey}`;
                        const metaRes = await fetch(metaUrl);
                        const metaData = await metaRes.json();
                        if (metaData.status === 'OK' && metaData.location) return metaData;
                    } catch (e) {
                        console.error('Error fetching Street View metadata:', e);
                    }
                    return null;
                }),
            );

            // Accept sequentially so pano dedupe + spacing checks see earlier picks.
            for (const meta of metas) {
                if (!meta) continue;
                if (acceptedSpots.length >= candidateTarget) break;
                const spot: LatLng = { lat: meta.location.lat, lng: meta.location.lng };
                const panoId = typeof meta.pano_id === 'string' ? meta.pano_id : `${spot.lat},${spot.lng}`;
                if (seenPanos.has(panoId)) continue;
                if (acceptedSpots.some((p) => distanceMeters(p, spot) < minSpacingMeters)) continue;
                seenPanos.add(panoId);
                acceptedSpots.push(spot);
            }
        }

        // PHASE 2 — geocode-filter and photograph ALL accepted spots in one
        // parallel burst instead of per-wave on the sampling loop's critical path.
        const fetched = await Promise.all(
            acceptedSpots.map(async (spot) => {
                try {
                    // Keep only panos that geocode to an actual street — filters out
                    // trails, interiors and other odd coverage.
                    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${spot.lat},${spot.lng}&result_type=street_address|route&key=${googleApiKey}`;
                    const geoRes = await fetch(geoUrl);
                    const geoData = await geoRes.json();
                    if (geoData.status !== 'OK' || geoData.results.length === 0) return null;

                    // Random look direction + FOV so repeated runs on the same spot
                    // photograph different parts of the scene.
                    const heading = Math.floor(Math.random() * 360);
                    const fov = Math.round(60 + Math.random() * 60);
                    const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${spot.lat},${spot.lng}&heading=${heading}&fov=${fov}&source=outdoor&key=${googleApiKey}`;

                    const res = await fetch(svUrl);
                    if (!res.ok) return null;
                    const blob = await res.blob();
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const result = reader.result as string;
                            resolve(result.split(',')[1]);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });

                    return { id: '', lat: spot.lat, lng: spot.lng, base64 };
                } catch (e) {
                    console.error('Error fetching Street View/Geocoding data:', e);
                    return null;
                }
            }),
        );

        const validImages: PanoImage[] = [];
        for (const img of fetched) {
            if (img && validImages.length < poolImageTarget) {
                img.id = `img_${validImages.length}`;
                validImages.push(img);
            }
        }

        if (validImages.length === 0) {
            throw new Error('Keine Street-View-Bilder in diesem Bereich gefunden. Bitte wähle einen größeren Radius.');
        }

        type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

        const batches: PanoImage[][] = [];
        for (let i = 0; i < validImages.length; i += GEMINI_BATCH_SIZE) {
            batches.push(validImages.slice(i, i + GEMINI_BATCH_SIZE));
        }
        // Each batch carries a share of the total quota (active list + suggestion
        // buffer), over-provisioned by 50%: the parallel batches can't see each
        // other, so in visually uniform areas they converge on the same obvious
        // targets and the cross-batch dedupe eats the overlap.
        const perBatchQuota = Math.max(6, Math.ceil(((requiredCount + 8) * 1.5) / batches.length));

        const runBatch = async (batch: PanoImage[], quota: number, exclude: string[]): Promise<RawAIItem[]> => {
            const prompt = getPromptForStreetViewCategories(batch.length, difficulty, language, quota, exclude);
            const parts: GeminiPart[] = [{ text: prompt }];
            batch.forEach((img) => {
                parts.push({ text: `Bild-ID: ${img.id}` });
                parts.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: img.base64,
                    },
                });
            });

            return withModelFallback(async (model) => {
                const res = await callGemini(model, {
                    contents: [{ parts }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 1.1,
                    },
                });
                if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}`);
                // Parse and validate INSIDE the fallback so a lazy or truncated reply
                // from a weaker model falls through to the next model instead of
                // silently thinning the result.
                const data = await res.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (typeof text !== 'string' || !text.trim()) throw new Error(`Gemini ${model} returned an empty reply`);
                const parsed = JSON.parse(
                    text
                        .replace(/```json/g, '')
                        .replace(/```/g, '')
                        .trim(),
                );
                if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`Gemini ${model} returned no usable items`);
                return parsed as RawAIItem[];
            });
        };

        const settled = await Promise.allSettled(batches.map((batch) => runBatch(batch, perBatchQuota, excludeCategories)));
        settled.forEach((r) => {
            if (r.status === 'rejected') console.error('Street View Gemini batch failed:', r.reason);
        });
        const parsedItems = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

        if (parsedItems.length === 0) {
            throw new Error('Die KI hat kein gültiges Ergebnis geliefert. Bitte erneut versuchen.');
        }

        const excluded = new Set(excludeCategories.map(normalizeName));

        // TOP-UP — if cross-batch dedupe (or a failed batch) leaves us short of the
        // requested count, one extra call over the whole pool asks for the missing
        // items, with everything found so far excluded. Reuses the images we
        // already downloaded, so it costs a single Gemini round-trip.
        const validImageIds = new Set(validImages.map((img) => img.id));
        const uniqueFound = new Set(parsedItems.filter((item) => item && typeof item.categoryName === 'string' && validImageIds.has(item.imageId) && !excluded.has(normalizeName(item.categoryName))).map((item) => normalizeName(item.categoryName)));

        if (uniqueFound.size < requiredCount) {
            try {
                const topUpQuota = requiredCount - uniqueFound.size + 4;
                const topUpExclude = [...excludeCategories, ...parsedItems.map((item) => item?.categoryName).filter((n): n is string => typeof n === 'string')];
                const topUpItems = await runBatch(validImages, topUpQuota, topUpExclude);
                parsedItems.push(...topUpItems);
            } catch (e) {
                // Top-up is best-effort — keep whatever the batches produced.
                console.error('Street View top-up pass failed:', e);
            }
        }

        const finalCategories: BingoCategory[] = parsedItems
            .filter((item) => item && typeof item.categoryName === 'string' && item.categoryName.trim())
            .map((item) => {
                const sourceImg = validImages.find((img) => img.id === item.imageId);
                if (!sourceImg) return null;

                return {
                    categoryName: item.categoryName.trim(),
                    score: typeof item.score === 'number' ? item.score : 0,
                    matchedPlaces: [
                        {
                            name: item.categoryName.trim(),
                            lat: sourceImg.lat,
                            lng: sourceImg.lng,
                        },
                    ],
                };
            })
            .filter((item): item is BingoCategory & { score: number } => item !== null)
            .filter((cat) => !excluded.has(normalizeName(cat.categoryName)))
            .filter((cat, index, self) => index === self.findIndex((c) => normalizeName(c.categoryName) === normalizeName(cat.categoryName)))
            // Return the full ranked pool (highest score first); the lobby splits it
            // into the active list (top-K) and the suggestions (the rest). A small
            // random jitter shuffles equally-good targets so repeat runs differ.
            .map((cat) => ({ ...cat, sortKey: cat.score + Math.random() * 10 - 5 }))
            .sort((a, b) => b.sortKey - a.sortKey)
            .map((cat) => ({
                categoryName: cat.categoryName,
                score: cat.score,
                matchedPlaces: cat.matchedPlaces,
            }));

        if (finalCategories.length === 0) {
            throw new Error('Es konnten keine Kategorien aus den Bildern erstellt werden. Bitte erneut versuchen.');
        }

        return finalCategories;
    } catch (error) {
        console.error('Error during Street View generation:', error);
        // Preserve the specific reason so the lobby toast is actually helpful.
        throw error instanceof Error ? error : new Error('Error analyzing Street View images.');
    }
};
