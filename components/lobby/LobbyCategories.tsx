'use client';

import React, { useState, useRef } from 'react';
import { FaTimes } from "react-icons/fa";
import { shuffle } from '../utils/Functions';

interface LobbyCategoriesProps {
    isHost: boolean;
    gameMode: 'list' | 'bingo';
    gridSize: number;
    bingoBoardMode: 'shared' | 'individual';
    categories: string[];
    gameId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    showToast: (message: string) => void;
}

export default function LobbyCategories({
    isHost,
    gameMode,
    gridSize,
    bingoBoardMode,
    categories,
    gameId,
    supabase,
    showToast
}: LobbyCategoriesProps) {
    const [newCategory, setNewCategory] = useState('');
    const [randomLang, setRandomLang] = useState<'german' | 'english'>('german');
    const [randomCount, setRandomCount] = useState<number | ''>(4);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const categoryInputRef = useRef<HTMLInputElement>(null);

    const getSidebarTextSizeClass = () => {
        if (gameMode !== 'bingo') return '';
        switch (gridSize) {
        case 2: return 'text-base sm:text-xl';
        case 3: return 'text-xs sm:text-xl';
        case 4: return 'text-xs sm:text-base';
        case 5: return 'text-[10px] sm:text-sm';
        default: return 'text-xs sm:text-xl';
        }
    };

    const addCategory = async () => {
        const trimmedCat = newCategory.trim();
        if (trimmedCat !== '' && isHost) {
            if (gameMode === 'bingo' && categories.length >= gridSize * gridSize) {
                showToast(`Maximal ${gridSize * gridSize} words allowed for this Bingo grid!`);
                return;
            }
            if (categories.some(c => c.toLowerCase() === trimmedCat.toLowerCase())) {
                showToast("This category already exists!");
                return;
            }
            const updated = [...categories, trimmedCat];
            await supabase.from('games').update({ categories: updated }).eq('id', gameId);
            setNewCategory('');
            setTimeout(() => categoryInputRef.current?.focus(), 50);
        }
    };

    const removeCategory = async (catToRemove: string) => {
        if (isHost) {
            const updated = categories.filter(c => c !== catToRemove);
            await supabase.from('games').update({ categories: updated }).eq('id', gameId);
        }
    };

    const clearCategories = async () => {
        if (isHost) {
            await supabase.from('games').update({ categories: [] }).eq('id', gameId);
        }
    };

    const addRandomCategories = async () => {
        if (!isHost) return;
        try {
            const { categoriesDe, categoriesEn } = await import('../../lib/categories');
            const allWords = randomLang === 'german' ? categoriesDe : categoriesEn;
            const shuffled = shuffle(allWords);
            const availableWords = shuffled.filter(w => !categories.map(c => c.toLowerCase()).includes(w.toLowerCase()));
            const selectedWords = availableWords.slice(0, Number(randomCount) || 0);

            if (selectedWords.length > 0) {
                const updated = [...categories, ...selectedWords];
                await supabase.from('games').update({ categories: updated }).eq('id', gameId);
            } else {
                showToast("Not enough new words available!");
            }
        } catch (err) {
            console.error("Error fetching random words", err);
            showToast("Error loading random words.");
        }
    };

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
        await supabase.from('games').update({ categories: updated }).eq('id', gameId);
    };

    return (
        <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            <h3 className="text-xl font-bold mb-2 text-slate-300 flex justify-between items-center">
                <span>Categories</span>
                <div className="flex mb-2 items-center">
                    <span className={`text-sm font-normal ${categories.length === 0 || (gameMode === 'bingo' && categories.length < gridSize * gridSize) ? 'text-red-400' : 'text-slate-400'} bg-slate-900 px-3 py-1 rounded-full`}>
                        {gameMode === 'bingo' && bingoBoardMode === 'shared' 
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

            {gameMode === 'bingo' && bingoBoardMode === 'shared' ? (
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
                                className={`relative flex items-center justify-center p-2 rounded-lg border text-center ${getSidebarTextSizeClass()} min-h-[60px] break-all transition-all
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
            ) : (
                <ul className="mb-4 space-y-2">
                    {categories.map((cat, i) => (
                        <li key={i} className="bg-slate-700 p-3 rounded-lg flex justify-between items-center border border-slate-600 italic">
                            <span>{cat}</span>
                            {isHost && (
                                <button type="button" title='remove_cat_btn' onClick={() => removeCategory(cat)} className="text-red-400 hover:text-red-300 p-2 rounded-full bg-slate-800">
                                    <FaTimes />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {isHost && (
                <div className="space-y-4">
                    <div className="flex gap-2 mb-4">
                        <input 
                            ref={categoryInputRef}
                            type="text" 
                            value={newCategory} 
                            onChange={(e) => setNewCategory(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                            placeholder="Custom category..."
                            className="flex-1 p-3 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none focus:border-indigo-500"
                        />
                        <button type="button" onClick={addCategory} className="bg-indigo-600 hover:bg-indigo-500 px-6 rounded-lg font-bold">
                            Add
                        </button>
                    </div>
                    <div className="flex gap-3 bg-slate-700/40 p-4 rounded-xl border border-slate-600 items-end">
                        {/* Part 1: Count (Relative 1) */}
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                            <label className="text-[10px] uppercase text-slate-400 font-bold truncate">
                                Count
                            </label>
                            <input 
                                title='random_count_ipt'
                                type="number" 
                                value={randomCount} 
                                onChange={e => setRandomCount(e.target.value === '' ? '' : Number(e.target.value))}
                                className="h-[42px] w-full rounded-lg bg-slate-900 border border-slate-600 text-white text-center font-bold"
                            />
                        </div>

                        {/* Part 2: Language (Relative 2) */}
                        <div className="flex flex-col gap-1 flex-[2] min-w-0">
                            <label className="text-[10px] uppercase text-slate-400 font-bold">
                                Language
                            </label>
                            <select 
                                title='random_lan_ipt'
                                value={randomLang} 
                                onChange={e => setRandomLang(e.target.value as 'german' | 'english')}
                                className="h-[42px] px-2 w-full rounded-lg bg-slate-900 border border-slate-600 text-white font-bold cursor-pointer"
                            >
                                <option value="german">German</option>
                                <option value="english">English</option>
                            </select>
                        </div>

                        {/* Part 3: Button (Relative 2) */}
                        <button 
                            type="button" 
                            onClick={addRandomCategories} 
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold h-[42px] whitespace-nowrap"
                        >
                            Add Random
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}