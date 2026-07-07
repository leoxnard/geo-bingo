'use client';

/*
================================================================================
BOUNDARY PRESET EXPORT — ADMIN TOOL
================================================================================
Draw boundary areas on the lobby map and export them as a `"Key": [ ... ]`
JSON snippet for MANUAL_OVERRIDES in scripts/getProcessedCountryBorders.py,
which folds them into public/geo_bingo_presets.json on the next run.

Gated to allow-listed admins (same am_i_daily_admin allow-list as the daily
admin). Labels are intentionally English-only: this page never ships to
players, so it stays out of the i18n catalogs.
================================================================================
*/

import { useEffect, useMemo, useState } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import { FaCopy } from 'react-icons/fa';

import AccountButton from '@/components/account/AccountButton';
import AuthGate from '@/components/community/AuthGate';
import { useUser } from '@/components/community/useUser';
import LobbyMap from '@/components/lobby/LobbyMap';
import { GOOGLE_MAPS_LIBRARIES, WORLD_DEFAULT_ID } from '@/components/utils/mapUtils';
import type { BoundaryPolygon } from '@/components/utils/types';
import { amIDailyAdmin } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Dropdown groups of the lobby preset picker (groupedPresets in LobbyMap).
// The exported "group" field places the preset explicitly; without it the
// picker falls back to key heuristics (hard-coded lists and prefixes).
// "Custom…" lets you type any new group name — the picker creates the group
// on the fly and shows the name as typed (untranslated).
const PRESET_GROUPS = ['Continents', 'Large Cities', 'Regions & Nature', 'US States', 'German States', 'Countries'] as const;
const CUSTOM_GROUP = '__custom__';

export default function PresetExportTool() {
    const { t } = useT();
    const { user, loading: userLoading } = useUser();
    const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: MAPS_KEY, libraries: GOOGLE_MAPS_LIBRARIES });

    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
    const [boundary, setBoundary] = useState('');
    const [startingPoint, setStartingPoint] = useState('');
    const [presetKey, setPresetKey] = useState('');
    const [presetGroup, setPresetGroup] = useState<string>('Countries');
    const [customGroup, setCustomGroup] = useState('');

    useEffect(() => {
        if (!user) return;
        let alive = true;
        amIDailyAdmin().then((v) => alive && setIsAdmin(v));
        return () => {
            alive = false;
        };
    }, [user]);

    const exportedAreas = useMemo(() => {
        let parsed: BoundaryPolygon[];
        try {
            parsed = boundary ? (JSON.parse(boundary) as BoundaryPolygon[]) : [];
        } catch {
            return [];
        }
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((b) => b.id !== WORLD_DEFAULT_ID && b.isComplete && Array.isArray(b.points) && b.points.length >= 3);
    }, [boundary]);

    const key = presetKey.trim().replace(/\s+/g, '_');
    const resolvedGroup = presetGroup === CUSTOM_GROUP ? customGroup.trim() : presetGroup;
    const snippet = useMemo(() => {
        if (!key || !resolvedGroup || exportedAreas.length === 0) return '';
        const displayName = key.replace(/_/g, ' ');
        // English only — getProcessedCountryBorders.py translates name_en into
        // all UI languages via DeepL and stores them as a "names" map.
        const areas = exportedAreas.map((b, i) => ({
            id: `preset_${key}_${i}`,
            name_en: displayName,
            group: resolvedGroup,
            type: b.type,
            points: b.points.map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })),
        }));
        return `${JSON.stringify(key)}: ${JSON.stringify(areas, null, 4)}`;
    }, [key, resolvedGroup, exportedAreas]);

    const copySnippet = async () => {
        try {
            await navigator.clipboard.writeText(snippet);
            toast.success('Snippet copied');
        } catch {
            toast.error('Clipboard unavailable — copy it from the preview below');
        }
    };

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

    return (
        <main className="min-h-dvh bg-slate-900 px-4 py-8 text-white">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                <h1 className="text-2xl font-bold text-indigo-300">Boundary Preset Export</h1>
                <p className="text-xs text-slate-500">
                    Draw and close one or more areas on the map, name the preset, pick its dropdown group, then paste the snippet inside the top-level braces of <code className="text-slate-400">scripts/manual_overrides.json</code> (comma-separated) and re-run <code className="text-slate-400">getProcessedCountryBorders.py</code>. A key matching an existing preset (e.g. <code className="text-slate-400">Europe</code> — mind the exact spelling, <code className="text-slate-400">North_America</code>{' '}
                    not <code className="text-slate-400">North-America</code>) replaces it; a new key adds a brand-new preset filed under the chosen group. Name everything in English — the script translates it into all UI languages via DeepL (set <code className="text-slate-400">DEEPL_API_KEY</code> when running it). Keep every area within ±180° longitude — for Antarctica-style shapes, close along the bottom instead of looping around the pole.
                </p>

                <LobbyMap
                    isHost
                    isLoaded={isLoaded}
                    startingPoint={startingPoint}
                    gameBoundary={boundary}
                    updateGameModeInfo={(u) => {
                        if (u.starting_point !== undefined) setStartingPoint(u.starting_point);
                        if (u.gameBoundary !== undefined) setBoundary(u.gameBoundary);
                    }}
                    hideDescription
                />

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input type="text" value={presetKey} onChange={(e) => setPresetKey(e.target.value)} placeholder="Preset key, e.g. Europe or North_America" className="flex-1 rounded-xl border border-slate-600 bg-slate-900 p-3 text-white outline-none focus:border-indigo-500" />
                    <select value={presetGroup} onChange={(e) => setPresetGroup(e.target.value)} className="rounded-xl border border-slate-600 bg-slate-900 p-3 text-white outline-none focus:border-indigo-500" aria-label="Dropdown group">
                        {PRESET_GROUPS.map((g) => (
                            <option key={g} value={g}>
                                {g}
                            </option>
                        ))}
                        <option value={CUSTOM_GROUP}>Custom…</option>
                    </select>
                    {presetGroup === CUSTOM_GROUP && <input type="text" value={customGroup} onChange={(e) => setCustomGroup(e.target.value)} placeholder="New group name" className="rounded-xl border border-slate-600 bg-slate-900 p-3 text-white outline-none focus:border-indigo-500" aria-label="Custom group name" />}
                    <button type="button" onClick={copySnippet} disabled={!snippet} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold uppercase text-white transition-colors hover:bg-indigo-500 disabled:opacity-50">
                        <FaCopy /> Copy snippet ({exportedAreas.length} area{exportedAreas.length === 1 ? '' : 's'})
                    </button>
                </div>

                {snippet ? <pre className="max-h-72 overflow-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs text-slate-300">{snippet}</pre> : <p className="text-xs text-slate-600">{exportedAreas.length === 0 ? 'No closed areas drawn yet.' : 'Enter a preset key to build the snippet.'}</p>}
            </div>
        </main>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <main className="flex min-h-dvh items-center justify-center bg-slate-900 px-4 text-center text-slate-300">{children}</main>;
}
