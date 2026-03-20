'use client';

import { useState, use, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import StreetView from '../../../components/StreetView';
import VotingView from '../../../components/VotingView';
import PodiumView from '../../../components/PodiumView';
import LobbyView from '../../../components/LobbyView';
import { supabase } from '../../../lib/supabase';
import { adjectives, animals } from '../../../lib/names';
import { IoIosWarning } from "react-icons/io";


type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
}

const shuffle = <T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

export default function GameRoom({ params }: { params: Promise<{ id: string }> }) {
    const unwrappedParams = use(params);
    const gameId = unwrappedParams.id;
    const router = useRouter();

    // Game state
    const [status, setStatus] = useState<GameStatus>('lobby');
    const [categories, setCategories] = useState<string[]>([]);
    const [newCategory, setNewCategory] = useState('');
    const [randomLang, setRandomLang] = useState<'german' | 'english'>('german');
    const [randomCount, setRandomCount] = useState<number | ''>(4);
    const [isHost, setIsHost] = useState(false);
    const [gameHostId, setGameHostId] = useState<string>('');
    const [timeLimit, setTimeLimit] = useState(300);  
    const categoryInputRef = useRef<HTMLInputElement>(null);
    const selfNameInputRef = useRef<HTMLInputElement>(null);
    const [isEditingSelfName, setIsEditingSelfName] = useState(false);
    const [selfNameInput, setSelfNameInput] = useState('');
  
    // Bingo Mode State
    const [gameMode, setGameMode] = useState<'list' | 'bingo'>('list');
    const [gridSize, setGridSize] = useState(3);
    const [bingoTarget, setBingoTarget] = useState(3);
    const [bingoBoardMode, setBingoBoardMode] = useState<'shared' | 'individual'>('shared');
  
    // Players & Voting
    const [playerId, setPlayerId] = useState<string>('');
    const [players, setPlayers] = useState<Player[]>([]);
    const [onlinePlayers, setOnlinePlayers] = useState<string[]>([]);
    const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
    const [bannedPlayers, setBannedPlayers] = useState<string[]>([]);
    const [gameLoaded, setGameLoaded] = useState(false);

    const [timeLeft, setTimeLeft] = useState<number>(0);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [currentLink, setCurrentLink] = useState('');
    const timeUpTriggeredRef = useRef(false);

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

    useEffect(() => {
        setCurrentLink(window.location.href);
    }, []);

    const showToast = (message: string) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 3500);
    };

    useEffect(() => {
        const currentName = players.find((p) => p.id === playerId)?.name;
        if (!isEditingSelfName && currentName) {
            setSelfNameInput(currentName);
        }
    }, [players, playerId, isEditingSelfName]);

    useEffect(() => {
        if (isEditingSelfName) {
            selfNameInputRef.current?.focus();
            selfNameInputRef.current?.select();
        }
    }, [isEditingSelfName]);

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

    const handleLeaveLobby = () => {
        localStorage.setItem('geoBingoLastLobbyId', gameId);
        router.push('/');
    };

    // The definitive engine (Setup Identity, Game, Players)
    useEffect(() => {
    // Use sessionStorage so multiple tabs act as different players
    // Initialize inside the effect but outside initializeRoom so the rest of the effect can access it
        let localId = sessionStorage.getItem('geoBingoSessionUUID');
        if (!localId) {
            localId = crypto.randomUUID();
            sessionStorage.setItem('geoBingoSessionUUID', localId);
        }
        setPlayerId(localId);

        // Save ID into a constant so scope definitely propagates down to handleUnload
        const currentPlayerId = localId; 

        const initializeRoom = async () => {
            // Name still comes from localStorage so you don't have to retype it
            const storedName = localStorage.getItem('geoBingoPlayerName') || '';
            const playerName = storedName.trim() && storedName !== 'Unknown Player'
                ? storedName
                : `${adjectives[Math.floor(Math.random() * adjectives.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
            if (!storedName.trim() || storedName === 'Unknown Player') {
                localStorage.setItem('geoBingoPlayerName', playerName);
            }

            // 2. Setup or Load the Game Room
            const { data: gameData } = await supabase.from('games').select('*').eq('id', gameId).single();

            if (gameData?.banned_players?.includes(currentPlayerId)) {
                showToast('You have been kicked from this lobby.');
                setTimeout(() => router.push('/'), 2000);
                return;
            }

            if (!gameData) {
                const { error } = await supabase.from('games').insert([{ 
                    id: gameId, status: 'lobby', categories: [], ready_players: [], time_limit: 300, host_id: currentPlayerId, banned_players: [],
                    game_mode: 'list', grid_size: 3, bingo_target: 3
                }]);
                if (!error) {
                    setIsHost(true);
                    setGameHostId(currentPlayerId);
                    localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                } else {
                    console.error("CRITICAL: Failed to create game. Did you add the target column? Error:", error);
                }
            } else {
                setStatus(gameData.status);
                setCategories(gameData.categories);
                setReadyPlayers(gameData.ready_players || []);
                setBannedPlayers(gameData.banned_players || []);
                setTimeLimit(gameData.time_limit || 300);
                setGameHostId(gameData.host_id || '');
                setGameMode(gameData.game_mode || 'list');
                setGridSize(gameData.grid_size || 3);
                setBingoTarget(gameData.bingo_target || 3);
        
                // Restore host status if they refresh the page
                const isActuallyHost = gameData.host_id === currentPlayerId;
                setIsHost(isActuallyHost);
                if (isActuallyHost) {
                    localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                } else {
                    localStorage.removeItem(`geoBingoHost_${gameId}`);
                }
            }

            // 3. Register Player
            const { data: existingPlayer } = await supabase.from('players').select('id').eq('id', currentPlayerId).single();
            if (!existingPlayer) {
                const { error: playerInsertErr } = await supabase.from('players').insert([{ id: currentPlayerId, game_id: gameId, name: playerName }]);
                if (playerInsertErr) console.error("CRITICAL: Failed to insert player. Is the Game missing?", playerInsertErr);
            } else {
                // Ensure game_id is updated so they correctly join the new room
                const { error: playerUpdateErr } = await supabase.from('players').update({ name: playerName, game_id: gameId }).eq('id', currentPlayerId);
                if (playerUpdateErr) console.error("CRITICAL: Failed to update player.", playerUpdateErr);
            }
      
            fetchPlayers();
            setGameLoaded(true);
        };

        const fetchPlayers = async () => {
            const { data } = await supabase.from('players').select('id, name, bingo_board').eq('game_id', gameId);
            if (data) {
                setPlayers(data);
                // If the current player is no longer in the DB, they were kicked.
                if (!data.some(p => p.id === currentPlayerId)) {
                    router.push('/');
                }
            }
        };

        initializeRoom();

        // 4. Set up Realtime Listeners
        const gameChannel = supabase.channel(`game-updates-${gameId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, 
                (payload) => {
                    // Kicked player check
                    if (payload.new.banned_players?.includes(currentPlayerId)) {
                        router.push('/');
                        return;
                    }
          
                    setStatus(payload.new.status);
                    setCategories(payload.new.categories);
                    setReadyPlayers(payload.new.ready_players || []);
                    setBannedPlayers(payload.new.banned_players || []);
                    setTimeLimit(payload.new.time_limit || 300);
          
                    const newHostId = payload.new.host_id || '';
                    setGameHostId(newHostId);
                    setIsHost(newHostId === currentPlayerId);
                    if (newHostId === currentPlayerId) {
                        localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                    } else {
                        localStorage.removeItem(`geoBingoHost_${gameId}`);
                    }

                    setGameMode(payload.new.game_mode || 'list');
                    setGridSize(payload.new.grid_size || 3);
                    setBingoTarget(payload.new.bingo_target || 3);
                }
            ).subscribe();

        const playerChannel = supabase.channel(`player-updates-${gameId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    // Auto-Kick & redirect if we were deleted from the DB
                    if (payload.eventType === 'DELETE' && payload.old.id === currentPlayerId) {
                        router.push('/');
                    } else {
                        fetchPlayers();
                    }
                }
            ).subscribe();

        // 5. Presence Tracking
        const presenceChannel = supabase.channel(`presence-${gameId}`);
    
        presenceChannel
            .on('presence', { event: 'sync' }, async () => {
                const state = presenceChannel.presenceState();
                const onlineIds: string[] = [];
                for (const id in state) {
                    const presences = state[id] as Array<{ player_id?: string }>;
                    presences.forEach((presence) => {
                        if (presence.player_id) onlineIds.push(presence.player_id);
                    });
                }
                const uniqueOnlineIds = Array.from(new Set(onlineIds));
                setOnlinePlayers(uniqueOnlineIds);

                // If host disconnects (but still exists in players table), reassign host to next online player.
                const { data: liveGame } = await supabase
                    .from('games')
                    .select('host_id, status')
                    .eq('id', gameId)
                    .single();

                if (!liveGame || liveGame.status !== 'lobby') return;
                if (!liveGame.host_id || uniqueOnlineIds.includes(liveGame.host_id)) return;

                const { data: lobbyPlayers } = await supabase
                    .from('players')
                    .select('id')
                    .eq('game_id', gameId);

                const nextHostId = (lobbyPlayers || [])
                    .map((p: { id: string }) => p.id)
                    .find((id) => uniqueOnlineIds.includes(id));

                if (!nextHostId) return;

                await supabase
                    .from('games')
                    .update({ host_id: nextHostId })
                    .eq('id', gameId)
                    .eq('host_id', liveGame.host_id);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await presenceChannel.track({ player_id: currentPlayerId });
                }
            });

        return () => { 
            supabase.removeChannel(gameChannel); 
            supabase.removeChannel(playerChannel); 
            supabase.removeChannel(presenceChannel); 
        };
    }, [gameId, router]);

    // Status update handler
    const updateStatus = useCallback(async (nextStatus: GameStatus) => {
        const { error } = await supabase.from('games').update({ status: nextStatus }).eq('id', gameId);
        if (error) console.error("Error updating game status:", error);
    }, [gameId]);

    // --- TIMER LOGIC ---
    useEffect(() => {
        if (!gameLoaded) return;

        const timerStorageKey = `geoBingoTimerEnd_${gameId}`;
        const clearTimerState = () => {
            localStorage.removeItem(timerStorageKey);
            timeUpTriggeredRef.current = false;
            setTimeLeft(0);
        };

        // Non-playing phases always clear persisted timer so a new round starts fresh.
        if (status !== 'playing') {
            clearTimerState();
            return;
        }

        // Playing phase: restore existing deadline across reloads or create a new one.
        const tick = () => {
            const now = Date.now();
            const storedEnd = Number(localStorage.getItem(timerStorageKey));
            const validStoredEnd = Number.isFinite(storedEnd) && storedEnd > now;
            const endTs = validStoredEnd ? storedEnd : now + (timeLimit * 1000);

            if (!validStoredEnd) {
                localStorage.setItem(timerStorageKey, String(endTs));
            }

            const left = Math.max(0, Math.ceil((endTs - now) / 1000));
            setTimeLeft(left);

            if (left === 0 && isHost && !timeUpTriggeredRef.current) {
                timeUpTriggeredRef.current = true;
                void updateStatus('voting');
            }
        };

        tick();
        const timerId = setInterval(tick, 1000);
        return () => clearInterval(timerId);
    }, [status, timeLimit, isHost, gameId, updateStatus, gameLoaded]);

    // --- ACTIONS ---
    const clearCategories = async () => {
        if (isHost) {
            await supabase.from('games').update({ categories: [] }).eq('id', gameId);
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

    const addRandomCategories = async () => {
        if (!isHost) return;
        try {
            const { categoriesDe, categoriesEn } = await import('../../../lib/categories');
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

    const removeCategory = async (catToRemove: string) => {
        if (isHost && categories.length > 0) {
            const updated = categories.filter(c => c !== catToRemove);
            await supabase.from('games').update({ categories: updated }).eq('id', gameId);
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

    const updateTimeLimit = async (minutes: number) => {
        const seconds = minutes * 60;
        setTimeLimit(seconds);
        await supabase.from('games').update({ time_limit: seconds }).eq('id', gameId);
    };

    const updateGameModeInfo = async (updates: { game_mode?: string; grid_size?: number; bingo_target?: number }) => {
        if (!isHost) return;
        if (updates.game_mode) setGameMode(updates.game_mode as 'list' | 'bingo');
        if (updates.bingo_target) setBingoTarget(updates.bingo_target);
        if (updates.grid_size) {
            setGridSize(updates.grid_size);
            if (updates.grid_size < bingoTarget) {
                setBingoTarget(updates.grid_size);
                updates.bingo_target = updates.grid_size;
            }
        }
        await supabase.from('games').update(updates).eq('id', gameId);
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

                    const promises = playersData.map((player) => {
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

    const kickPlayer = async (idToKick: string) => {
        if (isHost) {
            setPlayers(prev => prev.filter(p => p.id !== idToKick));

            const { data, error } = await supabase.from('players').delete().eq('id', idToKick).select();
      
            if (error || (data && data.length === 0)) {
                console.error("Error deleting player (RLS Policy or Replica Identity):", error);
            }
      
            // Also remove them from ready_players if they were ready
            if (readyPlayers.includes(idToKick)) {
                const updatedReady = readyPlayers.filter(id => id !== idToKick);
                await supabase.from('games').update({ ready_players: updatedReady }).eq('id', gameId);
            }
        }
    };

    const makeHost = async (newHostId: string) => {
        if (isHost) {
            await supabase.from("games").update({ host_id: newHostId }).eq("id", gameId);
            setIsHost(false);
            localStorage.removeItem(`geoBingoHost_${gameId}`);
            showToast("You are no longer the host.");
        }
    };

    const banPlayer = async (idToKick: string) => {
        if (isHost) {
            setPlayers(prev => prev.filter(p => p.id !== idToKick));

            // Add to banned list in the DB
            const updatedBanned = [...bannedPlayers, idToKick];
            await supabase.from('games').update({ banned_players: updatedBanned }).eq('id', gameId);

            const { data, error } = await supabase.from('players').delete().eq('id', idToKick).select();
      
            if (error || (data && data.length === 0)) {
                console.error("Error deleting player (RLS Policy or Replica Identity):", error);
            }
      
            // Also remove them from ready_players if they were ready
            if (readyPlayers.includes(idToKick)) {
                const updatedReady = readyPlayers.filter(id => id !== idToKick);
                await supabase.from('games').update({ ready_players: updatedReady }).eq('id', gameId);
            }
        }
    };

    const handleFinishGame = async () => {
        await supabase.from('games').update({ status: 'finished' }).eq('id', gameId);
    };

    const renderToast = () => (
        <div 
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ${toastMessage ? 'translate-y-0 opacity-100' : '-translate-y-20 opacity-0 pointer-events-none'}`}
        >
            <div className="bg-slate-800 border-b-4 border-red-500 text-white px-6 py-4 rounded-xl shadow-2xl font-bold flex items-center gap-3">
                <span className="text-red-500 text-2xl leading-none"><IoIosWarning /></span>
                <span>{toastMessage}</span>
            </div>
        </div>
    );

    // --- VIEW 1: LOBBY ---
    if (status === 'lobby') {
        return (
            <LobbyView
                renderToast = {renderToast}
                gameMode={gameMode}
                updateGameModeInfo={updateGameModeInfo}
                isHost={isHost}
                gridSize={gridSize}
                bingoTarget={bingoTarget}
                bingoBoardMode={bingoBoardMode}
                setBingoBoardMode={setBingoBoardMode}
                timeLimit={timeLimit}
                updateTimeLimit={updateTimeLimit}
                categories={categories}
                clearCategories={clearCategories}
                getSidebarTextSizeClass={getSidebarTextSizeClass}
                draggedIndex={draggedIndex}
                handleDragStart={handleDragStart}
                handleDragOver={handleDragOver}
                handleDrop={handleDrop}
                removeCategory={removeCategory}
                categoryInputRef={categoryInputRef}
                newCategory={newCategory}
                setNewCategory={setNewCategory}
                addCategory={addCategory}
                randomCount={randomCount}
                setRandomCount={setRandomCount}
                randomLang={randomLang}
                setRandomLang={setRandomLang}
                addRandomCategories={addRandomCategories}
                gameId={gameId}
                handleCopyGameId={handleCopyGameId}
                copied={copied}
                currentLink={currentLink}
                handleCopyGameLink={handleCopyGameLink}
                copiedLink={copiedLink}
                players={players}
                onlinePlayers={onlinePlayers}
                playerId={playerId}
                isEditingSelfName={isEditingSelfName}
                setIsEditingSelfName={setIsEditingSelfName}
                selfNameInputRef={selfNameInputRef}
                selfNameInput={selfNameInput}
                setSelfNameInput={setSelfNameInput}
                saveSelfName={saveSelfName}
                gameHostId={gameHostId}
                handleRenameSelf={handleRenameSelf}
                makeHost={makeHost}
                kickPlayer={kickPlayer}
                banPlayer={banPlayer}
                handleStartGame={handleStartGame}
                handleLeaveLobby={handleLeaveLobby}
            />
        );
    }

    // --- VIEW 2: PLAYING ---
    if (status === 'playing') {
        return (
            <StreetView
                categories={categories}
                gameId={gameId}
                playerId={playerId}
                gameMode={gameMode}
                gridSize={gridSize}
                renderToast={renderToast}
                timeLeft={timeLeft}
                readyPlayers={readyPlayers}
                players={players}
            />

        );
    }

    // --- VIEW 3: VOTING ---
    if (status === 'voting') {
        return (
            <VotingView
                gameId={gameId}
                isHost={isHost}
                categories={categories}
                playerId={playerId}
                players={players}
                onFinishGame={handleFinishGame}
                renderToast={renderToast}
            />
        );
    }

    // --- VIEW 4: PODIUM (FINISHED) ---
    if (status === 'finished') {
        return (
            <PodiumView
                gameId={gameId}
                renderToast={renderToast}
                isHost={isHost}
            />
        );
    }
}