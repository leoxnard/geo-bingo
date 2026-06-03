/*
================================================================================
NEARBY STREET VIEW CATEGORIES MODULE
================================================================================
Generates bingo categories using AI analysis of street view locations.
Combines Google Street View API with Gemini AI for creative categories.
Finds interesting visual elements and landmarks within game area.
================================================================================
*/

import { callGemini, withModelFallback } from '../utils/geminiClient';
import { BingoCategory } from '../utils/types';
import { getPromptForStreetViewCategories } from './prompts/StreetViewPrompts';

export const generateNearbyStreetViewCategories = async (startPos: { lat: number; lng: number }, radius: number, requiredCount: number, difficulty: 'default' | 'easy' | 'hard', language: string): Promise<BingoCategory[]> => {
    try {
        const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!googleApiKey) throw new Error('API Keys missing!');

        const radiusMeters = radius * 100;

        const getRandomLocation = (center: { lat: number; lng: number }, radMeters: number) => {
            const r = radMeters * Math.sqrt(Math.random());
            const theta = Math.random() * 2 * Math.PI;
            const dx = r * Math.cos(theta);
            const dy = r * Math.sin(theta);
            const lat = center.lat + dy / 111320;
            const lng = center.lng + dx / (111320 * Math.cos((center.lat * Math.PI) / 180));
            return { lat, lng };
        };

        const validImages: {
            id: string;
            lat: number;
            lng: number;
            base64: string;
        }[] = [];
        const seenImages = new Set<string>();
        // Fetch a healthy pool of panoramas independent of the active count, so the
        // AI always has enough material to extract a pool (active list + suggestions)
        // from — even when the host only wants a handful of active categories.
        const poolImageTarget = Math.min(Math.max(requiredCount + 6, 12), 24);
        const maxAttempts = poolImageTarget * 8;
        let fetchCount = 0;

        for (let i = 0; i < maxAttempts; i++) {
            if (validImages.length >= poolImageTarget) break;

            const loc = getRandomLocation(startPos, radiusMeters);

            const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc.lat},${loc.lng}&source=outdoor&key=${googleApiKey}`;

            try {
                const metaRes = await fetch(metaUrl);
                const metaData = await metaRes.json();

                if (metaData.status === 'OK' && metaData.location) {
                    const exactLat = metaData.location.lat;
                    const exactLng = metaData.location.lng;

                    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${exactLat},${exactLng}&result_type=street_address|route&key=${googleApiKey}`;
                    const geoRes = await fetch(geoUrl);
                    const geoData = await geoRes.json();

                    if (geoData.status === 'OK' && geoData.results.length > 0) {
                        const fov = Math.round(60 + Math.random() * 60); // random between 60–120
                        const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${exactLat},${exactLng}&fov=${fov}&source=outdoor&key=${googleApiKey}`;

                        const res = await fetch(svUrl);
                        if (res.ok) {
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

                            if (!seenImages.has(base64)) {
                                seenImages.add(base64);
                                validImages.push({
                                    id: `img_${fetchCount}`,
                                    lat: exactLat,
                                    lng: exactLng,
                                    base64,
                                });
                                fetchCount++;
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error fetching Street View/Geocoding data:', e);
            }
        }

        if (validImages.length === 0) {
            throw new Error('Keine Street-View-Bilder in diesem Bereich gefunden. Bitte wähle einen größeren Radius.');
        }

        type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

        const prompt = getPromptForStreetViewCategories(validImages.length, difficulty, language);
        const parts: GeminiPart[] = [{ text: prompt }];

        validImages.forEach((img) => {
            parts.push({ text: `Bild-ID: ${img.id}` });
            parts.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: img.base64,
                },
            });
        });

        const aiResponse = await withModelFallback(async (model) => {
            const res = await callGemini(model, {
                contents: [{ parts }],
                generationConfig: {
                    responseMimeType: 'application/json',
                },
            });
            if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}`);
            return res;
        });

        const aiData = await aiResponse.json();
        let aiTextResponse = aiData.candidates[0].content.parts[0].text;
        aiTextResponse = aiTextResponse
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        const parsedItems = JSON.parse(aiTextResponse);

        if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
            throw new Error('Die KI hat kein gültiges Ergebnis geliefert. Bitte erneut versuchen.');
        }

        const finalCategories: BingoCategory[] = parsedItems
            .map((item: { categoryName: string; imageId: string; score: number }) => {
                const sourceImg = validImages.find((img) => img.id === item.imageId);
                if (!sourceImg) return null;

                return {
                    categoryName: item.categoryName,
                    score: item.score || 0,
                    matchedPlaces: [
                        {
                            name: item.categoryName,
                            lat: sourceImg.lat,
                            lng: sourceImg.lng,
                        },
                    ],
                };
            })
            .filter((item): item is BingoCategory & { score: number } => item !== null)
            .filter((cat, index, self) => index === self.findIndex((c) => c.categoryName.toLowerCase().trim() === cat.categoryName.toLowerCase().trim()))
            // Return the FULL ranked pool (highest score first), not just the top
            // requiredCount. The lobby splits this into the active list (top-K) and
            // the suggestions list (the rest), so we hand back everything we found.
            .sort((a, b) => b.score - a.score)
            .map((cat) => ({
                categoryName: cat.categoryName,
                score: cat.score,
                matchedPlaces: cat.matchedPlaces,
            }))
            .filter((cat, index, self) => index === self.findIndex((c) => c.categoryName === cat.categoryName));

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
