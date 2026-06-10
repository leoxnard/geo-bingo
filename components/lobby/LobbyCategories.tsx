'use client';

/*
================================================================================
LOBBY CATEGORIES COMPONENT
================================================================================
Manages bingo category selection and game board configuration.
Supports manual entry, nearby places, and street view-based generation.
Provides category editing, shuffling, and validation functionality.
================================================================================
*/

import React, { useState, useEffect, useRef } from 'react';

import type { SupabaseClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import { CiCirclePlus, CiCircleMinus, CiCircleRemove, CiCircleCheck, CiCircleQuestion } from 'react-icons/ci';

import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import { CategoryLanguage } from '@/lib/i18n/locales';

import { generateAICategories } from './AICategories';
import { generateNearbyPlaceCategories } from './NearbyPlaceCategories';
import { generateNearbyStreetViewCategories } from './NearbyStreetViewCategories';
import { getHostToken } from '../../lib/hostToken';
import { RangeSlider, MultiToggleButton, Selection } from '../utils/Elements';
import { shuffle } from '../utils/Functions';
import type { BingoCategory } from '../utils/types';
import { useViewport } from '../utils/useViewport';

type CategorySource = 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';

// Category sources enabled by the feature flags (manual is always available).
const ENABLED_SOURCES: CategorySource[] = ['manual', ...(['ai', 'nearbyPlaces', 'nearbyStreetView'] as const).filter((s) => FEATURES.categorySources[s])];

// Built-in word databases enabled by the feature flags, in display order.
const ENABLED_DATABASES = (
    [
        { key: 'balanced', labelKey: 'cat.dbBalanced' },
        { key: 'easy', labelKey: 'cat.dbEasy' },
        { key: 'hard', labelKey: 'cat.dbHard' },
        { key: 'geo_all', labelKey: 'cat.dbGeoAll' },
        { key: 'geo_Vehicle', labelKey: 'cat.dbGeoVehicles' },
        { key: 'geo_Camera', labelKey: 'cat.dbGeoCamera' },
        { key: 'geo_Infrastructure', labelKey: 'cat.dbGeoInfrastructure' },
        { key: 'geo_Nature', labelKey: 'cat.dbGeoNature' },
        { key: 'geo_Plate', labelKey: 'cat.dbGeoPlates' },
        { key: 'geo_Marking', labelKey: 'cat.dbGeoMarkings' },
    ] as const
).filter((d) => FEATURES.categoryDatabases[d.key]);

const DEFAULT_DATABASE: string = ENABLED_DATABASES[0]?.key ?? 'balanced';

interface CategoryItemProps {
    initialValue: string;
    index: number;
    gameMode: string;
    draggedIndex: number | null;
    gridSize: number;
    onSave: (index: number, val: string) => boolean;
    onRemove: (index: number) => void;
    onRandomize: (index: number) => void;
    onDragStart: (e: React.DragEvent, index: number) => void;
    onDrop: (e: React.DragEvent, index: number) => void;
}

const CategoryItem = ({ initialValue, index, gameMode, draggedIndex, gridSize, onSave, onRemove, onRandomize, onDragStart, onDrop }: CategoryItemProps) => {
    const { t } = useT();
    const [val, setVal] = useState(initialValue || '');
    const [isDirty, setIsDirty] = useState(false);
    const currentValue = isDirty ? val : initialValue || '';
    const getTextSize = (gameMode: string, gridSize: number) => {
        if (gameMode !== 'bingo') return '';
        switch (gridSize) {
        case 2:
            return 'text-base sm:text-xl';
        case 3:
            return 'text-xs sm:text-base';
        case 4:
            return 'text-xs sm:text-sm';
        case 5:
            return 'text-[10px] sm:text-sm';
        case 6:
            return 'text-[9px] sm:text-xs';
        default:
            return 'text-xs sm:text-xl';
        }
    };

    const handleBlur = () => {
        const trimmedVal = currentValue.trim();
        const currentInitial = initialValue || '';

        if (trimmedVal !== currentInitial.trim()) {
            const success = onSave(index, trimmedVal);

            if (!success) {
                setVal(currentInitial);
            }
        } else if (currentValue !== currentInitial) {
            setVal(currentInitial);
        }
        setIsDirty(false);
    };

    // BINGO MODE DESIGN
    if (gameMode === 'bingo') {
        return (
            <div
                draggable
                onDragStart={(e) => onDragStart(e, index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, index)}
                className={`relative flex flex-col rounded-lg border text-center min-h-[80px] overflow-hidden transition-all focus-within:border-indigo-500 focus-within:bg-slate-700
                    ${val ? 'bg-slate-700 border-slate-600 cursor-grab active:cursor-grabbing hover:bg-slate-600' : 'bg-slate-800/50 border-dashed border-slate-600/50 text-slate-500'}
                    ${draggedIndex === index ? 'opacity-50 scale-95 border-indigo-500' : ''}
                `}
            >
                {/* Top part */}
                <div className="flex w-full bg-slate-900/60 border-b border-slate-600/50 shrink-0">
                    <button type="button" onClick={() => onRemove(index)} disabled={!val} className={`flex-1 flex justify-center items-center py-1.5 text-red-400 hover:text-red-300 transition-colors ${!val ? 'opacity-0 hover:bg-transparent' : ''}`} title={t('cat.remove')}>
                        <CiCircleRemove size={18} />
                    </button>
                    <button type="button" onClick={() => onRandomize(index)} className="flex-1 flex justify-center items-center py-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 border-l border-slate-600/50 transition-colors" title={t('cat.randomizeWord')}>
                        <CiCircleQuestion size={18} />
                    </button>
                </div>

                {/* Input field */}
                <div className="flex-1 flex items-center justify-center p-2">
                    <input
                        type="text"
                        value={currentValue}
                        onChange={(e) => {
                            setVal(e.target.value);
                            setIsDirty(true);
                        }}
                        onBlur={handleBlur}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        placeholder={t('cat.emptyInput')}
                        className={`w-full bg-transparent text-white text-center outline-none placeholder:text-slate-500/50 italic font-medium ${getTextSize(gameMode, gridSize)}`}
                    />
                </div>
            </div>
        );
    }

    // LIST MODE DESIGN
    return (
        <div className={`bg-slate-900/50 rounded-lg flex justify-between items-center border shadow-sm overflow-hidden h-[42px] focus-within:border-indigo-500 transition-colors border-slate-600`}>
            <input
                type="text"
                value={currentValue}
                onChange={(e) => {
                    setVal(e.target.value);
                    setIsDirty(true);
                }}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder={t('cat.emptyCategoryInput')}
                className="flex-1 bg-transparent text-white outline-none placeholder:text-slate-600 font-medium px-3 py-2 h-full"
            />

            <div className="flex shrink-0 border-l border-slate-700 h-full">
                <button type="button" onClick={() => onRandomize(index)} className="text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 px-4 transition-colors border-r border-slate-700 flex items-center justify-center h-full" title={t('cat.randomizeWord')}>
                    <CiCircleQuestion size={gameMode === 'list' ? 22 : undefined} />
                </button>
                <button type="button" onClick={() => onRemove(index)} className="text-red-400 hover:text-red-300 hover:bg-slate-800 px-4 transition-colors flex items-center justify-center h-full" title={t('cat.remove')}>
                    <CiCircleRemove size={gameMode === 'list' ? 22 : undefined} />
                </button>
            </div>
        </div>
    );
};

interface LobbyCategoriesProps {
    updateGameModeInfo: (updates: {
        game_mode?: string;
        team_mode?: string;
        grid_size?: number;
        starting_point?: string;
        gameBoundary?: string;
        categories?: string[];
        category_source?: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
        generation_radius?: number;
        generation_number?: number;
        difficulty?: 'default' | 'easy' | 'hard';
        categories_generated?: boolean;
        language?: CategoryLanguage;
        end_condition?: string;
        hide_minimap?: boolean;
        hide_map_symbols?: boolean;
        exclusive_mode?: boolean;
        ai_end_game?: boolean;
        time_limit?: number;
    }) => void;
    isHost: boolean;
    gameMode: 'list' | 'bingo';
    language: CategoryLanguage;
    gridSize: number;
    categories: string[];
    suggestedCategories: string[];
    gameId: string;
    gameHostId: string;
    playerId: string;
    supabase: SupabaseClient;
    maxGridSize: number;
    startingPoint: string;
    categorySource: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
    aiEnabled: boolean;
    isDeveloper?: boolean;
    generationRadius: number;
    generationNumber: number;
    difficulty: 'default' | 'easy' | 'hard';
    categoriesGenerated: boolean;
}

export default function LobbyCategories({ updateGameModeInfo, isHost, gameMode, language, gridSize, categories, suggestedCategories, gameId, playerId, supabase, maxGridSize, startingPoint, categorySource, aiEnabled, isDeveloper, generationRadius, generationNumber, difficulty, categoriesGenerated }: LobbyCategoriesProps) {
    const { t } = useT();
    const [newCategory, setNewCategory] = useState('');
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [localRadius, setLocalRadius] = useState(generationRadius);
    const [localGenerationNumber, setLocalGenerationNumber] = useState(generationNumber);
    const [localGridSize, setLocalGridSize] = useState(gridSize);
    const { isNarrow } = useViewport();

    // DB Source Selection State
    const [wordSource, setWordSource] = useState<string>(DEFAULT_DATABASE);
    const [localCategories, setLocalCategories] = useState<string[]>(categories);
    const [localSuggested, setLocalSuggested] = useState<string[]>(suggestedCategories);

    // AI Generation state
    const [customPrompt, setCustomPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const isPendingSyncRef = useRef(false);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const echoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const DAILY_AI_LIMIT = 3;

    const handleCategorySourceChange = (value: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView') => {
        const isAiOption = value === 'ai' || value === 'nearbyPlaces' || value === 'nearbyStreetView';

        const currentCount = parseInt(localStorage.getItem('geoBingoPromptCount') || '0', 10);
        const canUseAI = isDeveloper || currentCount < 3;

        if (isAiOption && !canUseAI) {
            toast.error(t('cat.toastDailyLimit'));
            return;
        }

        updateGameModeInfo({ category_source: value });
    };

    useEffect(() => {
        if (!isPendingSyncRef.current) {
            setLocalCategories(categories);
        }
    }, [categories]);

    useEffect(() => {
        if (!isPendingSyncRef.current) {
            setLocalSuggested(suggestedCategories);
        }
    }, [suggestedCategories]);

    const SUGGESTION_BUFFER = 12;

    // A source disabled by a feature flag is treated as manual, so a stale/preset
    // value never leaves the lobby stuck on a hidden source.
    const effectiveSource: CategorySource = ENABLED_SOURCES.includes(categorySource) ? categorySource : 'manual';
    const showSourceSwitcher = aiEnabled && ENABLED_SOURCES.length > 1;
    const isGeneratedSource = effectiveSource === 'ai' || effectiveSource === 'nearbyPlaces' || effectiveSource === 'nearbyStreetView';

    const handleGenerate = async () => {
        if (!isHost || !isGeneratedSource) return;

        if (!isDeveloper) {
            const currentCount = parseInt(localStorage.getItem('geoBingoPromptCount') || '0', 10);

            if (currentCount >= DAILY_AI_LIMIT) {
                toast.error(t('cat.toastDailyLimitShort', { limit: DAILY_AI_LIMIT }));
                return;
            }

            localStorage.setItem('geoBingoPromptCount', (currentCount + 1).toString());
        }

        // Nearby sources need a concrete starting point to scan around.
        let startPos: { lat: number; lng: number } | null = null;
        if (categorySource === 'nearbyPlaces' || categorySource === 'nearbyStreetView') {
            if (startingPoint === 'open-world') {
                toast.error(t('cat.toastSetStartingPoint'));
                return;
            }
            try {
                startPos = JSON.parse(startingPoint);
            } catch {
                toast.error(t('cat.toastInvalidStartingPoint'));
                return;
            }
        }

        // The host-chosen number is the size of the active (top-K) list.
        const activeCount = gameMode === 'bingo' ? gridSize * gridSize : localGenerationNumber;

        setIsGenerating(true);
        const loadingToast = toast.loading(categorySource === 'nearbyStreetView' ? t('cat.loadingStreetView') : t('cat.loadingGenerating'));

        try {
            let pool: BingoCategory[];
            if (categorySource === 'nearbyStreetView') {
                pool = await generateNearbyStreetViewCategories(startPos!, generationRadius, activeCount, difficulty, language);
            } else if (categorySource === 'nearbyPlaces') {
                pool = await generateNearbyPlaceCategories(startPos!, generationRadius, activeCount + SUGGESTION_BUFFER, difficulty, language);
            } else {
                pool = await generateAICategories(customPrompt, activeCount + SUGGESTION_BUFFER, language);
            }

            toast.dismiss(loadingToast);

            // Fewer than requested? Still keep everything we generated (the host can
            // top it up manually) and just warn — don't discard the whole batch.
            if (pool.length < activeCount) {
                toast.error(t('cat.toastOnlyFound', { found: pool.length, need: activeCount }));
            } else {
                toast.success(t('cat.generatedSuccess'));
            }

            const active = pool.slice(0, activeCount).map((c) => c.categoryName);
            const rest = pool.slice(activeCount).map((c) => c.categoryName);

            isPendingSyncRef.current = true;
            setLocalCategories(active);
            setLocalSuggested(rest);

            const { data, error } = await supabase.rpc('update_game_settings', {
                p_game_id: gameId,
                p_host_id: getHostToken(gameId),
                // Flip to manual right away so the host can keep adding categories by hand.
                p_patch: { categories: active, suggested_categories: rest, category_details: pool, categories_generated: true, category_source: 'manual' },
            });

            if (error || (data && data.success === false)) {
                throw new Error(error?.message || 'Failed to save generated categories');
            }

            setTimeout(() => {
                isPendingSyncRef.current = false;
            }, 1200);
        } catch (error) {
            toast.dismiss(loadingToast);
            toast.error(error instanceof Error ? error.message : t('cat.toastGenerationFailed'));
            console.error('Error generating categories:', error);
            isPendingSyncRef.current = false;
        } finally {
            setIsGenerating(false);
        }
    };

    const queueDBSave = (newCategories: string[]) => {
        if (!isHost) return;

        setLocalCategories(newCategories);
        isPendingSyncRef.current = true;

        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (echoTimeoutRef.current) clearTimeout(echoTimeoutRef.current);

        debounceTimerRef.current = setTimeout(async () => {
            await updateGameModeInfo({ categories: newCategories });
            echoTimeoutRef.current = setTimeout(() => {
                isPendingSyncRef.current = false;
            }, 1200);
        }, 600);
    };

    const handleCommit = () => {
        if (!isHost) return;
        updateGameModeInfo({
            generation_radius: localRadius,
            generation_number: localGenerationNumber,
            grid_size: localGridSize,
        });
    };

    const handleCategorySave = (index: number, val: string) => {
        const trimmedVal = val.trim();

        if (trimmedVal === '') {
            const updated = [...localCategories];
            updated[index] = '';
            queueDBSave(updated);
            return true;
        }

        const isDuplicate = localCategories.some((cat, i) => i !== index && (cat ?? '').toLowerCase() === trimmedVal.toLowerCase());

        if (isDuplicate) {
            toast.error(t('cat.toastDuplicate', { value: trimmedVal }));
            return false;
        }

        const updated = [...localCategories];
        while (updated.length <= index) updated.push('');
        updated[index] = trimmedVal;
        queueDBSave(updated);

        return true;
    };

    const removeCategoryIndex = (index: number) => {
        const name = (localCategories[index] || '').trim();

        if (isGeneratedSource && name) {
            moveCategoryToSuggestions(index, name);
            return;
        }

        if (gameMode === 'bingo') {
            const updated = [...localCategories];
            updated[index] = '';
            queueDBSave(updated);
            return;
        }
        const updated = localCategories.filter((_, i) => i !== index);
        queueDBSave(updated);
    };

    const moveCategoryToSuggestions = async (index: number, name: string) => {
        if (!isHost) return;

        // Bingo keeps a fixed grid, so removing leaves an empty slot; List shrinks.
        const updatedCategories = gameMode === 'bingo' ? localCategories.map((c, i) => (i === index ? '' : c)) : localCategories.filter((_, i) => i !== index);

        const alreadySuggested = localSuggested.some((c) => (c || '').toLowerCase() === name.toLowerCase());
        const updatedSug = alreadySuggested ? localSuggested : [...localSuggested, name];

        isPendingSyncRef.current = true;
        setLocalCategories(updatedCategories);
        setLocalSuggested(updatedSug);

        const { data, error } = await supabase.rpc('update_game_settings', {
            p_game_id: gameId,
            p_host_id: getHostToken(gameId),
            p_patch: { categories: updatedCategories, suggested_categories: updatedSug },
        });

        if (error || (data && data.success === false)) {
            toast.error(t('cat.toastFailedMoveSuggestion'));
            isPendingSyncRef.current = false;
        } else {
            setTimeout(() => {
                isPendingSyncRef.current = false;
            }, 1200);
        }
    };

    const getAvailableWords = async () => {
        const { categoriesBalanced, categoriesSimple, categoriesHard, geoGuessrMeta } = await import('../../lib/categories');
        let allWords: string[] = [];

        if (wordSource === 'balanced') {
            allWords = categoriesBalanced[language] ?? categoriesBalanced.english;
        } else if (wordSource === 'easy') {
            allWords = categoriesSimple[language] ?? categoriesSimple.english;
        } else if (wordSource === 'hard') {
            allWords = categoriesHard[language] ?? categoriesHard.english;
        } else {
            const pool = wordSource === 'geo_all' ? geoGuessrMeta : geoGuessrMeta.filter((item) => item.category === wordSource.replace('geo_', ''));
            allWords = pool.map((item) => item.term[language] ?? item.term.english);
        }

        return allWords.filter((w) => !localCategories.map((c) => (c || '').toLowerCase()).includes(w.toLowerCase()));
    };

    const randomizeSingle = async (index: number) => {
        try {
            const availableWords = await getAvailableWords();

            if (availableWords.length > 0) {
                const randomWord = availableWords[Math.floor(Math.random() * availableWords.length)];
                const updated = [...localCategories];
                updated[index] = randomWord;
                queueDBSave(updated);
            } else {
                toast.error(t('cat.toastNotEnoughWords'));
            }
        } catch (err) {
            console.error(err);
        }
    };

    const minusOneListCategory = () => {
        if (localCategories.length <= 0) return;
        queueDBSave(localCategories.slice(0, -1));
    };

    const plusOneListCategory = () => {
        queueDBSave([...localCategories, '']);
    };

    const fillUpRandom = async () => {
        try {
            const availableWords = shuffle(await getAvailableWords());
            const updated = [...localCategories];
            let usedCount = 0;

            for (let i = 0; i < updated.length; i++) {
                if ((updated[i] || '').trim() === '') {
                    if (usedCount < availableWords.length) {
                        updated[i] = availableWords[usedCount];
                        usedCount++;
                    }
                }
            }

            if (gameMode === 'bingo') {
                const limit = gridSize * gridSize;
                while (updated.length < limit && usedCount < availableWords.length) {
                    updated.push(availableWords[usedCount]);
                    usedCount++;
                }
            }

            if (usedCount === 0 && updated.length === localCategories.length) {
                toast(t('cat.toastAlreadyFull'));
                return;
            }

            queueDBSave(updated);
        } catch (err) {
            console.error(err);
        }
    };

    const clearCategories = () => {
        if (!isHost) return;
        const length = gameMode === 'bingo' ? gridSize * gridSize : localCategories.length;
        queueDBSave(new Array(length).fill(''));
    };

    const clearSuggestions = async () => {
        if (!isHost) return;
        isPendingSyncRef.current = true;
        setLocalSuggested([]);
        try {
            const { data, error } = await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: getHostToken(gameId), p_patch: { suggested_categories: [] } });
            if (error || (data && data.success === false)) {
                toast.error(t('cat.toastFailedClearSuggestions'));
                isPendingSyncRef.current = false;
            } else {
                setTimeout(() => {
                    isPendingSyncRef.current = false;
                }, 1200);
            }
        } catch {
            toast.error('Failed to clear suggestions.');
            isPendingSyncRef.current = false;
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (!isHost) return;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = (e: React.DragEvent, targetIndex: number) => {
        if (!isHost || draggedIndex === null || draggedIndex === targetIndex) return;
        const updated = [...localCategories];
        const [draggedItem] = updated.splice(draggedIndex, 1);
        updated.splice(targetIndex, 0, draggedItem);
        queueDBSave(updated);
        setDraggedIndex(null);
    };

    // Suggestions
    const handleSuggestCategory = async () => {
        const trimmedCat = newCategory.trim();
        if (trimmedCat !== '' && !isHost) {
            if (localCategories.some((c) => (c ?? '').toLowerCase() === trimmedCat.toLowerCase())) {
                toast.error(t('cat.toastAlreadyExists'));
                return;
            }
            const { data, error } = await supabase.rpc('player_suggest_category', { p_game_id: gameId, p_player_id: playerId, p_category: trimmedCat });
            if (error || (data && data.success === false)) {
                if (data?.error === 'ALREADY_SUGGESTED') toast.error(t('cat.toastAlreadySuggested'));
                else toast.error(t('cat.toastFailedSuggestion'));
                return;
            }
            setNewCategory('');
            toast.success(t('cat.toastSuggestionSent'));
        }
    };

    const acceptSuggestion = async (cat: string) => {
        if (!isHost) return;

        const updatedCategories = [...localCategories];
        let placed = false;

        for (let i = 0; i < updatedCategories.length; i++) {
            if ((updatedCategories[i] ?? '').trim() === '') {
                updatedCategories[i] = cat;
                placed = true;
                break;
            }
        }

        if (!placed) {
            if (gameMode === 'bingo') {
                if (updatedCategories.length < gridSize * gridSize) {
                    updatedCategories.push(cat);
                } else {
                    toast.error(t('cat.toastMaxWords', { max: gridSize * gridSize }));
                    return;
                }
            } else {
                updatedCategories.push(cat);
            }
        }

        const updatedSug = localSuggested.filter((c) => c !== cat);

        isPendingSyncRef.current = true;
        setLocalCategories(updatedCategories);
        setLocalSuggested(updatedSug);

        const { data, error } = await supabase.rpc('update_game_settings', {
            p_game_id: gameId,
            p_host_id: getHostToken(gameId),
            p_patch: { categories: updatedCategories, suggested_categories: updatedSug },
        });

        if (error || (data && data.success === false)) {
            toast.error(t('cat.toastErrorSaving'));
        } else {
            setTimeout(() => {
                isPendingSyncRef.current = false;
            }, 1200);
        }
    };

    const rejectSuggestion = async (cat: string) => {
        if (!isHost) return;
        const updatedSug = localSuggested.filter((c) => c !== cat);

        isPendingSyncRef.current = true;
        setLocalSuggested(updatedSug);

        const { data, error } = await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: getHostToken(gameId), p_patch: { suggested_categories: updatedSug } });

        if (error || (data && data.success === false)) {
            toast.error(t('cat.toastErrorRejecting'));
        } else {
            setTimeout(() => {
                isPendingSyncRef.current = false;
            }, 1200);
        }
    };

    const minusOneGridSize = () => {
        if (gridSize > 2) {
            updateGameModeInfo({ grid_size: gridSize - 1 });
        }
    };

    const plusOneGridSize = () => {
        if (gridSize < maxGridSize) {
            updateGameModeInfo({ grid_size: gridSize + 1 });
        }
    };

    return (
        <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            {showSourceSwitcher && (
                <MultiToggleButton
                    title={t('cat.sourceTitle')}
                    options={[{ value: 'manual' as const, label: t('cat.sourceManual') }, ...(FEATURES.categorySources.ai ? [{ value: 'ai' as const, label: t('cat.sourceAi') }] : []), ...(FEATURES.categorySources.nearbyPlaces ? [{ value: 'nearbyPlaces' as const, label: t('cat.sourceNearbyPlaces') }] : []), ...(FEATURES.categorySources.nearbyStreetView ? [{ value: 'nearbyStreetView' as const, label: isNarrow ? t('cat.sourceNearbyStreetViewShort') : t('cat.sourceNearbyStreetView') }] : [])]}
                    activeValue={effectiveSource}
                    onChange={handleCategorySourceChange}
                    disabled={!isHost}
                    allowedValues={startingPoint === 'open-world' ? (['manual', 'ai'] as CategorySource[]).filter((s) => ENABLED_SOURCES.includes(s)) : undefined}
                    isHost={isHost}
                    position="top"
                    columns={2}
                    sizeRatios={[1, 1.5, 1.5, 2.5]}
                    description={effectiveSource === 'manual' ? t('cat.sourceDescManual') : effectiveSource === 'ai' ? t('cat.sourceDescAi') : effectiveSource === 'nearbyPlaces' ? t('cat.sourceDescNearbyPlaces') : t('cat.sourceDescNearbyStreetView')}
                />
            )}

            {effectiveSource === 'ai' && (
                <div className="py-3 border-t border-slate-700">
                    <label className="flex justify-between font-bold mb-2 text-xl text-slate-300">{t('cat.customPrompt')}</label>
                    <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder={isHost ? t('cat.customPromptPlaceholderHost') : t('cat.customPromptPlaceholderWaiting')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none" rows={2} disabled={!isHost || isGenerating} />
                </div>
            )}

            {effectiveSource !== 'manual' && (
                <>
                    <MultiToggleButton
                        title={t('cat.difficulty')}
                        options={[
                            { value: 'easy', label: t('cat.easy') },
                            { value: 'default', label: t('cat.default') },
                            { value: 'hard', label: t('cat.hard') },
                        ]}
                        activeValue={difficulty}
                        onChange={(val) => updateGameModeInfo({ difficulty: val })}
                        disabled={!isHost}
                        sizeRatios={[1, 1, 1, 1]}
                        isHost={isHost}
                        description={difficulty === 'easy' ? t('cat.difficultyDescEasy') : difficulty === 'default' ? t('cat.difficultyDescDefault') : difficulty === 'hard' ? t('cat.difficultyDescHard') : ''}
                    />
                    {gameMode === 'list' ? <RangeSlider title={t('cat.numberOfCategories')} min={1} max={25} value={localGenerationNumber} disabled={!isHost} onChange={(val) => setLocalGenerationNumber(val)} onCommit={handleCommit} /> : <RangeSlider title={t('cat.gridSize')} min={1} max={6} value={localGridSize} disabled={!isHost} onChange={(val) => setLocalGridSize(val)} onCommit={handleCommit} />}
                </>
            )}

            {(effectiveSource === 'nearbyPlaces' || effectiveSource === 'nearbyStreetView') && <RangeSlider title={t('cat.poiRadius')} min={1} max={50} minLabel="100m" maxLabel="10km" value={localRadius} disabled={!isHost} displayValue={localRadius >= 10 ? `${(localRadius / 10).toFixed(1)} km` : `${localRadius * 100} m`} onChange={(val) => setLocalRadius(val)} onCommit={handleCommit} position="bottom" description={t('cat.poiRadiusDesc')} />}

            {isGeneratedSource && isHost && (
                <div className="flex items-center justify-center pt-3">
                    <button onClick={handleGenerate} disabled={!isHost || isGenerating} className={`px-4 py-2 rounded-lg font-medium transition-all ${isGenerating ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-indigo-700 text-white hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500'}`}>
                        {isGenerating ? t('common.generating') : categoriesGenerated ? t('cat.regenerate') : t('cat.generate')}
                    </button>
                </div>
            )}

            {(effectiveSource === 'manual' || (isGeneratedSource && categoriesGenerated)) && (
                <>
                    <h3 className={`text-xl font-bold mb-4 text-slate-300 flex justify-between items-center transition-all ${effectiveSource === 'manual' && showSourceSwitcher ? 'pt-4 border-t border-slate-700' : ''}`}>
                        <span>{t('cat.title')}</span>
                        <div className="flex items-center">
                            <span className={`text-sm font-normal ${localCategories.length === 0 || (gameMode === 'bingo' && localCategories.length < gridSize * gridSize) ? 'text-red-400' : 'text-slate-400'} bg-slate-900 px-3 py-1 rounded-full`}>{gameMode === 'bingo' ? `${Math.min(localCategories.length, gridSize * gridSize)} / ${gridSize * gridSize}` : t('cat.wordsCount', { count: localCategories.length })}</span>
                            {isHost && (
                                <button type="button" onClick={clearCategories} className="text-xs font-bold text-slate-400 bg-slate-800 hover:bg-slate-700 hover:text-white px-3 py-1 rounded-full ml-2 transition-colors">
                                    {t('cat.clear')}
                                </button>
                            )}
                        </div>
                    </h3>

                    {isHost && (
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <button title={t('cat.remove')} type="button" onClick={gameMode === 'bingo' ? minusOneGridSize : minusOneListCategory} disabled={gameMode === 'bingo' ? gridSize <= 2 : localCategories.length <= 0} className="flex items-center justify-center p-2 rounded-lg border border-dashed text-indigo-400 border-indigo-700 disabled:border-slate-600 disabled:text-slate-500 disabled:bg-slate-800 hover:bg-slate-700/20 transition-colors">
                                <CiCircleMinus size={24} />
                            </button>
                            <button title={t('cat.add')} type="button" onClick={gameMode === 'bingo' ? plusOneGridSize : plusOneListCategory} disabled={gameMode === 'bingo' && gridSize >= maxGridSize} className="flex items-center justify-center p-2 rounded-lg border border-dashed text-indigo-400 border-indigo-700 disabled:border-slate-600 disabled:text-slate-500 disabled:bg-slate-800 hover:bg-slate-700/20 transition-colors">
                                <CiCirclePlus size={24} />
                            </button>
                        </div>
                    )}

                    {isHost ? (
                        <div className="flex flex-col gap-2 mb-6">
                            {gameMode === 'bingo' ? (
                                <div className={`grid gap-3 mb-6 bingo-grid-${gridSize}`}>
                                    {Array.from({
                                        length: Math.max(gridSize * gridSize, localCategories.length),
                                    }).map((_, i) => {
                                        if (i >= gridSize * gridSize) return null;
                                        return <CategoryItem key={`cat-bingo-${i}`} initialValue={localCategories[i] || ''} index={i} gameMode={gameMode} draggedIndex={draggedIndex} gridSize={gridSize} onSave={handleCategorySave} onRemove={removeCategoryIndex} onRandomize={randomizeSingle} onDragStart={handleDragStart} onDrop={handleDrop} />;
                                    })}
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2 mb-6">
                                    {localCategories.map((cat, i) => (
                                        <CategoryItem key={`cat-list-${i}`} initialValue={cat} index={i} gameMode={gameMode} draggedIndex={draggedIndex} gridSize={gridSize} onSave={handleCategorySave} onRemove={removeCategoryIndex} onRandomize={randomizeSingle} onDragStart={handleDragStart} onDrop={handleDrop} />
                                    ))}
                                    {localCategories.length === 0 && <div className="text-center text-slate-500 italic py-6 border-2 border-dashed border-slate-700 rounded-lg">{t('cat.noCategoriesHostList')}</div>}
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2 items-end mt-2">
                                <div className="flex flex-1 gap-2 items-end justify-end min-w-[300px]">
                                    <Selection title={t('cat.database')} options={ENABLED_DATABASES.map((d) => ({ label: t(d.labelKey as Parameters<typeof t>[0]), value: d.key }))} value={wordSource} onChange={setWordSource} position="clean" />
                                    <button type="button" onClick={fillUpRandom} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 rounded-lg font-bold transition-colors whitespace-nowrap shadow-sm h-[42px]">
                                        {t('cat.fillUp')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : /* === NON-HOST ANSICHT === */
                        gameMode === 'bingo' ? (
                            <div className={`grid gap-3 mb-6 bingo-grid-${gridSize}`}>
                                {Array.from({
                                    length: Math.max(gridSize * gridSize, categories.length),
                                }).map((_, i) => {
                                    const cat = categories[i] || '';
                                    if (i >= gridSize * gridSize) return null;
                                    return (
                                        <div
                                            key={`view-bingo-${i}`}
                                            className={`relative flex items-center justify-center p-2 rounded-lg border text-center min-h-[80px] [hyphens:auto] break-words transition-all
                                            ${cat ? 'bg-slate-700 border-slate-600' : 'bg-slate-800/50 border-dashed border-slate-600/50 text-slate-500'}
                                            `}
                                        >
                                            <span className={`italic w-full ${cat ? 'text-white font-medium' : 'text-slate-500'}`}>{cat || t('cat.empty')}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : categories.length > 0 ? (
                            <ul className="mb-6 space-y-2">
                                {categories.map((cat, i) => (
                                    <li key={`view-list-${i}`} className="bg-slate-700 rounded-lg flex items-center border border-slate-600 italic shadow-sm overflow-hidden h-[42px]">
                                        <span className="break-words py-2 px-3 flex items-center text-white w-full h-full">{cat || <span className="text-slate-400">{t('cat.emptySlot')}</span>}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-center text-slate-500 italic py-6 border-2 border-dashed border-slate-700 rounded-lg">{t('cat.noCategoriesPlayer')}</div>
                        )}

                    {FEATURES.categorySuggestions && !isHost && (
                        <div className="flex gap-2 mb-4 mt-6 pt-4 border-t border-slate-700">
                            <input
                                type="text"
                                value={newCategory}
                                onChange={(e) => setNewCategory(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSuggestCategory();
                                }}
                                placeholder={t('cat.suggestPlaceholder')}
                                className="flex-1 p-3 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none focus:border-indigo-500"
                            />
                            <button type="button" onClick={handleSuggestCategory} className="bg-indigo-600 hover:bg-indigo-500 px-6 rounded-lg font-bold transition-colors">
                                {t('cat.suggest')}
                            </button>
                        </div>
                    )}

                    {FEATURES.categorySuggestions && (
                        <div className="p-4 bg-slate-800/80 rounded-xl border border-dashed border-indigo-500/50 mt-6">
                            <div className="flex items-center">
                                <h4 className="text-xs font-bold text-indigo-400 mb-3 uppercase tracking-wider">{t('cat.suggestions')}</h4>
                                {isHost && (
                                    <button type="button" onClick={clearSuggestions} className="text-xs font-bold ml-auto text-slate-400 bg-slate-800 hover:bg-slate-700 hover:text-white px-3 py-1 rounded-full ml-2 transition-colors">
                                        {t('cat.clear')}
                                    </button>
                                )}
                            </div>
                            <ul className="space-y-2">
                                {localSuggested.length === 0 ? (
                                    <li className="text-slate-500 italic py-2">{t('cat.noSuggestions')}</li>
                                ) : (
                                    localSuggested.map((cat, i) => (
                                        <li key={i} className="bg-slate-700 rounded-lg flex justify-between items-center border border-slate-600 italic shadow-sm overflow-hidden p-1 h-[42px]">
                                            <span className="break-words py-2 px-3 flex items-center text-white">{cat}</span>
                                            {isHost && (
                                                <div className="flex shrink-0 border-l border-slate-600">
                                                    <button type="button" onClick={() => acceptSuggestion(cat)} className="text-green-400 hover:text-green-300 px-4 transition-colors border-r border-slate-600 flex items-center justify-center h-[42px]" title={t('cat.accept')}>
                                                        <CiCircleCheck size={30} />
                                                    </button>
                                                    <button type="button" onClick={() => rejectSuggestion(cat)} className="text-red-400 hover:text-red-300 pl-4 pr-2 transition-colors flex items-center justify-center h-[42px]" title={t('cat.reject')}>
                                                        <CiCircleRemove size={30} />
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    ))
                                )}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
