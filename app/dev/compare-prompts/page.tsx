'use client';

/*
================================================================================
DEV TOOL — STREET VIEW PROMPT COMPARISON  (TEMPORARY, safe to delete)
================================================================================
Developer-only page for tuning the panorama (Street View) category prompts.

Walk around freely in an interactive Street View panorama, frame a shot, hit
"Capture & Compare", and the exact view you see is sent to Gemini with EVERY
available panorama prompt (easy / default / hard) at once. The results render
side by side so you can eyeball which prompt produces the best categories.

This whole folder (app/dev/compare-prompts) is self-contained — delete it to
remove the tool. Nothing else imports from here.
Open this using the URL path /dev/compare-prompts when running the app locally.
================================================================================
*/

import { useCallback, useEffect, useRef, useState } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';

import { checkAiKeysAvailable } from '@/app/game/actions';
import { getPromptForStreetViewCategories } from '@/components/lobby/prompts/StreetViewPrompts';
import { callGemini } from '@/components/utils/geminiClient';
import { GOOGLE_MAPS_LIBRARIES } from '@/components/utils/mapUtils';

type Difficulty = 'easy' | 'default' | 'hard';
const DIFFICULTIES: Difficulty[] = ['easy', 'default', 'hard'];

type ResultItem = { categoryName: string; imageId: string; score: number };
type PromptResult = { status: 'loading' | 'done' | 'error'; items: ResultItem[]; ms: number; error?: string };

const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

// A spot with rich, varied Street View coverage to start from.
const DEFAULT_START = { lat: 48.137154, lng: 11.576124 }; // Munich, Marienplatz

