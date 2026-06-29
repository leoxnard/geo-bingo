'use client';

/*
================================================================================
DAILY CHALLENGE — ADMIN WINDOW
================================================================================
Curates the daily-challenge candidate pool. Gated to allow-listed admins
(am_i_daily_admin). Four ways to add candidates, all running in the admin's own
authenticated browser (no server cron / service-role key):

  1. Game finds  — review unanimously-approved, AI-verified finds harvested from
                   real games (approve / reject).
  2. AI generate — run the Nearby Street View generator around a chosen spot,
                   then add the categories you like (pre-approved).
  3. Manual      — walk Street View, pick a viewpoint, name the category.
  4. Database    — bulk-add generic words as the fallback pool.

Plus the approved queue + a "generate today's challenge now" trigger.
================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import { FaArrowDown, FaArrowUp, FaCheck, FaLanguage, FaPen, FaSpinner, FaTimes, FaTrash } from 'react-icons/fa';

import AccountButton from '@/components/account/AccountButton';
import AuthGate from '@/components/community/AuthGate';
import StreetViewExplorer from '@/components/community/StreetViewExplorer';
import { useUser } from '@/components/community/useUser';
import LobbyMap from '@/components/lobby/LobbyMap';
import { generateNearbyStreetViewCategories } from '@/components/lobby/NearbyStreetViewCategories';
import { getStreetViewImageUrl } from '@/components/streetview/streetViewHelpers';
import { GOOGLE_MAPS_LIBRARIES, mapOptions } from '@/components/utils/mapUtils';
import type { BingoCategory, DailyAdminChallenge, DailyCandidate, DailyViewpoint } from '@/components/utils/types';
import { categoriesBalanced, categoriesHard, categoriesSimple } from '@/lib/categories';
import { addDailyCandidate, addDatabaseCandidates, amIDailyAdmin, deleteDailyCandidate, deleteDailyChallenge, editDailyCandidate, editDailyChallenge, listAdminDailyChallenges, listDailyCandidates, reorderDailyCandidates, replaceDailyChallenge, reviewDailyCandidate, todayUtc, translateCategories, translateCategory } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';
import { LOCALE_CODES, LOCALES } from '@/lib/i18n/locales';

type Tab = 'game' | 'ai' | 'manual' | 'database' | 'queue';
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export default function DailyAdminReview() {
    const { t } = useT();
    const { user, loading: userLoading } = useUser();
    const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: MAPS_KEY, libraries: GOOGLE_MAPS_LIBRARIES });

    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
    const [tab, setTab] = useState<Tab>('game');

    useEffect(() => {
        if (!user) return;
        let alive = true;
        amIDailyAdmin().then((v) => alive && setIsAdmin(v));
        return () => {
            alive = false;
        };
    }, [user]);

    if (userLoading) return <Centered>{t('common.loading')}</Centered>;
    if (!user)
        return (
            <Centered>
                <div className="w-full max-w-md">
                    <AuthGate>
                        <p className="text-sm text-emerald-300">{t('community.signedIn')}</p>
                    </AuthGate>
                </div>
            </Centered>
        );
    if (isAdmin === null) return <Centered>{t('common.loading')}</Centered>;
    if (!isAdmin)
        return (
            <Centered>
                <div className="flex flex-col items-center gap-4">
                    <p>{t('daily.admin.notAdmin')}</p>
                    <AccountButton />
                </div>
            </Centered>
        );

    const tabs: Tab[] = ['game', 'ai', 'manual', 'database', 'queue'];
    const tabLabel: Record<Tab, string> = {
        game: t('daily.admin.gameQueue'),
        ai: t('daily.admin.aiGenerate'),
        manual: t('daily.admin.manualSelect'),
        database: t('daily.admin.database'),
        queue: t('daily.admin.queue'),
    };

    return (
        <main className="min-h-dvh bg-slate-900 px-4 py-8 text-white">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                <h1 className="text-2xl font-bold text-indigo-300">{t('daily.admin.title')}</h1>

                <div className="flex flex-wrap gap-2">
                    {tabs.map((tb) => (
                        <button key={tb} type="button" onClick={() => setTab(tb)} className={`rounded-lg px-3 py-1.5 text-sm font-bold uppercase tracking-wide transition-colors ${tab === tb ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                            {tabLabel[tb]}
                        </button>
                    ))}
                </div>

                {tab === 'game' && <GameQueue />}
                {tab === 'ai' && <AiGenerate isLoaded={isLoaded} />}
                {tab === 'manual' && <ManualSelect isLoaded={isLoaded} />}
                {tab === 'database' && <DatabaseImport />}
                {tab === 'queue' && <ApprovedQueue />}
            </div>
        </main>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <main className="flex min-h-dvh items-center justify-center bg-slate-900 px-4 text-center text-slate-300">{children}</main>;
}

// ── 1. Game finds (review pending) ────────────────────────────────────────────

function GameQueue() {
    const { t } = useT();
    const [items, setItems] = useState<DailyCandidate[] | null>(null);

    useEffect(() => {
        listDailyCandidates('pending')
            .then(setItems)
            .catch(() => setItems([]));
    }, []);

    const review = async (id: string, decision: 'approved' | 'rejected') => {
        const item = items?.find((c) => c.id === id) ?? null;
        setItems((prev) => prev?.filter((c) => c.id !== id) ?? prev);
        // On approval, auto-translate the harvested category (it was stored without
        // translations by the harvest trigger) so players see it in their locale.
        const translations = decision === 'approved' && item ? await translateCategory(item.category) : null;
        const res = await reviewDailyCandidate(id, decision, translations);
        if (!res.success) toast.error(t('daily.admin.actionError'));
    };

    if (items === null) return <p className="text-sm text-slate-400">{t('common.loading')}</p>;
    if (items.length === 0) return <p className="text-sm text-slate-400">{t('daily.admin.noPending')}</p>;

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((c) => (
                <div key={c.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
                    {c.lat != null && c.lng != null && <img src={getStreetViewImageUrl({ lat: c.lat, lng: c.lng, heading: c.heading ?? 0, pitch: c.pitch ?? 0, zoom: c.zoom ?? 1 }, 300)} alt={c.category} className="aspect-video w-full object-cover" loading="lazy" />}
                    <div className="flex items-center justify-between gap-2 p-3">
                        <div className="min-w-0">
                            <p className="truncate font-bold text-white">{c.category}</p>
                            <p className="text-[11px] uppercase text-slate-500">{c.source}</p>
                        </div>
                        <div className="flex flex-shrink-0 gap-1">
                            <button type="button" onClick={() => review(c.id, 'approved')} className="rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-500" title={t('daily.admin.approve')}>
                                <FaCheck size={12} />
                            </button>
                            <button type="button" onClick={() => review(c.id, 'rejected')} className="rounded-lg bg-red-600 p-2 text-white hover:bg-red-500" title={t('daily.admin.reject')}>
                                <FaTimes size={12} />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── 2. AI generate ────────────────────────────────────────────────────────────

function AiGenerate({ isLoaded }: { isLoaded: boolean }) {
    const { t } = useT();
    const mapRef = useRef<google.maps.Map | null>(null);
    const [center, setCenter] = useState({ lat: 48.8566, lng: 2.3522 });
    const [radius, setRadius] = useState(10); // units of 100m
    const [difficulty, setDifficulty] = useState<'default' | 'easy' | 'hard'>('default');
    const [count, setCount] = useState(8);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<BingoCategory[] | null>(null);
    const [generating, setGenerating] = useState(false);

    const runSearch = async () => {
        const q = search.trim();
        if (!q) return;
        try {
            const { places } = await google.maps.places.Place.searchByText({ textQuery: q, fields: ['location'], maxResultCount: 1 });
            const loc = places[0]?.location;
            if (loc) {
                const next = { lat: loc.lat(), lng: loc.lng() };
                setCenter(next);
                mapRef.current?.panTo(next);
            } else toast.error(t('community.searchNoResult'));
        } catch {
            toast.error(t('community.searchNoResult'));
        }
    };

    const generate = async () => {
        setGenerating(true);
        setResults(null);
        try {
            const cats = await generateNearbyStreetViewCategories(center, radius, count, difficulty, 'english');
            setResults(cats);
        } catch {
            toast.error(t('daily.admin.generateError'));
        } finally {
            setGenerating(false);
        }
    };

    // Each tile owns a live panorama the admin can pan/zoom/turn; ADD captures that
    // optimised viewpoint (and the possibly-edited name) as the saved candidate. The
    // name is auto-translated into every locale (DeepL) before saving.
    const addTile = async (name: string, vp: DailyViewpoint): Promise<boolean> => {
        const translations = await translateCategory(name);
        const res = await addDailyCandidate(name, 'ai', vp, null, null, translations);
        if (res.success) {
            toast.success(t('daily.admin.added'));
            return true;
        }
        toast.error(res.error === 'DUPLICATE' ? t('daily.admin.duplicate') : t('daily.admin.actionError'));
        return false;
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()} placeholder={t('daily.admin.searchLocation')} className="flex-1 rounded-xl border border-slate-600 bg-slate-900 p-2.5 text-white outline-none focus:border-indigo-500" />
                <button type="button" onClick={runSearch} className="rounded-xl bg-slate-700 px-4 font-bold text-white hover:bg-slate-600">
                    {t('daily.admin.searchGo')}
                </button>
            </div>

            <div className="h-64 overflow-hidden rounded-xl border border-slate-700">
                {isLoaded ? (
                    <GoogleMap
                        mapContainerClassName="h-full w-full"
                        center={center}
                        zoom={13}
                        options={mapOptions({ streetViewControl: false })}
                        onLoad={(m) => {
                            mapRef.current = m;
                        }}
                        onClick={(e) => e.latLng && setCenter({ lat: e.latLng.lat(), lng: e.latLng.lng() })}
                    >
                        <MarkerF position={center} />
                    </GoogleMap>
                ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">{t('common.loading')}</div>
                )}
            </div>

            <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
                    {t('daily.admin.radius')}
                    <input type="number" min={1} max={100} value={radius} onChange={(e) => setRadius(Math.max(1, Number(e.target.value)))} className="rounded-lg border border-slate-600 bg-slate-900 p-2 text-white outline-none" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
                    {t('daily.admin.difficulty')}
                    <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'default' | 'easy' | 'hard')} className="rounded-lg border border-slate-600 bg-slate-900 p-2 text-white outline-none">
                        <option value="default">default</option>
                        <option value="easy">easy</option>
                        <option value="hard">hard</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
                    {t('daily.admin.count')}
                    <input type="number" min={1} max={24} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} className="rounded-lg border border-slate-600 bg-slate-900 p-2 text-white outline-none" />
                </label>
            </div>

            <button type="button" onClick={generate} disabled={generating} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-bold uppercase text-white hover:bg-indigo-500 disabled:opacity-50">
                {generating ? (
                    <>
                        <FaSpinner className="animate-spin" /> {t('daily.admin.generating')}
                    </>
                ) : (
                    t('daily.admin.generate')
                )}
            </button>

            {results && (
                <>
                    <p className="text-xs text-slate-500">{t('daily.admin.aiTileHelp')}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {results.map((cat) => {
                            const place = cat.matchedPlaces[0];
                            if (!place) return null;
                            return <AiResultTile key={cat.categoryName} place={{ lat: place.lat, lng: place.lng }} defaultName={cat.categoryName} onAdd={addTile} />;
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

// A generated AI result: a live, navigable Street View panorama plus an editable
// name. The admin frames the exact shot, then ADD captures that viewpoint.
function AiResultTile({ place, defaultName, onAdd }: { place: { lat: number; lng: number }; defaultName: string; onAdd: (name: string, vp: DailyViewpoint) => Promise<boolean> }) {
    const { t } = useT();
    const divRef = useRef<HTMLDivElement | null>(null);
    const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const placeRef = useRef(place); // captured once so the panorama is built a single time
    const [name, setName] = useState(defaultName);
    const [added, setAdded] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!divRef.current || typeof google === 'undefined') return;
        const pano = new google.maps.StreetViewPanorama(divRef.current, {
            position: placeRef.current,
            pov: { heading: 0, pitch: 0 },
            zoom: 1,
            addressControl: false,
            showRoadLabels: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
            enableCloseButton: false,
            linksControl: true,
            panControl: true,
            zoomControl: true,
            clickToGo: true,
            scrollwheel: true,
        });
        panoRef.current = pano;
        return () => {
            panoRef.current = null;
        };
    }, []);

    const add = async () => {
        const pano = panoRef.current;
        const pos = pano?.getPosition();
        const nm = name.trim();
        if (!pano || !pos || !nm) return;
        const pov = pano.getPov();
        setBusy(true);
        const ok = await onAdd(nm, { lat: pos.lat(), lng: pos.lng(), heading: pov.heading ?? 0, pitch: pov.pitch ?? 0, zoom: pano.getZoom() ?? 1 });
        setBusy(false);
        if (ok) setAdded(true);
    };

    return (
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
            <div ref={divRef} className="aspect-square w-full bg-slate-900" />
            <div className="flex flex-col gap-1.5 p-2">
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-xs text-white outline-none focus:border-indigo-500" />
                <button type="button" onClick={add} disabled={added || busy || !name.trim()} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-1.5 text-xs font-bold uppercase text-white hover:bg-indigo-500 disabled:opacity-50">
                    {busy ? <FaSpinner className="animate-spin" /> : null} {added ? t('daily.admin.addedShort') : t('daily.admin.add')}
                </button>
            </div>
        </div>
    );
}

// ── 3. Manual select ──────────────────────────────────────────────────────────

function ManualSelect({ isLoaded }: { isLoaded: boolean }) {
    const { t } = useT();
    // Two steps: frame the example viewpoint in Street View, then — once "Save spot"
    // captures it (no overlay) — name it and set an optional start point / play-area
    // boundaries (with preset quick-select) before adding.
    const [captured, setCaptured] = useState<DailyViewpoint | null>(null);
    const [name, setName] = useState('');
    const [startingPoint, setStartingPoint] = useState('open-world');
    const [boundary, setBoundary] = useState('[]');
    const [busy, setBusy] = useState(false);

    const reset = () => {
        setCaptured(null);
        setName('');
        setStartingPoint('open-world');
        setBoundary('[]');
    };

    const onAdd = async () => {
        const clean = name.trim();
        if (!captured || !clean) return;
        setBusy(true);
        try {
            const start = startingPoint.startsWith('{') ? (JSON.parse(startingPoint) as { lat: number; lng: number }) : null;
            const boundaryStr = boundary && boundary !== '[]' ? boundary : null;
            const translations = await translateCategory(clean);
            const res = await addDailyCandidate(clean, 'manual', captured, start, boundaryStr, translations);
            if (res.success) {
                toast.success(t('daily.admin.added'));
                reset();
            } else {
                toast.error(res.error === 'DUPLICATE' ? t('daily.admin.duplicate') : t('daily.admin.actionError'));
            }
        } catch {
            toast.error(t('daily.admin.actionError'));
        } finally {
            setBusy(false);
        }
    };

    // Memoize objects passed as LobbyMap props so their references stay stable
    // across re-renders — prevents the hover effect from firing on every state change.
    const capturedMarkers = useMemo(
        () => (captured ? [{ lat: captured.lat, lng: captured.lng, label: '📍' }] : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [captured?.lat, captured?.lng],
    );
    const capturedCenter = useMemo(
        () => (captured ? { lat: captured.lat, lng: captured.lng, zoom: 14 } : undefined),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [captured?.lat, captured?.lng],
    );

    // Step 1 — frame the example viewpoint.
    if (!captured) {
        return (
            <div className="flex flex-col gap-3">
                <p className="text-xs text-slate-500">{t('daily.admin.manualHelp')}</p>
                <div className="h-[78vh] overflow-hidden rounded-xl border border-slate-700">
                    <StreetViewExplorer isLoaded={isLoaded} mode="capture" onCaptureSpot={(vp) => setCaptured(vp)} panoAspectSquare />
                </div>
            </div>
        );
    }

    // Step 2 — name it + optional start point / boundaries (presets included).

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <img src={getStreetViewImageUrl(captured, 240)} alt="" className="h-28 w-28 flex-shrink-0 rounded-xl object-cover" />
                <div className="flex flex-1 flex-col gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('daily.admin.exampleLabel')}</p>
                    <input autoFocus type="text" placeholder={t('community.categoryNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAdd()} className="w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-white outline-none focus:border-indigo-500" />
                    <div className="flex gap-2">
                        <button type="button" onClick={reset} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-slate-600">
                            {t('daily.admin.reframe')}
                        </button>
                        <button type="button" onClick={onAdd} disabled={!name.trim() || busy} className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-indigo-500 disabled:opacity-50">
                            {busy ? t('daily.admin.translating') : t('daily.admin.addChallenge')}
                        </button>
                    </div>
                </div>
            </div>
            <p className="text-xs text-slate-500">{t('daily.admin.configureHelp')}</p>
            <LobbyMap
                isHost
                isLoaded={isLoaded}
                startingPoint={startingPoint}
                gameBoundary={boundary}
                updateGameModeInfo={(u) => {
                    if (u.starting_point !== undefined) setStartingPoint(u.starting_point);
                    if (u.gameBoundary !== undefined) setBoundary(u.gameBoundary);
                }}
                extraMarkers={capturedMarkers}
                centerOn={capturedCenter}
                hideDescription
            />
        </div>
    );
}

// ── 4. Database fallback pool ─────────────────────────────────────────────────

function DatabaseImport() {
    const { t } = useT();
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);

    const add = async (items: string[]) => {
        const clean = items.map((s) => s.trim()).filter(Boolean);
        if (clean.length === 0) return;
        setBusy(true);
        try {
            // Auto-translate every word into all locales before storing.
            const translations = await translateCategories(clean);
            const payload = clean.map((name, i) => ({ name, translations: translations[i] }));
            const res = await addDatabaseCandidates(payload);
            if (res.success) toast.success(t('daily.admin.dbAdded', { count: res.added }));
            else toast.error(t('daily.admin.actionError'));
        } catch {
            toast.error(t('daily.admin.actionError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-400">{t('daily.admin.databaseHelp')}</p>
            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => add(categoriesBalanced.english)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-600 disabled:opacity-50">
                    + {t('daily.admin.importBalanced')}
                </button>
                <button type="button" disabled={busy} onClick={() => add(categoriesSimple.english)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-600 disabled:opacity-50">
                    + {t('daily.admin.importSimple')}
                </button>
                <button type="button" disabled={busy} onClick={() => add(categoriesHard.english)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-600 disabled:opacity-50">
                    + {t('daily.admin.importHard')}
                </button>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('daily.admin.dbPlaceholder')} rows={6} className="rounded-xl border border-slate-600 bg-slate-900 p-3 text-white outline-none focus:border-indigo-500" />
            <button
                type="button"
                disabled={busy}
                onClick={() => {
                    add(text.split('\n'));
                    setText('');
                }}
                className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-bold uppercase text-white hover:bg-indigo-500 disabled:opacity-50"
            >
                {busy ? (
                    <>
                        <FaSpinner className="animate-spin" /> {t('daily.admin.translating')}
                    </>
                ) : (
                    t('daily.admin.addDatabase')
                )}
            </button>
        </div>
    );
}

// ── Approved queue + scheduler ────────────────────────────────────────────────

// True when a translation map covers every app locale with non-empty text.
const localesComplete = (tr: Record<string, string> | null | undefined): boolean => !!tr && LOCALE_CODES.every((c) => typeof tr[c] === 'string' && tr[c].trim().length > 0);

// Inline editor for a category's canonical name + its per-locale translations.
// The top field is the original name (the source label, untranslated); "Generate
// translations" overwrites every locale field with the API translation; each
// locale row stays hand-editable. Save persists exactly what's shown (manual
// edits win over the generated values).
function TranslationEditor({ initialName, initialTranslations, thumb, saving, onSave, onCancel }: { initialName: string; initialTranslations: Record<string, string> | null; thumb?: React.ReactNode; saving?: boolean; onSave: (name: string, translations: Record<string, string>) => void; onCancel: () => void }) {
    const { t } = useT();
    const [name, setName] = useState(initialName);
    const [tr, setTr] = useState<Record<string, string>>(() => Object.fromEntries(LOCALE_CODES.map((c) => [c, initialTranslations?.[c] ?? ''])));
    const [generating, setGenerating] = useState(false);

    const generate = async () => {
        const clean = name.trim();
        if (!clean) return;
        setGenerating(true);
        try {
            const map = await translateCategory(clean);
            setTr(Object.fromEntries(LOCALE_CODES.map((c) => [c, map[c] ?? clean])));
        } catch {
            toast.error(t('daily.admin.actionError'));
        } finally {
            setGenerating(false);
        }
    };

    const save = () => {
        const clean = name.trim();
        if (!clean) return;
        // Empty locale fields fall back to the canonical name so nothing ships blank.
        onSave(clean, Object.fromEntries(LOCALE_CODES.map((c) => [c, (tr[c] ?? '').trim() || clean])));
    };

    return (
        <div className="flex flex-col gap-3 rounded-xl border border-indigo-500/50 bg-slate-800 p-3">
            <div className="flex items-start gap-3">
                {thumb}
                <div className="flex flex-1 flex-col gap-1">
                    <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('daily.admin.originalName')}</label>
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className="w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-sm font-bold text-white outline-none focus:border-indigo-500" />
                </div>
            </div>

            <button type="button" onClick={generate} disabled={generating || !name.trim()} className="flex items-center justify-center gap-2 rounded-lg bg-slate-700 py-2 text-xs font-bold uppercase text-white hover:bg-slate-600 disabled:opacity-50">
                {generating ? <FaSpinner className="animate-spin" /> : <FaLanguage size={13} />} {t('daily.admin.generateTranslations')}
            </button>

            <div className="flex flex-col gap-1.5">
                {LOCALE_CODES.map((code) => (
                    <label key={code} className="flex items-center gap-2">
                        <span className="w-7 flex-shrink-0 text-center text-base" title={LOCALES[code].label}>
                            {LOCALES[code].flag}
                        </span>
                        <input value={tr[code] ?? ''} onChange={(e) => setTr((p) => ({ ...p, [code]: e.target.value }))} placeholder={LOCALES[code].label} className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 p-1.5 text-sm text-white outline-none focus:border-indigo-500" />
                    </label>
                ))}
            </div>

            <div className="flex gap-2">
                <button type="button" onClick={onCancel} className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold uppercase text-slate-200 hover:bg-slate-600">
                    {t('common.cancel')}
                </button>
                <button type="button" onClick={save} disabled={saving || !name.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-xs font-bold uppercase text-white hover:bg-indigo-500 disabled:opacity-50">
                    {saving ? <FaSpinner className="animate-spin" /> : <FaCheck />} {t('daily.admin.save')}
                </button>
            </div>
        </div>
    );
}

function ApprovedQueue() {
    const { t } = useT();
    const today = todayUtc();
    const [items, setItems] = useState<DailyCandidate[] | null>(null);
    const [challenges, setChallenges] = useState<DailyAdminChallenge[] | null>(null);

    const [replacing, setReplacing] = useState(false);
    const [deletingDate, setDeletingDate] = useState<string | null>(null);
    const [fixing, setFixing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const load = useCallback(() => {
        listDailyCandidates('approved')
            .then(setItems)
            .catch(() => setItems([]));
        listAdminDailyChallenges()
            .then(setChallenges)
            .catch(() => setChallenges([]));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const replace = async () => {
        if (!window.confirm(t('daily.admin.replaceConfirm'))) return;
        setReplacing(true);
        try {
            const res = await replaceDailyChallenge(today);
            if (res.success) toast.success(t('daily.admin.replaced', { category: res.category ?? '' }));
            else toast.error(res.error === 'NO_CANDIDATE' ? t('daily.admin.replaceNoCandidate') : t('daily.admin.actionError'));
            load();
        } catch {
            toast.error(t('daily.admin.actionError'));
        } finally {
            setReplacing(false);
        }
    };

    const deleteChallenge = async (c: DailyAdminChallenge) => {
        if (!window.confirm(t('daily.admin.deleteChallengeConfirm', { category: c.category, date: c.challenge_date, count: c.attempts }))) return;
        setDeletingDate(c.challenge_date);
        try {
            const res = await deleteDailyChallenge(c.challenge_date);
            if (res.success) {
                if (res.category) toast.success(t('daily.admin.deleteChallengeReplaced', { category: res.category }));
                else toast(t('daily.admin.deleteChallengeNoQueue'));
                load();
            } else {
                toast.error(t('daily.admin.actionError'));
            }
        } catch {
            toast.error(t('daily.admin.actionError'));
        } finally {
            setDeletingDate(null);
        }
    };

    // Re-translate the whole pool (candidates + materialised challenges) via Gemini,
    // overwriting existing maps. We re-do everything — not just the locale-incomplete
    // ones — because a wrong-but-"complete" map (an echoed compound, or a word that
    // drifted to the wrong sense per language) reads as filled yet still needs fixing.
    const fixTranslations = async () => {
        const cands = items ?? [];
        const chals = challenges ?? [];
        const names = [...cands.map((c) => c.category), ...chals.map((c) => c.category)];
        if (names.length === 0) {
            toast(t('daily.admin.translationsOk'));
            return;
        }
        setFixing(true);
        try {
            const maps = await translateCategories(names);
            let i = 0;
            for (const c of cands) await editDailyCandidate(c.id, c.category, maps[i++]);
            for (const c of chals) await editDailyChallenge(c.challenge_date, c.category, maps[i++], false);
            toast.success(t('daily.admin.translationsFixed', { count: names.length }));
            load();
        } catch {
            toast.error(t('daily.admin.actionError'));
        } finally {
            setFixing(false);
        }
    };

    const curated = items?.filter((c) => !c.is_fallback) ?? [];
    const fallback = items?.filter((c) => c.is_fallback) ?? [];

    // Reorder the curated queue (the part that actually controls "what runs next").
    // Persist the full curated order so sort_order matches the displayed order.
    const move = async (index: number, dir: -1 | 1) => {
        const j = index + dir;
        if (j < 0 || j >= curated.length) return;
        const next = [...curated];
        [next[index], next[j]] = [next[j], next[index]];
        setItems([...next, ...fallback]);
        const res = await reorderDailyCandidates(next.map((c) => c.id)).catch(() => null);
        if (!res?.success) {
            toast.error(t('daily.admin.actionError'));
            load();
        }
    };

    // Save a queued candidate's edited name + (hand-tuned) translation map.
    const saveCandidate = async (c: DailyCandidate, name: string, translations: Record<string, string>) => {
        setSavingEdit(true);
        try {
            const res = await editDailyCandidate(c.id, name, translations);
            if (res.success) {
                setItems((prev) => prev?.map((x) => (x.id === c.id ? { ...x, category: name, category_translations: translations } : x)) ?? prev);
                setEditingId(null);
            } else toast.error(res.error === 'DUPLICATE' ? t('daily.admin.duplicate') : t('daily.admin.actionError'));
        } finally {
            setSavingEdit(false);
        }
    };

    // Save an edited challenge. When the category (the task) actually changed and
    // plays are recorded, ask whether to wipe them before persisting.
    const saveChallenge = async (c: DailyAdminChallenge, name: string, translations: Record<string, string>) => {
        let clear = false;
        if (c.attempts > 0) {
            clear = window.confirm(t('daily.admin.clearAttemptsConfirm', { count: c.attempts }));
        }
        setSavingEdit(true);
        try {
            const res = await editDailyChallenge(c.challenge_date, name, translations, clear);
            if (res.success) {
                toast.success(t('daily.admin.challengeUpdated'));
                setEditingDate(null);
                load();
            } else toast.error(t('daily.admin.actionError'));
        } finally {
            setSavingEdit(false);
        }
    };

    const removeCandidate = async (c: DailyCandidate) => {
        if (!window.confirm(t('daily.admin.deleteConfirm', { category: c.category }))) return;
        setItems((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
        const res = await deleteDailyCandidate(c.id).catch(() => null);
        if (!res?.success) {
            toast.error(t('daily.admin.actionError'));
            load();
        }
    };

    const thumbOf = (vp: { lat: number | null; lng: number | null; heading: number | null; pitch: number | null; zoom: number | null }) =>
        vp.lat != null && vp.lng != null ? <img src={getStreetViewImageUrl({ lat: vp.lat, lng: vp.lng, heading: vp.heading ?? 0, pitch: vp.pitch ?? 0, zoom: vp.zoom ?? 1 }, 120)} alt="" className="h-12 w-12 flex-shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-slate-700 text-lg">🌍</span>;

    const renderRow = (c: DailyCandidate, index: number, reorderable: boolean) => {
        if (editingId === c.id) {
            return (
                <li key={c.id}>
                    <TranslationEditor initialName={c.category} initialTranslations={c.category_translations} thumb={thumbOf(c)} saving={savingEdit} onSave={(name, tr) => saveCandidate(c, name, tr)} onCancel={() => setEditingId(null)} />
                </li>
            );
        }
        return (
            <li key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
                {thumbOf(c)}
                <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-white">{c.category}</p>
                    <p className="text-[11px] uppercase text-slate-500">
                        {c.source}
                        {c.is_fallback ? ` · ${t('daily.admin.fallback')}` : ''}
                        {!localesComplete(c.category_translations) ? <span className="text-amber-400"> · {t('daily.admin.untranslated')}</span> : ''}
                    </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setEditingId(c.id)} title={t('daily.admin.editName')} className="rounded-lg bg-slate-700 p-2 text-slate-200 hover:bg-slate-600">
                        <FaPen size={11} />
                    </button>
                    {reorderable && (
                        <>
                            <button type="button" onClick={() => move(index, -1)} disabled={index === 0} title={t('daily.admin.moveUp')} className="rounded-lg bg-slate-700 p-2 text-slate-200 hover:bg-slate-600 disabled:opacity-40">
                                <FaArrowUp size={11} />
                            </button>
                            <button type="button" onClick={() => move(index, 1)} disabled={index === curated.length - 1} title={t('daily.admin.moveDown')} className="rounded-lg bg-slate-700 p-2 text-slate-200 hover:bg-slate-600 disabled:opacity-40">
                                <FaArrowDown size={11} />
                            </button>
                        </>
                    )}
                    <button type="button" onClick={() => removeCandidate(c)} title={t('daily.admin.delete')} className="rounded-lg bg-slate-700 p-2 text-red-300 hover:bg-red-600 hover:text-white">
                        <FaTrash size={11} />
                    </button>
                </div>
            </li>
        );
    };

    const renderChallenge = (c: DailyAdminChallenge) => {
        const isToday = c.challenge_date === today;
        if (editingDate === c.challenge_date) {
            return (
                <li key={c.challenge_date}>
                    <TranslationEditor initialName={c.category} initialTranslations={c.category_translations} thumb={thumbOf(c)} saving={savingEdit} onSave={(name, tr) => saveChallenge(c, name, tr)} onCancel={() => setEditingDate(null)} />
                </li>
            );
        }
        return (
            <li key={c.challenge_date} className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
                {thumbOf(c)}
                <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-white">{c.category}</p>
                    <p className="text-[11px] uppercase text-slate-500">
                        {isToday ? <span className="text-indigo-300">{t('daily.today')} · </span> : `${c.challenge_date} · `}
                        {c.source} · {t('daily.admin.plays', { count: c.attempts })}
                        {!localesComplete(c.category_translations) ? <span className="text-amber-400"> · {t('daily.admin.untranslated')}</span> : ''}
                    </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setEditingDate(c.challenge_date)} title={t('daily.admin.editChallenge')} className="rounded-lg bg-slate-700 p-2 text-slate-200 hover:bg-slate-600">
                        <FaPen size={11} />
                    </button>
                    {isToday && (
                        <button type="button" onClick={replace} disabled={replacing} title={t('daily.admin.replaceNext')} className="rounded-lg bg-slate-700 p-2 text-slate-200 hover:bg-slate-600 disabled:opacity-50">
                            {replacing ? <FaSpinner className="animate-spin" size={11} /> : <FaCheck size={11} />}
                        </button>
                    )}
                    <button type="button" onClick={() => deleteChallenge(c)} disabled={deletingDate === c.challenge_date} title={t('daily.admin.deleteChallenge')} className="rounded-lg bg-rose-900/60 p-2 text-rose-300 hover:bg-rose-800 disabled:opacity-50">
                        {deletingDate === c.challenge_date ? <FaSpinner className="animate-spin" size={11} /> : <FaTrash size={11} />}
                    </button>
                </div>
            </li>
        );
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('daily.admin.scheduled')}</p>
                    <button type="button" onClick={fixTranslations} disabled={fixing} title={t('daily.admin.retranslate')} className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-600 disabled:opacity-50">
                        {fixing ? <FaSpinner className="animate-spin" size={11} /> : <FaLanguage size={13} />} {t('daily.admin.retranslate')}
                    </button>
                </div>
                {challenges === null ? <p className="text-sm text-slate-400">{t('common.loading')}</p> : challenges.length === 0 ? <p className="text-sm text-slate-400">{t('daily.admin.noChallengesYet')}</p> : <ul className="flex flex-col gap-2 pr-1">{challenges.map(renderChallenge)}</ul>}
            </div>

            {items === null ? (
                <p className="text-sm text-slate-400">{t('common.loading')}</p>
            ) : items.length === 0 ? (
                <p className="text-sm text-slate-400">{t('daily.admin.queueEmpty')}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('daily.admin.curatedQueue')}</p>
                        {curated.length === 0 ? <p className="text-sm text-slate-400">{t('daily.admin.curatedEmpty')}</p> : <ul className="flex flex-col gap-2">{curated.map((c, i) => renderRow(c, i, true))}</ul>}
                    </div>

                    {fallback.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('daily.admin.fallbackPool', { count: fallback.length })}</p>
                            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">{fallback.map((c, i) => renderRow(c, i, false))}</ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
