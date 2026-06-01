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

import { generateAICategories } from './AICategories';
import { getHostToken } from '../../lib/hostToken';
import { RangeSlider, MultiToggleButton, Selection } from '../utils/Elements';
import { shuffle } from '../utils/Functions';
import { useViewport } from '../utils/useViewport';

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
                    <button type="button" onClick={() => onRemove(index)} disabled={!val} className={`flex-1 flex justify-center items-center py-1.5 text-red-400 hover:text-red-300 transition-colors ${!val ? 'opacity-0 hover:bg-transparent' : ''}`} title="Remove">
                        <CiCircleRemove size={18} />
                    </button>
                    <button type="button" onClick={() => onRandomize(index)} className="flex-1 flex justify-center items-center py-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 border-l border-slate-600/50 transition-colors" title="Randomize word">
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
                        placeholder="Empty..."
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
                placeholder="Empty category..."
                className="flex-1 bg-transparent text-white outline-none placeholder:text-slate-600 font-medium px-3 py-2 h-full"
            />

            <div className="flex shrink-0 border-l border-slate-700 h-full">
                <button type="button" onClick={() => onRandomize(index)} className="text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 px-4 transition-colors border-r border-slate-700 flex items-center justify-center h-full" title="Randomize word">
                    <CiCircleQuestion size={gameMode === 'list' ? 22 : undefined} />
                </button>
                <button type="button" onClick={() => onRemove(index)} className="text-red-400 hover:text-red-300 hover:bg-slate-800 px-4 transition-colors flex items-center justify-center h-full" title="Remove">
                    <CiCircleRemove size={gameMode === 'list' ? 22 : undefined} />
                </button>
            </div>
        </div>
    );
};

interface LobbyCategoriesProps {
    updateGameModeInfo: (updates: { game_mode?: string; team_mode?: string; grid_size?: number; starting_point?: string; gameBoundary?: string; categories?: string[]; category_source?: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView'; generation_radius?: number; generation_number?: number; difficulty?: 'default' | 'easy'; categories_generated?: boolean; language?: 'english' | 'german' }) => void;
    isHost: boolean;
    gameMode: 'list' | 'bingo';
    language: 'english' | 'german';
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
    difficulty: 'default' | 'easy';
    categoriesGenerated: boolean;
}

export default function LobbyCategories({ updateGameModeInfo, isHost, gameMode, language, gridSize, categories, suggestedCategories, gameId, playerId, supabase, maxGridSize, startingPoint, categorySource, aiEnabled, isDeveloper, generationRadius, generationNumber, difficulty, categoriesGenerated }: LobbyCategoriesProps) {
    const [newCategory, setNewCategory] = useState('');
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [localRadius, setLocalRadius] = useState(generationRadius);
    const [localGenerationNumber, setLocalGenerationNumber] = useState(generationNumber);
    const [localGridSize, setLocalGridSize] = useState(gridSize);
    const { isNarrow } = useViewport();

    // DB Source Selection State
    const [wordSource, setWordSource] = useState<string>('balanced');
    const [localCategories, setLocalCategories] = useState<string[]>(categories);

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
            toast.error('Daily limit (3/3) reached. Login to unlock unlimited prompts.');
            return;
        }

        updateGameModeInfo({ category_source: value });
    };

    useEffect(() => {
        if (!isPendingSyncRef.current) {
            setLocalCategories(categories);
        }
    }, [categories]);

    const handleAIGeneration = async () => {
        if (!isHost) return;

        if (!isDeveloper) {
            const currentCount = parseInt(localStorage.getItem('geoBingoPromptCount') || '0', 10);

            if (currentCount >= DAILY_AI_LIMIT) {
                toast.error(`Daily limit (${DAILY_AI_LIMIT}/${DAILY_AI_LIMIT}) reached.`);
                return;
            }

            localStorage.setItem('geoBingoPromptCount', (currentCount + 1).toString());
        }

        setIsGenerating(true);

        try {
            const requiredCount = gameMode === 'bingo' ? gridSize * gridSize : localGenerationNumber;
            const aiCategories = await generateAICategories(customPrompt, requiredCount, language);

            const newCategories = aiCategories.map((cat: { categoryName: string }) => cat.categoryName);

            queueDBSave(newCategories);
            await updateGameModeInfo({ categories_generated: true });
            toast.success(`Generated ${newCategories.length} AI categories successfully!`);
        } catch (error) {
            console.error('Error generating AI categories:', error);
            toast.error('Failed to generate AI categories. Please try again.');
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
            toast.error(`"${trimmedVal}" already exists!`);
            return false;
        }

        const updated = [...localCategories];
        while (updated.length <= index) updated.push('');
        updated[index] = trimmedVal;
        queueDBSave(updated);

        return true;
    };