export default function ComparePromptsPage() {
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES,
    });

    const [authChecked, setAuthChecked] = useState(false);
    const [isDeveloper, setIsDeveloper] = useState(false);

    const panoRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const panoInstanceRef = useRef<google.maps.StreetViewPanorama | null>(null);

    const [language, setLanguage] = useState<'english' | 'german'>('german');
    const [model, setModel] = useState<string>(GEMINI_MODELS[0]);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<Record<Difficulty, PromptResult> | null>(null);

    // --- Auth gate -----------------------------------------------------------
    useEffect(() => {
        checkAiKeysAvailable()
            .then((status) => setIsDeveloper(status.isDeveloper))
            .catch(() => setIsDeveloper(false))
            .finally(() => setAuthChecked(true));
    }, []);

    // --- Build the interactive panorama -------------------------------------
    useEffect(() => {
        if (!isLoaded || !isDeveloper || !panoRef.current || panoInstanceRef.current) return;

        const pano = new google.maps.StreetViewPanorama(panoRef.current, {
            position: DEFAULT_START,
            pov: { heading: 0, pitch: 0 },
            zoom: 1,
            visible: true,
            addressControl: true,
            fullscreenControl: true,
            motionTracking: false,
            motionTrackingControl: false,
        });

        panoInstanceRef.current = pano;

        // Places search box to jump anywhere in the world.
        if (searchRef.current) {
            const autocomplete = new google.maps.places.Autocomplete(searchRef.current, { fields: ['geometry'] });
            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();
                if (place.geometry?.location) {
                    pano.setPosition(place.geometry.location);
                }
            });
        }
    }, [isLoaded, isDeveloper]);

    // --- Capture current view + run every prompt -----------------------------
    const runComparison = useCallback(async () => {
        const pano = panoInstanceRef.current;
        if (!pano) return;
        const position = pano.getPosition();
        const panoId = pano.getPano();
        const pov = pano.getPov();
        if (!position) return;

        setIsRunning(true);
        setCapturedImage(null);
        setResults({
            easy: { status: 'loading', items: [], ms: 0 },
            default: { status: 'loading', items: [], ms: 0 },
            hard: { status: 'loading', items: [], ms: 0 },
        });

        try {
            // Match the static image to what the user actually sees: same pano,
            // same heading/pitch, and an fov derived from the live zoom level.
            const zoom = pano.getZoom() ?? 1;
            const fov = Math.min(120, Math.max(20, 180 / Math.pow(2, zoom)));
            const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
            const locationParam = panoId ? `pano=${encodeURIComponent(panoId)}` : `location=${position.lat()},${position.lng()}`;
            const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&${locationParam}&heading=${pov.heading}&pitch=${pov.pitch}&fov=${fov}&source=outdoor&key=${key}`;

            const blob = await (await fetch(svUrl)).blob();
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            setCapturedImage(`data:image/jpeg;base64,${base64}`);

            await Promise.all(
                DIFFICULTIES.map(async (difficulty) => {
                    const started = performance.now();
                    try {
                        const prompt = getPromptForStreetViewCategories(1, difficulty, language);
                        const parts = [{ text: prompt }, { text: 'Bild-ID: img_0' }, { inlineData: { mimeType: 'image/jpeg', data: base64 } }];

                        let aiResponse: Response | undefined;
                        for (const m of [model, ...GEMINI_MODELS.filter((x) => x !== model)]) {
                            try {
                                aiResponse = await callGemini(m, { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } });
                                if (aiResponse.ok) break;
                            } catch {
                                /* try next model */
                            }
                        }
                        if (!aiResponse || !aiResponse.ok) throw new Error('Gemini request failed');

                        const aiData = await aiResponse.json();
                        const text = (aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
                            .replace(/```json/g, '')
                            .replace(/```/g, '')
                            .trim();
                        const parsed: ResultItem[] = JSON.parse(text);
                        const items = Array.isArray(parsed) ? parsed.filter((i) => i && i.categoryName).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : [];

                        setResults((prev) => (prev ? { ...prev, [difficulty]: { status: 'done', items, ms: Math.round(performance.now() - started) } } : prev));
                    } catch (err) {
                        setResults((prev) => (prev ? { ...prev, [difficulty]: { status: 'error', items: [], ms: Math.round(performance.now() - started), error: err instanceof Error ? err.message : 'Failed' } } : prev));
                    }
                }),
            );
        } catch (err) {
            console.error('Capture failed:', err);
            setResults(null);
            alert('Capture failed — check the console.');
        } finally {
            setIsRunning(false);
        }
    }, [language, model]);

    // --- Render --------------------------------------------------------------
    if (!authChecked) return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-400">Checking access…</div>;
    if (!isDeveloper) return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-red-400">Developer mode only.</div>;

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-4">
            <div className="max-w-7xl mx-auto flex flex-col gap-4">
                <header className="flex flex-wrap items-center gap-3 justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">
                            Prompt Comparison <span className="text-sm font-normal text-amber-400">(dev only · temporary)</span>
                        </h1>
                        <p className="text-sm text-slate-400">Walk to a spot, frame a shot, then capture to run every panorama prompt on the exact same view.</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <select value={language} onChange={(e) => setLanguage(e.target.value as 'english' | 'german')} className="bg-slate-800 border border-slate-700 rounded px-2 py-1">
                            <option value="german">German</option>
                            <option value="english">English</option>
                        </select>
                        <select value={model} onChange={(e) => setModel(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1">
                            {GEMINI_MODELS.map((m) => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                    </div>
                </header>

                <input ref={searchRef} type="text" placeholder="Search a place to jump there (e.g. 'Times Square')…" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2">
                        <div ref={panoRef} className="w-full h-[55vh] rounded-lg overflow-hidden bg-slate-800" />
                        <button onClick={runComparison} disabled={isRunning || !isLoaded} className={`mt-3 w-full py-3 rounded-lg font-semibold transition-colors ${isRunning ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-green-700 hover:bg-green-800 text-white'}`}>
                            {isRunning ? 'Running all prompts…' : '📸 Capture & Compare'}
                        </button>
                    </div>
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-slate-400">Captured view (sent to Gemini)</span>
                        {capturedImage ? <img src={capturedImage} alt="Captured Street View" className="w-full rounded-lg border border-slate-700" /> : <div className="w-full aspect-square rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-sm">No capture yet</div>}
                    </div>
                </div>

                {results && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {DIFFICULTIES.map((difficulty) => {
                            const r = results[difficulty];
                            return (
                                <div key={difficulty} className="bg-slate-800 rounded-lg border border-slate-700 p-3 flex flex-col">
                                    <div className="flex items-center justify-between mb-2">
                                        <h2 className="font-bold capitalize">{difficulty}</h2>
                                        <span className="text-xs text-slate-500">{r.status === 'done' ? `${r.items.length} · ${r.ms}ms` : r.status === 'loading' ? '…' : 'error'}</span>
                                    </div>
                                    {r.status === 'error' && <p className="text-red-400 text-sm">{r.error}</p>}
                                    {r.status === 'loading' && <p className="text-slate-500 text-sm">Thinking…</p>}
                                    {r.status === 'done' && (
                                        <ol className="flex flex-col gap-1">
                                            {r.items.map((item, i) => (
                                                <li key={i} className="flex items-center justify-between gap-2 text-sm bg-slate-900/60 rounded px-2 py-1">
                                                    <span>{item.categoryName}</span>
                                                    <span className={`text-xs font-mono shrink-0 ${item.score >= 80 ? 'text-green-400' : item.score >= 40 ? 'text-amber-400' : 'text-slate-500'}`}>{item.score}</span>
                                                </li>
                                            ))}
                                            {r.items.length === 0 && <li className="text-slate-500 text-sm">No categories returned.</li>}
                                        </ol>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
