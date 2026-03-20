import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { FaRegCopy, FaCopy, FaTimes, FaRegEdit } from "react-icons/fa";

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
}

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

interface LobbyViewProps {
    renderToast: () => React.ReactNode;
    gameMode: 'list' | 'bingo';
    updateGameModeInfo: (updates: { game_mode?: string; grid_size?: number; bingo_target?: number }) => void;
    isHost: boolean;
    gridSize: number;
    bingoTarget: number;
    timeLimit: number;
    updateTimeLimit: (minutes: number) => void;
    categories: string[];
    gameId: string;
    players: Player[];
    onlinePlayers: string[];
    playerId: string;
    gameHostId: string;
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    showToast : (message: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    updateStatus: (nextStatus: GameStatus) => Promise<void>;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
}

const shuffle = <T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

export default function LobbyView({
    renderToast, gameMode, isHost, gridSize, bingoTarget, updateGameModeInfo,
    timeLimit, updateTimeLimit, categories,
    gameId, players, onlinePlayers,
    playerId, gameHostId,
    makeHost, kickPlayer, banPlayer, showToast, router, supabase, updateStatus, setPlayers
}: LobbyViewProps) {

    const [bingoBoardMode, setBingoBoardMode] = useState<'shared' | 'individual'>('shared');
    const [newCategory, setNewCategory] = useState('');
    const [randomLang, setRandomLang] = useState<'german' | 'english'>('german');
    const [randomCount, setRandomCount] = useState<number | ''>(4);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    
    const categoryInputRef = useRef<HTMLInputElement>(null);
    const [copied, setCopied] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [currentLink, setCurrentLink] = useState('');

    const [isEditingSelfName, setIsEditingSelfName] = useState(false);
    const [selfNameInput, setSelfNameInput] = useState('');
    const selfNameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setCurrentLink(window.location.href);
    }, []);

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

    const handleCopyGameId = () => {
        navigator.clipboard.writeText(gameId);
        setCopied(true);
        setTimeout(() => setCopied(false), 800);
    };

    const handleCopyGameLink = () => {
        navigator.clipboard.writeText(currentLink);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 800);
    };

    const handleLeaveLobby = () => {
        localStorage.setItem('geoBingoLastLobbyId', gameId);
        router.push('/');
    };

    const addRandomCategories = async () => {
        if (!isHost) return;
        try {
            const { categoriesDe, categoriesEn } = await import('../lib/categories');
            const allWords = randomLang === 'german' ? categoriesDe : categoriesEn;
        
            // Shuffle array
            const shuffled = [...allWords].sort(() => 0.5 - Math.random());
        
            // Pick top N words that are not already in categories
            let count = Number(randomCount) || 1; // Default to 1 if empty
        
            if (gameMode === 'bingo') {
                const remaining = (gridSize * gridSize) - categories.length;
                if (remaining <= 0) {
                    showToast(`Maximal ${gridSize * gridSize} words allowed for this Bingo grid!`);
                    return;
                }
                if (count > remaining) count = remaining;
            }

            const availableWords = shuffled.filter(w => !categories.map(c => c.toLowerCase()).includes(w.toLowerCase()));
            const selectedWords = availableWords.slice(0, count);

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
        
            // Fokus zurück ins Eingabefeld setzen
            setTimeout(() => {
                categoryInputRef.current?.focus();
            }, 50);
        }
    };

    const removeCategory = async (catToRemove: string) => {
        if (isHost && categories.length > 0) {
            const updated = categories.filter(c => c !== catToRemove);
            await supabase.from('games').update({ categories: updated }).eq('id', gameId);
        }
    };

    const clearCategories = async () => {
        if (isHost) {
            await supabase.from('games').update({ categories: [] }).eq('id', gameId);
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (!isHost) return;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!isHost) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
        if (!isHost) return;
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === targetIndex) return;
    
        const updated = [...categories];
        // Wenn das Ziel-Element außerhalb der Liste ist, ignoriere es
        if (draggedIndex >= updated.length) return;

        if (targetIndex >= updated.length) {
            // If you drag to an empty field (only relevant in Bingo Grid)
            // then simply append the element to the end of the existing words.
            const [draggedItem] = updated.splice(draggedIndex, 1);
            updated.push(draggedItem);
        } else {
            // Swappen / Vertauschen der Elemente wenn beide existieren
            const temp = updated[draggedIndex];
            updated[draggedIndex] = updated[targetIndex];
            updated[targetIndex] = temp;
        }
    
        setDraggedIndex(null);
        await supabase.from('games').update({ categories: updated }).eq('id', gameId);
    };

    useEffect(() => {
        const currentName = players.find((p) => p.id === playerId)?.name;
        if (!isEditingSelfName && currentName) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelfNameInput(currentName);
        }
    }, [players, playerId, isEditingSelfName]);

    useEffect(() => {
        if (isEditingSelfName) {
            selfNameInputRef.current?.focus();
            selfNameInputRef.current?.select();
        }
    }, [isEditingSelfName]);

    const saveSelfName = async () => {
        if (!playerId) return;

        const currentName = players.find((p) => p.id === playerId)?.name || localStorage.getItem('geoBingoPlayerName') || '';
        const nextName = selfNameInput.trim();

        if (!nextName) {
            setSelfNameInput(currentName);
            setIsEditingSelfName(false);
            return;
        }

        if (nextName === currentName) {
            setIsEditingSelfName(false);
            return;
        }

        localStorage.setItem('geoBingoPlayerName', nextName);
        setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, name: nextName } : p)));

        const { error } = await supabase.from('players').update({ name: nextName }).eq('id', playerId);
        if (error) {
            showToast('Could not update name. Please try again.');
            return;
        }

        setIsEditingSelfName(false);
        showToast('Name updated.');
    };

    const handleRenameSelf = async () => {
        if (!playerId) return;

        if (!isEditingSelfName) {
            const currentName = players.find((p) => p.id === playerId)?.name || localStorage.getItem('geoBingoPlayerName') || '';
            setSelfNameInput(currentName);
            setIsEditingSelfName(true);
            return;
        }

        await saveSelfName();
    };

    const handleStartGame = async () => {
        if (categories.length === 0) {
            showToast('Please add at least one category to start the game.');
            return;
        }

        const generateBoards = async (neededCount: number): Promise<boolean> => {
            try {
                // Option 1: Everyone gets the same board in the same order
                if (bingoBoardMode === 'shared') {
                    const board = categories.slice(0, neededCount);
                    const { error } = await supabase
                        .from('players')
                        .update({ bingo_board: board })
                        .eq('game_id', gameId);
                    
                    if (error) throw error;
                } 
                
                // Option 2: Everyone different order and different words
                else if (bingoBoardMode === 'individual') {
                    const { data: playersData, error: fetchError } = await supabase
                        .from('players')
                        .select('id')
                        .eq('game_id', gameId);

                    if (fetchError || !playersData) throw fetchError;

                    const promises = playersData.map((player: { id: string }) => {
                        const individualBoard = shuffle([...categories]).slice(0, neededCount);

                        return supabase
                            .from('players')
                            .update({ bingo_board: individualBoard })
                            .eq('id', player.id);
                    });

                    const results = await Promise.all(promises);
                    
                    const firstError = results.find(r => r.error);
                    if (firstError) throw firstError.error;
                }

                return true;
            } catch (err) {
                console.error("Board generation failed:", err);
                return false;
            }
        };

        if (gameMode === 'bingo') {
            const neededCount = gridSize * gridSize;
            if (categories.length < neededCount) {
                showToast(`Please add at least ${neededCount} categories (current: ${categories.length}).`);
                return;
            }
            const success = await generateBoards(neededCount);
            if (!success) return; 
        }
        updateStatus('playing');
    };


    return (
        <div className="min-h-screen flex flex-col items-center p-10 bg-slate-900 text-white relative">
            {renderToast()}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 hidden sm:flex">
                <Image 
                    src="/mappin.and.ellipse.png"
                    alt="Geo Bingo Logo"
                    loading="eager"
                    width={60}
                    height={60}
                    className={"w-auto h-auto drop-shadow-[0_0_15px_rgba(96,165,250,0.5)] transform-gpu transition-transform"}
                />
                <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">GEO BINGO</h1>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
      
                {/* Settings (Categories, Time) */}
                <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
                    <h2 className="text-xl font-semibold mb-4 text-slate-300">Settings</h2>
        
                    {/* Game Mode Selection */}
                    <div className="mb-2 flex bg-slate-900 rounded-lg p-1">
                        <button 
                            onClick={() => updateGameModeInfo({ game_mode: 'list' })}
                            disabled={!isHost}
                            className={`flex-1 py-2 rounded-md font-bold transition-all ${gameMode === 'list' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                        >
                            List
                        </button>
                        <button 
                            onClick={() => updateGameModeInfo({ game_mode: 'bingo' })}
                            disabled={!isHost}
                            className={`flex-1 py-2 rounded-md font-bold transition-all ${gameMode === 'bingo' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                        >
                            Bingo Grid
                        </button>
                    </div>

                    {gameMode === 'list' && (
                        // add description for list mode
                        <p className="mb-6 p-2 pt-0 rounded-lg text-sm text-slate-400">
                            In List mode, players will see a simple list of categories. The game ends when the timer runs out or all players vote to end. Great for quick sessions and smaller groups!
                        </p>
                    )}

                    {gameMode === 'bingo' && (
                        // add description for bingo mode
                        <p className="mb-6 p-2 pt-0 rounded-lg text-sm text-slate-400">
                            In Bingo Grid mode, players receive a grid of categories. Players recieve extra points for completing rows or columns of a length defined by the host. The game ends when the timer runs out or all players vote to end. Perfect for longer sessions and adds a fun strategic layer!
                        </p>
                    )}

                    {gameMode === 'bingo' && (
                        <div className="mb-6 p-4 bg-slate-900 rounded-lg flex flex-col gap-4">
                            <div>
                                <label htmlFor="grid-size-range" className="flex justify-between font-bold mb-2 text-sm cursor-pointer">
                                    <span>Grid Size ({gridSize}x{gridSize})</span>
                                </label>
                                <input 
                                    id="grid-size-range"
                                    title="Adjust the grid size"
                                    type="range" min="2" max="5" step="1" value={gridSize} disabled={!isHost} 
                                    onChange={(e) => updateGameModeInfo({ grid_size: parseInt(e.target.value) })}
                                    className="w-full accent-indigo-500" 
                                />
                            </div>
                            <div>
                                <label htmlFor="bingo-target-range" className="flex justify-between font-bold mb-2 text-sm cursor-pointer">
                                    <span>Bingo Length ({bingoTarget})</span>
                                </label>
                                <input 
                                    id="bingo-target-range"
                                    title="Adjust the required length for a Bingo"
                                    type="range" min="2" max={gridSize} step="1" value={bingoTarget} disabled={!isHost}
                                    onChange={(e) => updateGameModeInfo({ bingo_target: parseInt(e.target.value) })}
                                    className="w-full accent-indigo-500" 
                                />
                            </div>
                            <div>
                                <label className="flex justify-between font-bold mb-2 text-sm">
                                    <span>Bingo Board Mode</span>
                                </label>
                                <div className="flex bg-slate-900 rounded-lg p-1">
                                    <button 
                                        onClick={() => setBingoBoardMode('shared')}
                                        disabled={!isHost}
                                        className={`flex-1 py-2 text-sm rounded-md font-bold transition-all ${bingoBoardMode === 'shared' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Shared
                                    </button>
                                    <button 
                                        onClick={() => setBingoBoardMode('individual')}
                                        disabled={!isHost}
                                        className={`flex-1 py-2 text-sm rounded-md font-bold transition-all ${bingoBoardMode === 'individual' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Individual
                                    </button>
                                </div>
                                <p className="mt-2 text-xs text-slate-400 text-center min-h-[16px]">
                                    {bingoBoardMode === 'shared' && 'Same board for all players.'}
                                    {bingoBoardMode === 'individual' && 'Different words and positions for each player.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Time Slider with proper Accessibility */}
                    <div className="mb-8 p-4 bg-slate-900 rounded-lg">
                        <label htmlFor="time-limit-range" className="flex justify-between font-bold mb-2 cursor-pointer">
                            <span>Time Limit</span>
                            <span className="text-indigo-400">{timeLimit / 60} Minutes</span>
                        </label>
                        <input 
                            id="time-limit-range"
                            type="range" min="1" max="15" step="1"
                            value={timeLimit / 60}
                            disabled={!isHost}
                            onChange={(e) => updateTimeLimit(parseInt(e.target.value))}
                            className="w-full cursor-pointer accent-indigo-500"
                            title="Adjust the game time limit in minutes"
                        />
                        {!isHost && <p className="text-xs text-slate-500 mt-2 italic">Only the host can adjust the time limit.</p>}
                    </div>

                    <h3 className="text-xl font-bold mb-2 text-slate-300 flex justify-between items-center">
                        <span>Categories</span>
                        <div className="flex gap-2 items-center">
                            <span className={`text-sm font-normal ${categories.length === 0 || (gameMode === 'bingo' && categories.length < gridSize * gridSize) ? 'text-red-400' : 'text-slate-400'} bg-slate-900 px-3 py-1 rounded-full`}>
                                {gameMode === 'bingo' && bingoBoardMode === 'shared' ? `${Math.min(categories.length, gridSize * gridSize)} / ${gridSize * gridSize}` : `${categories.length} Words`}
                            </span>
                            {isHost && (
                                <button 
                                    onClick={clearCategories}
                                    className="text-xs font-bold text-slate-400 bg-slate-800 hover:bg-slate-700 hover:text-white px-3 py-1 rounded-full ml-1"
                                    title="Clear all categories"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </h3>

                    {gameMode === 'bingo' && bingoBoardMode === 'shared' ? (
                        <div 
                            className={`grid gap-3 mb-6 bingo-grid-${gridSize}`}
                        >
                            {Array.from({ length: Math.max(gridSize * gridSize, categories.length) }).map((_, i) => {
                                const cat = categories[i];
                                const isDragging = draggedIndex === i;
                                return (
                                    <div 
                                        key={i} 
                                        className={`relative flex items-center justify-center p-2 rounded-lg border text-center ${getSidebarTextSizeClass()} min-h-[60px] [hyphens:auto] [hyphenate-character:'-'] break-all  transition-all
                    ${cat ? 'bg-slate-700 border-slate-600' : 'bg-slate-800/50 border-dashed border-slate-600/50 text-slate-500'}
                    ${isHost && cat ? 'cursor-grab active:cursor-grabbing hover:bg-slate-600' : ''}
                    ${isHost && !cat ? 'cursor-default' : ''}
                    ${isDragging ? 'opacity-50 scale-95 border-indigo-500' : ''}
                    ${i >= gridSize * gridSize ? 'hidden' : ''}
                  `}
                                        draggable={isHost && !!cat}
                                        onDragStart={(e) => handleDragStart(e, i)}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, i)}
                                    >
                                        {cat ? (
                                            <>
                                                <span className="italic">{cat}</span>
                                                {isHost && (
                                                    <button 
                                                        onClick={() => removeCategory(cat)} 
                                                        className="absolute top-1 right-1 text-red-400 hover:text-red-300 font-bold p-0.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-opacity"
                                                        title="Remove word"
                                                    >
                                                        <FaTimes />
                                                    </button>
                                                )}
                                            </>
                                        ) : (
                                            <span>Empty</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <ul className="mb-4 space-y-2">
                            {categories.map((cat, i) => {
                                return (
                                    <li 
                                        key={i} 
                                        className={`bg-slate-700 p-3 rounded-lg flex justify-between items-center border border-slate-600 italic transition-all
                  `}
                                    >
                                        <span>{cat}</span>
                                        {isHost && (
                                            <button onClick={() => removeCategory(cat)} className="text-red-400 hover:text-red-300 font-bold rounded-full bg-slate-800 hover:bg-slate-700 p-2" title="Remove word">
                                                <FaTimes />
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {isHost && (
                        <>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    ref={categoryInputRef}
                                    value={newCategory} 
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            addCategory();
                                        }
                                    }}
                                    placeholder="Custom category..."
                                    className="flex-1 p-3 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none focus:border-indigo-500"
                                />
                                <button onClick={addCategory} className="bg-indigo-600 hover:bg-indigo-500 px-6 rounded-lg font-bold">Add</button>
                            </div>
            
                            <div className="flex gap-3 mt-4 bg-slate-700/40 p-4 rounded-xl border border-slate-600">
                                <div className="flex flex-col gap-1 w-13">
                                    <label htmlFor="random-count" className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Count</label>
                                    <input 
                                        id="random-count"
                                        type="text" 
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={randomCount} 
                                        onChange={e => {
                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                            if (val === '') setRandomCount('');
                                            else setRandomCount(Number(val));
                                        }}
                                        className="h-[42px] px-2 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none text-center font-bold"
                                        title="Number of random words"
                                    />
                                </div>
                                <div className="flex flex-col gap-1 flex-1">
                                    <label htmlFor="random-lang" className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Language</label>
                                    <select 
                                        id="random-lang"
                                        value={randomLang} 
                                        onChange={e => setRandomLang(e.target.value as 'german' | 'english')}
                                        className="h-[42px] px-2 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none font-bold cursor-pointer"
                                        title="Language for random words"
                                    >
                                        <option value="german">German</option>
                                        <option value="english">English</option>
                                    </select>
                                </div>
                                <div className="flex flex-col justify-end">
                                    <button 
                                        onClick={addRandomCategories} 
                                        className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg font-bold h-[42px] whitespace-nowrap shadow-md transition-all tracking-wider"
                                    >
                                        <span className="hidden sm:inline">Add Random</span>
                                        <span className="sm:hidden">+</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex flex-col gap-6 w-full lg:w-80">
                    {/* Invite Box */}
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 h-fit">
                        <h2 className="text-xl font-semibold mb-4 text-slate-300">Invite Friends</h2>
          
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg">
                                <span className="text-sm font-bold text-slate-400 w-12 tracking-widest">ID:</span>
                                <span className="flex-1 font-mono text-slate-300 text-lg">{gameId}</span>
                                <button 
                                    onClick={handleCopyGameId}
                                    className={`
                  p-2 rounded-md outline-none
                  transition-all duration-300 ease-in-out
                  ${copied ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}
                `}
                                    title="Copy Code"
                                >
                                    {copied ? <FaCopy /> : <FaRegCopy />}
                                </button>
                            </div>
            
                            <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg">
                                <span className="text-sm font-bold text-slate-400 w-12 tracking-widest">Link:</span>
                                <span className="flex-1 font-mono text-slate-300 truncate">{currentLink || '...'}</span>
                                <button 
                                    onClick={handleCopyGameLink}
                                    className={`
                  p-2 rounded-md outline-none
                  transition-all duration-300 ease-in-out
                  ${copiedLink ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}
                `}
                                    title="Copy Link"
                                >
                                    {copiedLink ? <FaCopy /> : <FaRegCopy />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Player List */}
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 h-fit">
                        <h2 className="text-xl font-semibold mb-4 text-slate-300">Players ({players.length})</h2>
                        <ul className="space-y-3">
                            {players.map(p => (
                                <li key={p.id} className="flex flex-col gap-2 bg-slate-900 p-3 rounded-lg border border-slate-700">
                                    <div className="flex items-center gap-3">
                                        <div 
                                            className={`min-w-[8px] h-2 rounded-full animate-pulse ${onlinePlayers.includes(p.id) ? 'bg-green-500' : 'bg-orange-500'}`}
                                            title={onlinePlayers.includes(p.id) ? 'Online' : 'Verbindung verloren'}
                                        ></div>
                                        <div className="flex-1 min-w-0 flex items-center gap-2">
                                            {p.id === playerId ? (
                                                <>
                                                    {isEditingSelfName ? (
                                                        <>
                                                            <input
                                                                ref={selfNameInputRef as React.RefObject<HTMLInputElement>}
                                                                type="text"
                                                                value={selfNameInput}
                                                                onChange={(e) => setSelfNameInput(e.target.value)}
                                                                readOnly={!isEditingSelfName}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        void saveSelfName();
                                                                    }
                                                                    if (e.key === 'Escape') {
                                                                        setSelfNameInput(p.name);
                                                                        setIsEditingSelfName(false);
                                                                    }
                                                                }}
                                                                onBlur={() => {
                                                                    if (isEditingSelfName) {
                                                                        void saveSelfName();
                                                                    }
                                                                }}
                                                                className="flex-1 min-w-0 truncate bg-transparent border-b border-indigo-400 text-white outline-none"
                                                                title="Your player name"
                                                            />
                                                        </>
                                                    ) : (
                                                        <span className="flex-1 truncate text-green-400">
                                                            {p.name} {p.id === gameHostId ? '(Host)' : ''}
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="flex-1 truncate text-white">
                                                    {p.name} {p.id === gameHostId ? '(Host)' : ''}
                                                </span>
                                            )}
                                            {p.id === playerId && (
                                                <button
                                                    type="button"
                                                    onClick={handleRenameSelf}
                                                    className="text-slate-400 hover:text-white transition-colors p-1 rounded"
                                                    title={isEditingSelfName ? 'Save name' : 'Edit name'}
                                                >
                                                    <FaRegEdit className="text-xs" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {isHost && p.id !== playerId && (
                                        <div className="flex gap-2 w-full mt-1 border-t border-slate-800 pt-2">
                                            <button 
                                                onClick={() => makeHost(p.id)} 
                                                className="text-xs flex-[2] justify-center bg-indigo-900/50 text-indigo-400 hover:bg-indigo-600 hover:text-white px-3 py-2 sm:py-1 rounded transition-colors"
                                                title="Transfer host privileges to this player"
                                            >
                                                Make Host
                                            </button>
                                            <button 
                                                onClick={() => kickPlayer(p.id)} 
                                                className="text-xs flex-1 justify-center bg-orange-900/50 text-orange-400 hover:bg-orange-600 hover:text-white px-3 py-2 sm:py-1 rounded transition-colors"
                                                title="Remove player (can rejoin)"
                                            >
                                                Kick
                                            </button>
                                            <button 
                                                onClick={() => banPlayer(p.id)} 
                                                className="text-xs flex-1 justify-center bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white px-3 py-2 sm:py-1 rounded transition-colors"
                                                title="Ban player (permanent kick)"
                                            >
                                                Ban
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>

                        {isHost ? (
                            <button 
                                onClick={handleStartGame} 
                                disabled={categories.length === 0}
                                className={`w-full py-4 rounded-xl font-bold mt-8 tracking-wider uppercase ${categories.length === 0 ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500'}`}
                            >
                                START GAME
                            </button>
                        ) : (
                            <div className="w-full bg-slate-700 text-slate-400 text-center py-4 rounded-xl font-bold mt-8 uppercase">
                                Waiting for host...
                            </div>
                        )}
        
                        <button 
                            onClick={handleLeaveLobby}
                            className="w-full py-3 rounded-xl font-bold mt-3 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                        >
                            LEAVE LOBBY
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
