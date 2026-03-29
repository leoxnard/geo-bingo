'use client';

import React, { useState, useRef } from 'react';

import toast from 'react-hot-toast';
import { CiCirclePlus, CiCircleMinus, CiCircleRemove, CiCircleCheck } from "react-icons/ci";
import { FaTimes } from "react-icons/fa";

import { ToggleButton, RangeSlider } from '../utils/Elements';
import { shuffle } from '../utils/Functions';

interface LobbyCategoriesProps {
    updateGameModeInfo: (updates: {
        game_mode?: string;
        team_mode?: string;
        grid_size?: number;
        starting_point?: string;
        gameBoundary?: string;
        categories?: string[];
        category_source?: 'manual' | 'generation';
        generation_radius?: number;
        generation_number?: number;
    }) => void;
    isHost: boolean;
    gameMode: 'list' | 'bingo';
    gridSize: number;
    categories: string[];
    suggestedCategories: string[];
    gameId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    maxGridSize: number;
    startingPoint: string;
    categorySource: 'manual' | 'generation';
    generationRadius: number;
    generationNumber: number;
}

export default function LobbyCategories({
    updateGameModeInfo,
    isHost,
    gameMode,
    gridSize,
    categories,
    suggestedCategories,
    gameId,
    supabase,
    maxGridSize,
    startingPoint,
    categorySource,
    generationRadius,
    generationNumber,
}: LobbyCategoriesProps) {
    const [newCategory, setNewCategory] = useState('');
    const [randomLang, setRandomLang] = useState<'german' | 'english'>('german');
    const [randomNumber, setRandomNumber] = useState<number | ''>(4);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const categoryInputRef = useRef<HTMLInputElement>(null);
    const [localRadius, setLocalRadius] = useState(generationRadius);
    const [localGenerationNumber, setLocalGenerationNumber] = useState(generationNumber);
    const [localGridSize, setLocalGridSize] = useState(gridSize);

    const handleCommit = () => {
        if (!isHost) return;
        updateGameModeInfo({ 
            generation_radius: localRadius,
            generation_number: localGenerationNumber,
            grid_size: localGridSize
        });
    };

    const getSidebarTextSizeClass = () => {
        if (gameMode !== 'bingo') return '';
        switch (gridSize) {
        case 2: return 'text-base sm:text-xl';
        case 3: return 'text-xs sm:text-base';
        case 4: return 'text-xs sm:text-sm';
        case 5: return 'text-[10px] sm:text-sm';
        case 6: return 'text-[9px] sm:text-xs';
        default: return 'text-xs sm:text-xl';
        }
    };

    const addCategory = async () => {
        const trimmedCat = newCategory.trim();
        if (trimmedCat !== '' && isHost) {
            if (gameMode === 'bingo' && categories.length >= gridSize * gridSize) {
                toast.error(`Maximal ${gridSize * gridSize} words allowed for this Bingo grid!`);
                return;
            }
            if (categories.some(c => c.toLowerCase() === trimmedCat.toLowerCase())) {
                toast.error("This category already exists!");
                return;
            }
            const updated = [...categories, trimmedCat];
            await updateGameModeInfo({ categories: updated });
            setTimeout(() => categoryInputRef.current?.focus(), 50);
        }
    };

    const removeCategory = async (catToRemove: string) => {
        if (isHost) {
            const updated = categories.filter(c => c !== catToRemove);
            await updateGameModeInfo({ categories: updated });
        }
    };

    const clearCategories = async () => {
        if (isHost) {
            await updateGameModeInfo({ categories: [] });
        }
    };

    const handleSuggestCategory = async () => {
        const trimmedCat = newCategory.trim();
        if (trimmedCat !== '' && !isHost) {
            // Check if it already exists
            if (categories.some(c => c.toLowerCase() === trimmedCat.toLowerCase())) {
                toast.error("This category already exists!");
                return;
            }

            // Fetch latest to prevent race conditions from other players
            const { data } = await supabase.from('games').select('suggested_categories').eq('id', gameId).single();
            const currentSuggestions = data?.suggested_categories || [];

            if (currentSuggestions.some((c: string) => c.toLowerCase() === trimmedCat.toLowerCase())) {
                toast.error("This category was already suggested!");
                return;
            }

            const updatedSuggestions = [...currentSuggestions, trimmedCat];
            await supabase.from('games').update({ suggested_categories: updatedSuggestions }).eq('id', gameId);
            setNewCategory('');
            toast.success("Suggestion sent to the host!");
        }
    };

    const acceptSuggestion = async (cat: string) => {
        if (!isHost) return;
        if (gameMode === 'bingo' && categories.length >= gridSize * gridSize) {
            toast.error(`Maximal ${gridSize * gridSize} words allowed for this Bingo grid!`);
            return;
        }
        const updatedCat = [...categories, cat];
        const updatedSug = suggestedCategories.filter(c => c !== cat);
        await supabase.from('games').update({ categories: updatedCat, suggested_categories: updatedSug }).eq('id', gameId);
    };

    const rejectSuggestion = async (cat: string) => {
        if (!isHost) return;
        const updatedSug = suggestedCategories.filter(c => c !== cat);
        await supabase.from('games').update({ suggested_categories: updatedSug }).eq('id', gameId);
    };

    const addRandomCategories = async () => {
        if (!isHost) return;
        try {
            const { categoriesDe, categoriesEn } = await import('../../lib/categories');
            const allWords = randomLang === 'german' ? categoriesDe : categoriesEn;
            const shuffled = shuffle(allWords);
            const availableWords = shuffled.filter(w => !categories.map(c => c.toLowerCase()).includes(w.toLowerCase()));
            const selectedWords = availableWords.slice(0, Number(randomNumber) || 0);

            if (selectedWords.length > 0) {
                const updated = [...categories, ...selectedWords];
                await updateGameModeInfo({ categories: updated });
            } else {
                toast.error("Not enough new words available!");
            }
        } catch (err) {
            console.error("Error fetching random words", err);
            toast.error("Error loading random words.");
        }
    };

    const minusOneGridSize = () => {
        if (gridSize > 2) {
            updateGameModeInfo({ grid_size: gridSize - 1 });
            setRandomNumber((gridSize - 1) * (gridSize - 1));
        }
    }

    const plusOneGridSize = () => {
        if (gridSize < maxGridSize) {
            updateGameModeInfo({ grid_size: gridSize + 1 });
            setRandomNumber((gridSize + 1) * (gridSize + 1));
        }
    }

    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (!isHost) return;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
        if (!isHost || draggedIndex === null || draggedIndex === targetIndex) return;
        const updated = [...categories];
        const [draggedItem] = updated.splice(draggedIndex, 1);
        updated.splice(targetIndex, 0, draggedItem);
        setDraggedIndex(null);
        await updateGameModeInfo({ categories: updated });
    };

    return (
        <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            {/* Category Source Selection (Only visible if starting point is set) */}
            <ToggleButton
                active={categorySource === 'manual' ? 'left' : 'right'}
                labelLeft="Manual"
                labelRight="Generation (AI)"
                onClick={(val: 'left' | 'right') => updateGameModeInfo({ category_source: val === 'left' ? 'manual' : 'generation' })}
                disabled={!isHost || startingPoint === 'open-world'}
                title="Category Source"
                isHost={isHost}
                position="top"
                description={startingPoint === 'open-world'
                    ? 'Set a starting point to unlock category options.'
                    : categorySource === 'manual'
                        ? 'Players submit categories manually.'
                        : 'Categories will be auto-generated by AI based on your starting location. They remain hidden until the game starts!'}
            />


            {/* Radius Slider for Generation */}
            {categorySource === 'generation' && (
                <>
                    {gameMode === 'list' ? (
                        <RangeSlider
                            title="Number of Categories"
                            min={1}
                            max={25}
                            value={localGenerationNumber}
                            disabled={!isHost}
                            onChange={(val) => setLocalGenerationNumber(val)}
                            onCommit={handleCommit}
                        />
                    ) :
                        <RangeSlider
                            title="Grid Size"
                            min={1}
                            max={6}
                            value={localGridSize}
                            disabled={!isHost}
                            onChange={(val) => setLocalGridSize(val)}
                            onCommit={handleCommit}
                        />
                    }
                    <RangeSlider
                        title="POI Radius"
                        min={1}
                        max={100}
                        minLabel="100m"
                        maxLabel="10km"
                        value={localRadius}
                        disabled={!isHost}
                        displayValue={localRadius >= 10 
                            ? `${(localRadius / 10).toFixed(1)} km` 
                            : `${localRadius * 100} m`
                        }
                        onChange={(val) => setLocalRadius(val)}
                        onCommit={handleCommit}
                        position='bottom'
                        description="Only POIs within this radius from the starting point will be considered for category generation."
                    />
                </>
            )}

            {/* Manual Categories */}
            {categorySource === 'manual' && (
                <>
                    <h3 className={`text-xl font-bold mb-2 text-slate-300 flex justify-between items-center transition-all pt-2 border-t border-slate-700`}>
                        <span>Categories</span>
                        <div className="flex mb-2 items-center">
                            <span className={`text-sm font-normal ${categories.length === 0 || (gameMode === 'bingo' && categories.length < gridSize * gridSize) ? 'text-red-400' : 'text-slate-400'} bg-slate-900 px-3 py-1 rounded-full`}>
                                {gameMode === 'bingo'
                                    ? `${Math.min(categories.length, gridSize * gridSize)} / ${gridSize * gridSize}` 
                                    : `${categories.length} Words`}
                            </span>
                            {isHost && (
                                <button type="button" onClick={clearCategories} className="text-xs font-bold text-slate-400 bg-slate-800 hover:bg-slate-700 hover:text-white px-3 py-1 rounded-full ml-1">
                                    Clear
                                </button>
                            )}
                        </div>
                    </h3>

                    {gameMode === 'bingo' ? (
                        <>
                            {isHost && (
                                <div className={`grid grid-cols-2 gap-3 mb-3 min-h-[60px] break-all transition-all`}>
                                    <button
                                        type="button"
                                        onClick={minusOneGridSize}
                                        disabled={gridSize <= 2}
                                        className="relative flex items-center justify-center p-2 rounded-lg border border-dashed text-center text-indigo-400 border-indigo-700 disabled:border-slate-600 disabled:text-slate-500 disabled:bg-slate-800 hover:bg-slate-700/20"
                                        title="Reduce grid size"
                                        aria-label=""
                                    >
                                        <span className="text-lg leading-none">
                                            <CiCircleMinus/>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={plusOneGridSize}
                                        disabled={gridSize >= maxGridSize}
                                        className="relative flex items-center justify-center p-2 rounded-lg border border-dashed text-center text-indigo-400 border-indigo-700 disabled:border-slate-600 disabled:text-slate-500 disabled:bg-slate-800 hover:bg-slate-700/20"
                                        title="Increase grid size"
                                        aria-label="Increase grid size"
                                    >
                                        <span className="text-lg leading-none">
                                            <CiCirclePlus />
                                        </span>
                                    </button>
                                </div>
                            )}
                            <div className={`grid gap-3 mb-6 bingo-grid-${gridSize}`}>
                                {Array.from({ length: Math.max(gridSize * gridSize, categories.length) }).map((_, i) => {
                                    const cat = categories[i];
                                    if (i >= gridSize * gridSize) return null;
                                    return (
                                        <div 
                                            key={i}
                                            draggable={isHost && !!cat}
                                            onDragStart={(e) => handleDragStart(e, i)}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleDrop(e, i)}
                                            className={`relative flex items-center justify-center p-2 rounded-lg border text-center ${getSidebarTextSizeClass()} min-h-[60px] [hyphens:auto] break-words transition-all
                                            ${cat ? 'bg-slate-700 border-slate-600' : 'bg-slate-800/50 border-dashed border-slate-600/50 text-slate-500'}
                                            ${isHost && cat ? 'cursor-grab active:cursor-grabbing hover:bg-slate-600' : ''}
                                            ${draggedIndex === i ? 'opacity-50 scale-95 border-indigo-500' : ''}
                                            `}
                                        >
                                            {cat ? (
                                                <>
                                                    <span className="italic">{cat}</span>
                                                    {isHost && (
                                                        <button type="button" title='remove_cat_btn' onClick={() => removeCategory(cat)} className="absolute top-1 right-1 text-red-400 hover:text-red-300 p-0.5 rounded-full bg-slate-800">
                                                            <FaTimes />
                                                        </button>
                                                    )}
                                                </>
                                            ) : <span>Empty</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <ul className="mb-4 space-y-2">
                            {categories.map((cat, i) => ( 
                                <li key={i} className="bg-slate-700 p-2 pl-3 rounded-lg flex justify-between items-center border border-slate-600 shadow-sm overflow-hidden italic h-[42px]">
                                    <span>{cat}</span>
                                    {isHost && (
                                        <button 
                                            type="button" 
                                            onClick={() => removeCategory(cat)} 
                                            className="text-red-400 hover:text-red-300 pl-4 pr-2 transition-colors border-l border-slate-600 flex items-center justify-center h-[42px]" 
                                            title="Reject"
                                        >
                                            <CiCircleRemove size={30} />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {/* --- Category Suggestions --- */}
                    <div className="flex gap-2 mb-4 mt-6">
                        <input 
                            ref={categoryInputRef}
                            type="text" 
                            value={newCategory} 
                            onChange={(e) => setNewCategory(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    if (isHost) {
                                        addCategory();
                                    } else {
                                        handleSuggestCategory();
                                    }
                                }
                            }}
                            placeholder={isHost ? "Custom category..." : "Suggest a category..."}
                            className="flex-1 p-3 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none focus:border-indigo-500"
                        />
                        <button 
                            type="button" 
                            onClick={isHost ? addCategory : handleSuggestCategory} 
                            className="bg-indigo-600 hover:bg-indigo-500 px-6 rounded-lg font-bold transition-colors"
                        >
                            {isHost ? "Add" : "Suggest"}
                        </button>
                    </div>

                    {/* --- HOST ONLY: SUGGESTIONS & RANDOM --- */}
                    {isHost && (
                        <div className="space-y-4">
                            {/* Random Generator */}
                            <div className="bg-slate-800/80 p-4 rounded-xl border border-dashed border-indigo-500/50">
                                <h4 className="text-xs font-bold text-indigo-400 mb-3 uppercase tracking-wider">
                                    Random Categories
                                </h4>
                                <div className='flex gap-3 items-end'>
                                    {/* Part 1: Number */}
                                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                                        <label className="text-[10px] uppercase text-slate-400 font-bold truncate">Number</label>
                                        <input
                                            title='random_number_ipt'
                                            type="number" value={randomNumber}
                                            onChange={e => setRandomNumber(e.target.value === '' ? '' : Number(e.target.value))}
                                            className="h-[42px] w-full rounded-lg bg-slate-900 border border-slate-600 text-white text-center font-bold overflow-hidden" />
                                    </div>
                                    {/* Part 2: Language */}
                                    <div className="flex flex-col gap-1 flex-[2] min-w-0">
                                        <label className="text-[10px] uppercase text-slate-400 font-bold">
                                            Language
                                        </label>
                                        <select title='random_lan_ipt' value={randomLang} onChange={e => setRandomLang(e.target.value as 'german' | 'english')} className="h-[42px] px-2 w-full rounded-lg bg-slate-900 border border-slate-600 text-white font-bold cursor-pointer">
                                            <option value="german">German</option>
                                            <option value="english">English</option>
                                        </select>
                                    </div>
                                    {/* Part 3: Button */}
                                    <button type="button" onClick={addRandomCategories} className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold h-[42px] whitespace-nowrap">Add Random</button>
                                </div>
                            </div>
                            {/* Suggested Categories List */}
                            {suggestedCategories.length > 0 && (
                                <div className="p-4 bg-slate-800/80 rounded-xl border border-dashed border-indigo-500/50">
                                    <h4 className="text-xs font-bold text-indigo-400 mb-3 uppercase tracking-wider">
                                        Player Suggestions
                                    </h4>
                                    <ul className="space-y-2">
                                        {suggestedCategories.map((cat, i) => (
                                            <li key={i} className="bg-slate-700 rounded-lg flex justify-between items-center border border-slate-600 italic shadow-sm overflow-hidden p-1 h-[42px]">
                                                <span className="break-words py-2 px-3 flex items-center">{cat}</span>
                                                <div className="flex shrink-0 border-l border-slate-600">
                                                    <button 
                                                        type="button" 
                                                        onClick={() => acceptSuggestion(cat)} 
                                                        className="text-green-400 hover:text-green-300 px-4 transition-colors border-r border-slate-600 flex items-center justify-center h-[42px]" 
                                                        title="Accept"
                                                    >
                                                        <CiCircleCheck size={30} />
                                                    </button>
                                                    <button 
                                                        type="button" 
                                                        onClick={() => rejectSuggestion(cat)} 
                                                        className="text-red-400 hover:text-red-300 pl-4 pr-2 transition-colors flex items-center justify-center" 
                                                        title="Reject"
                                                    >
                                                        <CiCircleRemove size={30} />
                                                    </button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}