    const removeCategoryIndex = (index: number) => {
        if (gameMode === 'bingo') {
            const updated = [...localCategories];
            updated[index] = '';
            queueDBSave(updated);
            return;
        }
        const updated = localCategories.filter((_, i) => i !== index);
        queueDBSave(updated);
    };

    const getAvailableWords = async () => {
        const { categoriesDe, categoriesEn, categoriesSimpleDe, categoriesSimpleEn, categoriesHardDe, categoriesHardEn, GeoGuessrMetaDe, GeoGuessrMetaEn } = await import('../../lib/categories');
        let allWords: string[] = [];

        if (wordSource === 'balanced') {
            allWords = language === 'german' ? categoriesDe : categoriesEn;
        } else if (wordSource === 'easy') {
            allWords = language === 'german' ? categoriesSimpleDe : categoriesSimpleEn;
        } else if (wordSource === 'hard') {
            allWords = language === 'german' ? categoriesHardDe : categoriesHardEn;
        } else {
            const geoDb = language === 'german' ? GeoGuessrMetaDe : GeoGuessrMetaEn;
            if (wordSource === 'geo_all') {
                allWords = geoDb.map((item: { term: string; category: string }) => item.term);
            } else {
                const category = wordSource.replace('geo_', '');
                allWords = geoDb.filter((item: { term: string; category: string }) => item.category === category).map((item: { term: string; category: string }) => item.term);
            }
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
                toast.error('Not enough new words available in this category!');
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
                toast('Already full or no words left in this category!');
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
                toast.error('This category already exists!');
                return;
            }
            // player_suggest_category does case-insensitive dedup against
            // suggested_categories server-side, so we only need to filter
            // the current categories list locally.
            const { data, error } = await supabase.rpc('player_suggest_category', { p_game_id: gameId, p_player_id: playerId, p_category: trimmedCat });
            if (error || (data && data.success === false)) {
                if (data?.error === 'ALREADY_SUGGESTED') toast.error('This category was already suggested!');
                else toast.error('Failed to send suggestion.');
                return;
            }
            setNewCategory('');
            toast.success('Suggestion sent to the host!');
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
                    toast.error(`Maximal ${gridSize * gridSize} words allowed!`);
                    return;
                }
            } else {
                updatedCategories.push(cat);
            }
        }

        const updatedSug = suggestedCategories.filter((c) => c !== cat);

        isPendingSyncRef.current = true;
        setLocalCategories(updatedCategories);

        const { data, error } = await supabase.rpc('update_game_settings', {
            p_game_id: gameId,
            p_host_id: getHostToken(gameId),
            p_patch: { categories: updatedCategories, suggested_categories: updatedSug },
        });

        if (error || (data && data.success === false)) {
            toast.error('Error saving suggestion');
        } else {
            setTimeout(() => {
                isPendingSyncRef.current = false;
            }, 1200);
        }
    };

    const rejectSuggestion = async (cat: string) => {
        if (!isHost) return;
        const updatedSug = suggestedCategories.filter((c) => c !== cat);
        await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: getHostToken(gameId), p_patch: { suggested_categories: updatedSug } });
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
            <div className="pb-3">
                <label className="flex justify-between font-bold mb-2 text-xl text-slate-300">
                    <span>Category Language</span>
                </label>
                <select title="Category Language" value={language} onChange={(e) => updateGameModeInfo({ language: e.target.value as 'english' | 'german' })} disabled={!isHost} className="h-[42px] px-3 w-full rounded-lg bg-slate-900 border border-slate-600 text-sm text-white cursor-pointer transition-colors focus:outline-none focus:border-indigo-500 hover:border-slate-500 disabled:opacity-50">
                    <option value="german">German</option>
                    <option value="english">English</option>
                </select>
            </div>

            {aiEnabled && (
                <MultiToggleButton
                    title="Category Source"
                    options={[
                        { value: 'manual', label: 'Manual' },
                        { value: 'ai', label: 'AI Generator (Beta)' },
                        { value: 'nearbyPlaces', label: 'Nearby Places (Beta)' },
                        { value: 'nearbyStreetView', label: isNarrow ? 'Street View' : 'Nearby Street View Features (Beta)' },
                    ]}
                    activeValue={categorySource}
                    onChange={handleCategorySourceChange}
                    disabled={!isHost}
                    allowedValues={startingPoint === 'open-world' ? ['manual', 'ai'] : undefined}
                    isHost={isHost}
                    position="top"
                    columns={2}
                    sizeRatios={[1, 1.5, 1.5, 2.5]}
                    description={
                        categorySource === 'manual'
                            ? 'Players submit categories manually.'
                            : categorySource === 'ai'
                                ? 'Generate categories using AI with custom prompts or random themes. Categories appear immediately for editing.'
                                : categorySource === 'nearbyPlaces'
                                    ? 'Categories will be auto-generated by AI based on nearby points of interest. They remain hidden until the game starts!'
                                    : categorySource === 'nearbyStreetView'
                                        ? 'Categories will be auto-generated by AI based on nearby Street View features. They remain hidden until the game starts!'
                                        : 'Generate categories using AI with custom prompts or random themes. Categories appear immediately for editing.'
                    }
                />
            )}

            {categorySource === 'ai' && (
                <div className="py-3 border-t border-slate-700">
                    <label className="flex justify-between font-bold mb-2 text-xl text-slate-300">Custom Prompt (Optional)</label>
                    <textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder={isHost ? "Enter a theme like 'car brands', 'construction elements', or 'vintage signs'. Leave empty for random categories." : 'Waiting for host to generate categories...'}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        rows={2}
                        disabled={!isHost || isGenerating}
                    />
                </div>
            )}

            {categorySource !== 'manual' && (
                <>
                    <MultiToggleButton
                        title="Difficulty"
                        options={[
                            { value: 'default', label: 'Default' },
                            { value: 'easy', label: 'Easy' },
                        ]}
                        activeValue={difficulty}
                        onChange={(val) => updateGameModeInfo({ difficulty: val })}
                        disabled={!isHost}
                        sizeRatios={[1, 1]}
                        isHost={isHost}
                        description={difficulty === 'default' ? 'AI will generate more specific categories. Good for smaller radii and urban areas.' : 'AI will generate more general categories. Better for larger radii.'}
                    />
                    {gameMode === 'list' ? <RangeSlider title="Number of Categories" min={1} max={25} value={localGenerationNumber} disabled={!isHost} onChange={(val) => setLocalGenerationNumber(val)} onCommit={handleCommit} /> : <RangeSlider title="Grid Size" min={1} max={6} value={localGridSize} disabled={!isHost} onChange={(val) => setLocalGridSize(val)} onCommit={handleCommit} />}
                </>
            )}

            {(categorySource === 'nearbyPlaces' || categorySource === 'nearbyStreetView') && (
                <RangeSlider title="POI Radius" min={1} max={50} minLabel="100m" maxLabel="10km" value={localRadius} disabled={!isHost} displayValue={localRadius >= 10 ? `${(localRadius / 10).toFixed(1)} km` : `${localRadius * 100} m`} onChange={(val) => setLocalRadius(val)} onCommit={handleCommit} position="bottom" description="Only POIs within this radius from the starting point will be considered for category generation." />
            )}

            {categorySource === 'ai' && isHost && (
                <div className="flex items-center justify-center pt-3">
                    <button onClick={handleAIGeneration} disabled={!isHost || isGenerating} className={`px-4 py-2 rounded-lg font-medium transition-all ${isGenerating ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-green-700 text-white hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-500'}`}>
                        {isGenerating ? 'Generating...' : 'Generate Categories'}
                    </button>
                </div>
            )}

            {(categorySource === 'manual' || (categorySource === 'ai' && categoriesGenerated)) && (
                <>
                    <h3 className={`text-xl font-bold mb-4 text-slate-300 flex justify-between items-center transition-all ${categorySource === 'manual' && aiEnabled ? 'pt-4 border-t border-slate-700' : ''}`}>
                        <span>Categories</span>
                        <div className="flex items-center">
                            <span className={`text-sm font-normal ${localCategories.length === 0 || (gameMode === 'bingo' && localCategories.length < gridSize * gridSize) ? 'text-red-400' : 'text-slate-400'} bg-slate-900 px-3 py-1 rounded-full`}>{gameMode === 'bingo' ? `${Math.min(localCategories.length, gridSize * gridSize)} / ${gridSize * gridSize}` : `${localCategories.length} Words`}</span>
                            {isHost && (
                                <button type="button" onClick={clearCategories} className="text-xs font-bold text-slate-400 bg-slate-800 hover:bg-slate-700 hover:text-white px-3 py-1 rounded-full ml-2 transition-colors">
                                    Clear
                                </button>
                            )}
                        </div>
                    </h3>

                    {isHost && (
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <button title="Remove" type="button" onClick={gameMode === 'bingo' ? minusOneGridSize : minusOneListCategory} disabled={gameMode === 'bingo' ? gridSize <= 2 : localCategories.length <= 0} className="flex items-center justify-center p-2 rounded-lg border border-dashed text-indigo-400 border-indigo-700 disabled:border-slate-600 disabled:text-slate-500 disabled:bg-slate-800 hover:bg-slate-700/20 transition-colors">
                                <CiCircleMinus size={24} />
                            </button>
                            <button title="Add" type="button" onClick={gameMode === 'bingo' ? plusOneGridSize : plusOneListCategory} disabled={gameMode === 'bingo' && gridSize >= maxGridSize} className="flex items-center justify-center p-2 rounded-lg border border-dashed text-indigo-400 border-indigo-700 disabled:border-slate-600 disabled:text-slate-500 disabled:bg-slate-800 hover:bg-slate-700/20 transition-colors">
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
                                    {localCategories.length === 0 && <div className="text-center text-slate-500 italic py-6 border-2 border-dashed border-slate-700 rounded-lg">No categories yet. Add new ones or generate nearby places!</div>}
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2 items-end mt-2">
                                <div className="flex flex-1 gap-2 items-end justify-end min-w-[300px]">
                                    <Selection
                                        title="Database"
                                        options={[
                                            { label: 'Balanced', value: 'balanced' },
                                            { label: 'Easy', value: 'easy' },
                                            { label: 'Hard', value: 'hard' },
                                            { label: 'GeoGuessr Meta (All)', value: 'geo_all' },
                                            {
                                                label: 'GeoGuessr Meta: Vehicles',
                                                value: 'geo_Vehicle',
                                            },
                                            { label: 'GeoGuessr Meta: Camera', value: 'geo_Camera' },
                                            {
                                                label: 'GeoGuessr Meta: Infrastructure',
                                                value: 'geo_Infrastructure',
                                            },
                                            { label: 'GeoGuessr Meta: Nature', value: 'geo_Nature' },
                                            { label: 'GeoGuessr Meta: Plates', value: 'geo_Plate' },
                                            {
                                                label: 'GeoGuessr Meta: Markings',
                                                value: 'geo_Marking',
                                            },
                                        ]}
                                        value={wordSource}
                                        onChange={setWordSource}
                                        position="clean"
                                    />
                                    <button type="button" onClick={fillUpRandom} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 rounded-lg font-bold transition-colors whitespace-nowrap shadow-sm h-[42px]">
                                        Fill Up
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
                                            <span className={`italic w-full ${cat ? 'text-white font-medium' : 'text-slate-500'}`}>{cat || 'Empty'}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : categories.length > 0 ? (
                            <ul className="mb-6 space-y-2">
                                {categories.map((cat, i) => (
                                    <li key={`view-list-${i}`} className="bg-slate-700 rounded-lg flex items-center border border-slate-600 italic shadow-sm overflow-hidden h-[42px]">
                                        <span className="break-words py-2 px-3 flex items-center text-white w-full h-full">{cat || <span className="text-slate-400">Empty Slot...</span>}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-center text-slate-500 italic py-6 border-2 border-dashed border-slate-700 rounded-lg">No categories yet. Suggest some categories or wait for the Host to generate them.</div>
                        )}

                    {!isHost && (
                        <div className="flex gap-2 mb-4 mt-6 pt-4 border-t border-slate-700">
                            <input
                                type="text"
                                value={newCategory}
                                onChange={(e) => setNewCategory(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSuggestCategory();
                                }}
                                placeholder="Suggest a category..."
                                className="flex-1 p-3 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none focus:border-indigo-500"
                            />
                            <button type="button" onClick={handleSuggestCategory} className="bg-indigo-600 hover:bg-indigo-500 px-6 rounded-lg font-bold transition-colors">
                                Suggest
                            </button>
                        </div>
                    )}

                    <div className="p-4 bg-slate-800/80 rounded-xl border border-dashed border-indigo-500/50 mt-6">
                        <h4 className="text-xs font-bold text-indigo-400 mb-3 uppercase tracking-wider">Player Suggestions</h4>
                        <ul className="space-y-2">
                            {suggestedCategories.length === 0 ? (
                                <li className="text-slate-500 italic py-2">No suggestions yet</li>
                            ) : (
                                suggestedCategories.map((cat, i) => (
                                    <li key={i} className="bg-slate-700 rounded-lg flex justify-between items-center border border-slate-600 italic shadow-sm overflow-hidden p-1 h-[42px]">
                                        <span className="break-words py-2 px-3 flex items-center text-white">{cat}</span>
                                        {isHost && (
                                            <div className="flex shrink-0 border-l border-slate-600">
                                                <button type="button" onClick={() => acceptSuggestion(cat)} className="text-green-400 hover:text-green-300 px-4 transition-colors border-r border-slate-600 flex items-center justify-center h-[42px]" title="Accept">
                                                    <CiCircleCheck size={30} />
                                                </button>
                                                <button type="button" onClick={() => rejectSuggestion(cat)} className="text-red-400 hover:text-red-300 pl-4 pr-2 transition-colors flex items-center justify-center h-[42px]" title="Reject">
                                                    <CiCircleRemove size={30} />
                                                </button>
                                            </div>
                                        )}
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
}
