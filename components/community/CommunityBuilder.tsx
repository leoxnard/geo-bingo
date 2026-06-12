'use client';

/*
================================================================================
COMMUNITY BUILDER (wizard)
================================================================================
The 3-step flow for authoring a community preset:
  1. Explore Street View and save categories (each captured WITH its viewpoint).
  2. Draw allow/forbid boundaries and (optionally) drop a starting point — both
     happen on the same map.
  3. Name it and submit (requires an account — AuthGate).

Reuses the lobby map (boundary drawing + start-point picking) and a lightweight
StreetViewExplorer. Can be entered blank (/community/create) or pre-seeded from
the lobby "publish" path via sessionStorage.
================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaCaretDown, FaCaretRight, FaExclamationTriangle, FaInfoCircle, FaPen, FaRegTrashAlt } from 'react-icons/fa';

import LobbyMap from '@/components/lobby/LobbyMap';
import { getStreetViewImageUrl } from '@/components/streetview/streetViewHelpers';
import { RangeSlider } from '@/components/utils/Elements';
import { countDrawnBoundaries, GOOGLE_MAPS_LIBRARIES } from '@/components/utils/mapUtils';
import type { BoundaryPolygon, CommunityCategory, PresetSeed, PresetSettings } from '@/components/utils/types';
import { createPreset, getPreset, updatePreset } from '@/lib/community';
import { useT } from '@/lib/i18n/I18nProvider';

import AuthGate from './AuthGate';
import { finalizePreset } from './finalizePreset';
import StreetViewExplorer, { type StreetViewExplorerHandle } from './StreetViewExplorer';
import { displayNameFor, useUser } from './useUser';

const SEED_KEY = 'geoBingoPresetSeed';
const TOTAL_STEPS = 3;

// Fallback banner emoji used when Gemini can't pick one at publish time.
const ICON_FALLBACK = '🗺️';

// Indigo-themed checkbox (dark-indigo box, bright indigo + white check when on).
const CHECKBOX_CLASS = "h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-indigo-500 bg-indigo-950 transition-colors checked:bg-indigo-600 disabled:opacity-40 relative after:absolute after:inset-0 after:flex after:items-center after:justify-center after:text-[11px] after:leading-none after:text-white checked:after:content-['✓']";

export default function CommunityBuilder() {
    const { t } = useT();
    const router = useRouter();
    const { user } = useUser();
    const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '', libraries: GOOGLE_MAPS_LIBRARIES });

    const editId = useSearchParams().get('edit');

    const [step, setStep] = useState(0);
    const [categories, setCategories] = useState<CommunityCategory[]>([]);
    const [pendingNames, setPendingNames] = useState<string[]>([]);
    const [submissionsByCategory, setSubmissionsByCategory] = useState<Record<string, CommunityCategory[]>>({});
    const [pickerCategory, setPickerCategory] = useState<string | null>(null);
    const currentViewpointRef = useRef<{ lat: number; lng: number; heading: number; pitch: number; zoom: number } | null>(null);
    const [boundaries, setBoundaries] = useState('[]');
    const [startingPoint, setStartingPoint] = useState('open-world');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState('🌍');
    const explorerRef = useRef<StreetViewExplorerHandle>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [renameHintValue, setRenameHintValue] = useState('');
    const [recommendedMinutes, setRecommendedMinutes] = useState(10);
    const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
    const [bingoEnabled, setBingoEnabled] = useState(false);
    const [settings, setSettings] = useState<PresetSettings>({ endCondition: 'timer' });
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [pendingStart, setPendingStart] = useState<string | null>(null);
    const [startAcknowledged, setStartAcknowledged] = useState(false);

    // Drag-and-drop editing of the bingo board preview (step 2): dropping one tile
    // onto another swaps their two positions.
    const [draggedBingoIndex, setDraggedBingoIndex] = useState<number | null>(null);

    const swapCategories = (a: number, b: number) => {
        if (a === b) return;
        setCategories((prev) => {
            if (a < 0 || a >= prev.length || b < 0 || b >= prev.length) return prev;
            const next = [...prev];
            [next[a], next[b]] = [next[b], next[a]];
            return next;
        });
    };

    const setSetting = <K extends keyof PresetSettings>(key: K, value: PresetSettings[K]) => setSettings((prev) => ({ ...prev, [key]: value }));

    // Hydrate from a lobby "publish" seed, if present (skipped when editing).
    useEffect(() => {
        if (editId) return;
        try {
            const raw = localStorage.getItem(SEED_KEY);
            if (!raw) return;
            const seed = JSON.parse(raw) as PresetSeed;
            setCategories(seed.categories ?? []);
            setBoundaries(seed.boundaries ?? '[]');
            setStartingPoint(seed.startingPoint ?? 'open-world');
            setPendingNames(seed.pendingCategoryNames ?? []);
            setSubmissionsByCategory(seed.submissionsByCategory ?? {});
            if (seed.name) setName(seed.name);
            if (seed.description) setDescription(seed.description);
            localStorage.removeItem(SEED_KEY);
        } catch {
            // ignore malformed seed
        }
    }, [editId]);

    useEffect(() => {
        if (!editId) return;
        let cancelled = false;
        (async () => {
            const preset = await getPreset(editId);
            if (cancelled || !preset) return;
            setCategories(preset.categories ?? []);
            setBoundaries(JSON.stringify(preset.boundaries ?? []));
            setStartingPoint(preset.starting_point ?? 'open-world');
            setName(preset.name ?? '');
            setDescription(preset.description ?? '');
            setIcon(preset.icon ?? '🌍');
            setRecommendedMinutes(preset.recommended_time ? Math.max(1, Math.round(preset.recommended_time / 60)) : 10);
            if (preset.difficulty === 'easy' || preset.difficulty === 'medium' || preset.difficulty === 'hard') setDifficulty(preset.difficulty);
            setBingoEnabled(preset.game_mode === 'bingo');
            setSettings(preset.settings ?? { endCondition: 'timer' });
            if ((preset.starting_point ?? '').startsWith('{')) setStartAcknowledged(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [editId]);

    // Assign (or replace) a category's viewpoint, moving it out of "pending".
    const assignViewpoint = (cat: CommunityCategory) => {
        setCategories((prev) => {
            const idx = prev.findIndex((c) => c.categoryName.toLowerCase() === cat.categoryName.toLowerCase());
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = cat;
                return copy;
            }
            return [...prev, cat];
        });
        setPendingNames((prev) => prev.filter((n) => n.toLowerCase() !== cat.categoryName.toLowerCase()));
    };

    const removeByName = (categoryName: string) => {
        setCategories((prev) => prev.filter((c) => c.categoryName !== categoryName));
        setPendingNames((prev) => prev.filter((n) => n !== categoryName));
    };

    const focusOnSpot = (vp: CommunityCategory) => explorerRef.current?.openViewpoint(vp);
    const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

    const handleViewpointChange = useCallback((vp: { lat: number; lng: number; heading: number; pitch: number; zoom: number } | null) => {
        currentViewpointRef.current = vp;
    }, []);

    const renameCategory = (oldName: string, rawName: string, rawHint?: string) => {
        const newName = rawName.trim();
        const hintValue = rawHint?.trim() || undefined;

        if (newName === oldName) {
            setCategories((prev) => prev.map((c) => (c.categoryName === oldName ? { ...c, hint: hintValue } : c)));
            return;
        }

        if (!newName) return;

        const taken = [...categories.map((c) => c.categoryName), ...pendingNames].some((n) => n.toLowerCase() === newName.toLowerCase() && n.toLowerCase() !== oldName.toLowerCase());
        if (taken) {
            toast.error(t('community.duplicateCategory'));
            return;
        }
        setCategories((prev) => prev.map((c) => (c.categoryName === oldName ? { ...c, categoryName: newName, hint: hintValue } : c)));
        setPendingNames((prev) => prev.map((n) => (n === oldName ? newName : n)));
        setSubmissionsByCategory((prev) => {
            const subs = prev[oldName];
            if (!subs) return prev;
            const next = { ...prev };
            delete next[oldName];
            next[newName] = subs.map((s) => ({ ...s, categoryName: newName }));
            return next;
        });
    };

    const confirmRename = () => {
        if (renaming === null) return;
        renameCategory(renaming, renameValue, renameHintValue);
        setRenaming(null);
        setRenameHintValue('');
    };

    const takeSnapshot = (categoryName: string) => {
        const vp = currentViewpointRef.current;
        if (!vp) {
            toast.error(t('community.openFirstPosition'));
            return;
        }
        assignViewpoint({ categoryName, ...vp });
    };

    const pickFromGame = (vp: CommunityCategory) => {
        if (pickerCategory) assignViewpoint({ ...vp, categoryName: pickerCategory });
        setPickerCategory(null);
    };

    const renderCategoryRow = (name: string, viewpoint: CommunityCategory | null) => (
        <div key={(viewpoint ? 'a-' : 'p-') + name} className="flex items-start gap-3 bg-slate-800 rounded-xl p-2">
            {viewpoint ? (
                <button type="button" onClick={() => focusOnSpot(viewpoint)} onMouseEnter={() => setHoveredCategory(name)} onMouseLeave={() => setHoveredCategory(null)} title={t('community.jumpToSpot')} aria-label={t('community.jumpToSpot')} className="w-14 h-14 rounded-lg overflow-hidden shrink-0 ring-2 ring-transparent hover:ring-indigo-500 transition-shadow">
                    <img src={getStreetViewImageUrl(viewpoint, 120)} alt="" className="w-full h-full object-cover" />
                </button>
            ) : (
                <div className="w-14 h-14 rounded-lg shrink-0 bg-slate-900 border border-dashed border-amber-700/50 flex items-center justify-center text-center text-[9px] font-bold uppercase text-amber-400 px-1">{t('community.needsSpot')}</div>
            )}
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{name}</span>
                    {viewpoint?.hint && (
                        <div className="relative group flex-shrink-0 cursor-help" onClick={(e) => e.stopPropagation()}>
                            <FaInfoCircle className="text-slate-400/70 hover:text-white" size={12} />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max max-w-[200px] bg-slate-800 text-white text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-center cursor-default">
                                <span className="font-bold text-indigo-300">{t('sv.tip')}</span> {viewpoint.hint}
                            </div>
                        </div>
                    )}
                    <div className="ml-auto flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                setRenaming(name);
                                setRenameValue(name);
                                setRenameHintValue(viewpoint?.hint ?? '');
                            }}
                            className="text-slate-500 hover:text-indigo-400 p-1"
                            aria-label={t('community.renameCategory')}
                        >
                            <FaPen size={13} />
                        </button>
                        <button type="button" onClick={() => removeByName(name)} className="text-slate-500 hover:text-red-400 p-1" aria-label={t('community.deleteSpot')}>
                            <FaRegTrashAlt />
                        </button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {(submissionsByCategory[name]?.length ?? 0) > 0 && (
                        <button type="button" onClick={() => setPickerCategory(name)} className="text-[11px] font-bold uppercase px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200">
                            {t('community.fromGame')}
                        </button>
                    )}
                    <button type="button" onClick={() => takeSnapshot(name)} className="text-[11px] font-bold uppercase px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200">
                        {t('community.replaceLocation')}
                    </button>
                </div>
            </div>
        </div>
    );

    const updateDraft = (u: { starting_point?: string; gameBoundary?: string }) => {
        if (u.gameBoundary !== undefined) setBoundaries(u.gameBoundary);
        if (u.starting_point !== undefined) {
            const next = u.starting_point;
            if (next.startsWith('{') && !startAcknowledged) {
                setPendingStart(next);
            } else {
                setStartingPoint(next);
            }
        }
    };

    const acknowledgeStart = () => {
        if (pendingStart) setStartingPoint(pendingStart);
        setStartAcknowledged(true);
        setPendingStart(null);
    };

    const extraMarkers = useMemo(() => {
        let sp: { lat: number; lng: number } | null = null;
        if (startingPoint.startsWith('{')) {
            try {
                sp = JSON.parse(startingPoint) as { lat: number; lng: number };
            } catch {
                sp = null;
            }
        }
        const EPS = 1e-4; // ~11 m
        return categories.filter((c) => !sp || Math.abs(c.lat - sp.lat) > EPS || Math.abs(c.lng - sp.lng) > EPS).map((c) => ({ lat: c.lat, lng: c.lng, label: c.categoryName }));
    }, [categories, startingPoint]);

    const bingoGrid = useMemo(() => {
        const sqrt = Math.sqrt(categories.length);
        return Number.isInteger(sqrt) && sqrt >= 3 && sqrt <= 5 ? sqrt : null;
    }, [categories.length]);
    const canBingo = bingoGrid !== null;

    const existingNames = useMemo(() => categories.map((c) => c.categoryName), [categories]);

    const canSubmit = name.trim().length > 0 && categories.length > 0;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            const useBingo = bingoEnabled && canBingo;
            const hintTexts = categories.map((c) => c.hint ?? '');
            const finalized = await finalizePreset({ name, description, categoryNames: categories.map((c) => c.categoryName), categoryHints: hintTexts });
            const payload = {
                name,
                description,
                icon: finalized.icon || icon || ICON_FALLBACK,
                categoryTranslations: finalized.translations,
                titleTranslations: finalized.titleTranslations,
                descriptionTranslations: finalized.descriptionTranslations,
                categories,
                boundaries: JSON.parse(boundaries) as BoundaryPolygon[],
                startingPoint,
                recommendedTime: Math.max(1, Math.round(recommendedMinutes)) * 60,
                difficulty,
                gameMode: (useBingo ? 'bingo' : 'list') as 'bingo' | 'list',
                gridSize: bingoGrid ?? 3,
                settings: { ...settings, endCondition: useBingo ? (settings.endCondition ?? 'timer') : 'timer' },
                categoryHintTranslations: finalized.hintTranslations,
            };
            const res = editId ? await updatePreset(editId, payload) : await createPreset({ ...payload, authorName: displayNameFor(user) });
            if (res.success) {
                toast.success(editId ? t('community.updateSuccess') : t('community.submitSuccess'));
                router.push('/community');
            } else {
                toast.error(editId ? t('community.updateError') : t('community.submitError'));
            }
        } catch {
            toast.error(editId ? t('community.updateError') : t('community.submitError'));
        } finally {
            setSubmitting(false);
        }
    };

    const stepTitles = [t('community.step1Title'), t('community.step2Title'), t('community.step3Title')]; // step3Title = Publish (step 2 in 0-indexed)

    return (
        <main className="h-dvh flex flex-col bg-slate-900 text-white">
            {/* Header / stepper */}
            <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 shrink-0">
                <button type="button" onClick={() => (step === 0 ? router.push('/community') : setStep((s) => s - 1))} className="text-slate-400 hover:text-white p-1" aria-label={t('community.back')}>
                    <FaArrowLeft />
                </button>
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 uppercase font-bold">{t('community.stepLabel', { current: step + 1, total: TOTAL_STEPS })}</p>
                    <h1 className="font-bold text-indigo-400 truncate">{stepTitles[step]}</h1>
                </div>
                <div className="hidden sm:flex gap-1.5">
                    {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                        <span key={i} className={`h-2 w-2 rounded-full ${i <= step ? 'bg-indigo-500' : 'bg-slate-700'}`} />
                    ))}
                </div>
            </header>

            {/* Step body */}
            <section className="flex-1 min-h-0 relative">
                {step === 0 && (
                    <div className="flex h-full flex-col md:flex-row">
                        <div className="flex-1 min-h-0 relative">
                            <StreetViewExplorer ref={explorerRef} isLoaded={isLoaded} mode="capture" onSave={assignViewpoint} onViewpointChange={handleViewpointChange} spots={categories} existingNames={existingNames} gameBoundary={boundaries} hoveredSpot={hoveredCategory} />
                        </div>
                        <aside className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 overflow-y-auto p-4 flex flex-col gap-3 shrink-0">
                            <h2 className="font-bold text-sm uppercase text-slate-400">{t('community.savedCategories', { count: categories.length })}</h2>
                            {categories.length === 0 && pendingNames.length === 0 && <p className="text-slate-500 text-sm">{t('community.noCategoriesYet')}</p>}
                            {categories.map((cat) => renderCategoryRow(cat.categoryName, cat))}
                            {pendingNames.map((n) => renderCategoryRow(n, null))}
                        </aside>
                    </div>
                )}

                {step === 1 && (
                    <div className="h-full flex flex-col md:flex-row">
                        <div className="flex-1 min-h-0">
                            <LobbyMap isHost={true} isLoaded={isLoaded} startingPoint={startingPoint} gameBoundary={boundaries} updateGameModeInfo={updateDraft} extraMarkers={extraMarkers} hoveredCategory={hoveredCategory} />
                        </div>
                        <aside className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 overflow-y-auto p-4 flex flex-col gap-3 shrink-0">
                            <h2 className="font-bold text-sm uppercase text-slate-400">{t('community.savedCategories', { count: categories.length })}</h2>
                            {categories.length === 0 && <p className="text-slate-500 text-sm">{t('community.noCategoriesYet')}</p>}
                            {categories.map((cat) => renderCategoryRow(cat.categoryName, cat))}
                        </aside>
                    </div>
                )}

                {step === 2 && (
                    <div className="h-full overflow-y-auto p-4 sm:p-8 flex flex-col items-center">
                        <div className="w-full max-w-md flex flex-col gap-4">
                            <h2 className="text-xl font-bold text-indigo-400">{t('community.publishTitle')}</h2>
                            <div>
                                <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">{t('community.presetName')}</label>
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('community.presetNamePlaceholder')} className="w-full p-3 rounded-xl bg-slate-800 border border-slate-600 focus:border-indigo-500 text-white outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">{t('community.presetDesc')}</label>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('community.presetDescPlaceholder')} rows={3} className="w-full p-3 rounded-xl bg-slate-800 border border-slate-600 focus:border-indigo-500 text-white outline-none resize-none" />
                            </div>

                            {/* Icon + category translations are generated automatically on publish */}
                            <p className="text-xs text-slate-400 bg-slate-800 rounded-xl p-3">{t('community.autoFinalizeNote')}</p>

                            {/* Recommended round time (same slider as the lobby) */}
                            <RangeSlider title={t('community.recommendedTime')} min={1} max={60} step={1} value={recommendedMinutes} displayValue={t('settings.minutes', { count: recommendedMinutes })} onChange={setRecommendedMinutes} onCommit={() => {}} />

                            {/* Difficulty */}
                            <div>
                                <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">{t('community.difficulty')}</label>
                                <div className="flex gap-2">
                                    {(['easy', 'medium', 'hard'] as const).map((d) => (
                                        <button key={d} type="button" onClick={() => setDifficulty(d)} className={`flex-1 py-2 rounded-lg text-sm font-bold uppercase transition-colors ${difficulty === d ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                                            {d === 'easy' ? t('community.diffEasy') : d === 'medium' ? t('community.diffMedium') : t('community.diffHard')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Bingo grid (only when category count is a supported perfect square) */}
                            <div className="bg-slate-800 rounded-xl p-3">
                                <label className={`flex items-center gap-2 text-sm font-medium ${canBingo ? 'text-white' : 'text-slate-500'}`}>
                                    <input type="checkbox" checked={bingoEnabled && canBingo} disabled={!canBingo} onChange={(e) => setBingoEnabled(e.target.checked)} className={CHECKBOX_CLASS} />
                                    {t('community.bingoToggle')}
                                </label>
                                <p className="text-xs text-slate-400 mt-1">{canBingo ? t('community.bingoAvailable', { grid: `${bingoGrid}×${bingoGrid}` }) : t('community.bingoNeedsSquare')}</p>

                                {/* Draggable board preview — swap categories into the desired grid layout. */}
                                {bingoEnabled && canBingo && bingoGrid && (
                                    <>
                                        <p className="text-xs text-slate-500 mt-3 mb-2">{t('community.bingoGridEditHint')}</p>
                                        <div className={`grid gap-2 bingo-grid-${bingoGrid}`}>
                                            {categories.map((cat, i) => (
                                                <div
                                                    key={cat.categoryName}
                                                    draggable
                                                    onDragStart={() => setDraggedBingoIndex(i)}
                                                    onDragOver={(e) => e.preventDefault()}
                                                    onDrop={() => {
                                                        if (draggedBingoIndex !== null) swapCategories(draggedBingoIndex, i);
                                                        setDraggedBingoIndex(null);
                                                    }}
                                                    onDragEnd={() => setDraggedBingoIndex(null)}
                                                    title={cat.categoryName}
                                                    className={`relative flex items-center justify-center text-center rounded-lg border bg-slate-900 border-slate-600 cursor-grab active:cursor-grabbing hover:border-indigo-500 transition-all overflow-hidden aspect-square p-1 ${draggedBingoIndex === i ? 'opacity-50 scale-95 border-indigo-500' : ''}`}
                                                >
                                                    {cat.lat !== undefined && <img src={getStreetViewImageUrl(cat, 120)} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-30" />}
                                                    <span className="relative z-10 text-[10px] sm:text-xs font-bold leading-tight line-clamp-3 [word-break:break-word] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{cat.categoryName}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Win condition — only relevant for a Bingo grid */}
                            {bingoEnabled && canBingo && (
                                <div>
                                    <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">{t('community.endCondition')}</label>
                                    <div className="flex gap-2">
                                        {(['timer', 'first_bingo'] as const).map((ec) => (
                                            <button key={ec} type="button" onClick={() => setSetting('endCondition', ec)} className={`flex-1 py-2 rounded-lg text-sm font-bold uppercase transition-colors ${(settings.endCondition ?? 'timer') === ec ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                                                {ec === 'timer' ? t('community.endTimer') : t('community.endFirstBingo')}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Advanced settings — collapsed by default */}
                            <div className="bg-slate-800 rounded-xl">
                                <button type="button" onClick={() => setAdvancedOpen((o) => !o)} className="w-full flex items-center justify-between p-3 text-sm font-bold text-slate-200">
                                    <span>{t('community.advancedSettings')}</span>
                                    {advancedOpen ? <FaCaretDown /> : <FaCaretRight />}
                                </button>
                                {advancedOpen && (
                                    <div className="px-3 pb-3 flex flex-col gap-2.5 border-t border-slate-700 pt-3">
                                        {(
                                            [
                                                ['exclusiveMode', 'community.setExclusive'],
                                                ['hideMiniMap', 'community.setHideMinimap'],
                                                ['hideMapSymbols', 'community.setHidePois'],
                                                ['aiEndGame', 'community.setAiEnd'],
                                            ] as const
                                        ).map(([key, labelKey]) => (
                                            <label key={key} className="flex items-center gap-2 text-sm text-slate-200">
                                                <input type="checkbox" checked={!!settings[key]} onChange={(e) => setSetting(key, e.target.checked)} className={CHECKBOX_CLASS} />
                                                {t(labelKey)}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="text-sm text-slate-400 bg-slate-800 rounded-xl p-3 flex flex-col gap-1">
                                <span>{t('community.categoriesCount', { count: categories.length })}</span>
                                <span>{countBoundaries(boundaries) > 0 && t('community.boundariesCount', { count: countBoundaries(boundaries) })}</span>
                                <span>{startingPoint.startsWith('{') && t('community.fixedStart')}</span>
                                <span>{difficulty}</span>
                            </div>
                            {!canSubmit && <p className="text-amber-400 text-xs">{t('community.submitRequirements')}</p>}
                            {!user && <p className="text-xs text-slate-400">{t('community.signUpHint')}</p>}
                            <AuthGate>
                                <button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl uppercase transition-all disabled:opacity-50">
                                    {submitting ? t('community.submitting') : editId ? t('community.saveChanges') : t('community.submit')}
                                </button>
                            </AuthGate>
                        </div>
                    </div>
                )}
            </section>

            {/* Footer nav */}
            {step < 2 && (
                <footer className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-800 shrink-0">
                    <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold uppercase text-sm disabled:opacity-40">
                        {t('community.back')}
                    </button>
                    <button type="button" onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))} disabled={step === 0 && categories.length === 0} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase text-sm disabled:opacity-40">
                        {t('community.next')}
                    </button>
                </footer>
            )}

            {/* Starting-point acknowledgement */}
            {pendingStart && (
                <div className="absolute inset-0 z-30 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 w-full max-w-md flex flex-col gap-4">
                        <div className="flex items-center gap-2 text-amber-400">
                            <FaExclamationTriangle />
                            <h3 className="font-bold">{t('community.startWarnTitle')}</h3>
                        </div>
                        <p className="text-sm text-slate-300">{t('community.startWarnBody')}</p>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setPendingStart(null)} className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold uppercase text-sm">
                                {t('common.cancel')}
                            </button>
                            <button type="button" onClick={acknowledgeStart} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase text-sm">
                                {t('community.startWarnAck')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Rename a category */}
            {renaming !== null && (
                <div className="absolute inset-0 z-30 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 w-full max-w-md flex flex-col gap-4">
                        <h3 className="font-bold text-white">{t('community.renameCategory')}</h3>
                        <input autoFocus type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmRename()} className="w-full p-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-indigo-500 text-white outline-none" />
                        <input type="text" placeholder={t('community.categoryHintPlaceholder')} value={renameHintValue} onChange={(e) => setRenameHintValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmRename()} className="w-full p-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-indigo-500 text-white outline-none" />
                        <div className="flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setRenaming(null);
                                    setRenameHintValue('');
                                }}
                                className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold uppercase text-sm"
                            >
                                {t('common.cancel')}
                            </button>
                            <button type="button" onClick={confirmRename} disabled={!renameValue.trim()} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase text-sm disabled:opacity-50">
                                {t('community.rename')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Choose-a-find picker (all game submissions for one category) */}
            {pickerCategory && (
                <div className="absolute inset-0 z-30 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto flex flex-col gap-4">
                        <h3 className="font-bold text-white">{t('community.chooseFindTitle', { name: pickerCategory })}</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {(submissionsByCategory[pickerCategory] ?? []).map((vp, i) => (
                                <button key={i} title={pickerCategory} type="button" onClick={() => pickFromGame(vp)} className="rounded-lg overflow-hidden border-2 border-transparent hover:border-indigo-500 transition-colors">
                                    <img src={getStreetViewImageUrl(vp, 220)} alt="" className="w-full aspect-square object-cover" />
                                </button>
                            ))}
                        </div>
                        <button type="button" onClick={() => setPickerCategory(null)} className="self-end px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold uppercase text-sm">
                            {t('common.cancel')}
                        </button>
                    </div>
                </div>
            )}
        </main>
    );
}

// Count of drawn boundary polygons in a gameBoundary JSON string. Excludes the
// world-default sentinel zone (it has no points), which otherwise inflated the
// count — e.g. one drawn area with a "forbid outside" default showed as two.
function countBoundaries(boundaryString: string): number {
    try {
        const parsed = JSON.parse(boundaryString);
        return Array.isArray(parsed) ? countDrawnBoundaries(parsed) : 0;
    } catch {
        return 0;
    }
}
