'use client';

import { useState, use, useEffect, useRef } from 'react';
import { FaRegCopy, FaCopy, FaTimes, FaArrowLeft } from "react-icons/fa";
import { useRouter } from 'next/navigation';
import StreetView from '../../../components/StreetView';
import VotingView from '../../../components/VotingView';
import PodiumView from '../../../components/PodiumView';
import { supabase } from '../../../lib/supabase';
import Image from 'next/image';

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

interface Player {
  id: string;
  name: string;
  bingo_board?: string[];
}

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
  const [gameHostId, setGameHostId] = useState<string>(''); // NEW
  const [timeLimit, setTimeLimit] = useState(300); // 5 minutes standard
  
  const categoryInputRef = useRef<HTMLInputElement>(null);
  
  // Bingo Mode State
  const [gameMode, setGameMode] = useState<'list' | 'bingo'>('list');
  const [gridSize, setGridSize] = useState(3);
  const [bingoTarget, setBingoTarget] = useState(3);
  
  // Players & Voting
  const [playerId, setPlayerId] = useState<string>('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [onlinePlayers, setOnlinePlayers] = useState<string[]>([]);
  const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
  const [bannedPlayers, setBannedPlayers] = useState<string[]>([]);

  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [timerInitialized, setTimerInitialized] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [currentLink, setCurrentLink] = useState('');

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
      const playerName = localStorage.getItem('geoBingoPlayerName') || 'Unknown Player';

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
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const onlineIds: string[] = [];
        for (const id in state) {
          state[id].forEach((presence: any) => {
            if (presence.player_id) onlineIds.push(presence.player_id);
          });
        }
        setOnlinePlayers(onlineIds);
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

  // --- TIMER LOGIC ---
  useEffect(() => {
    // 1. Initialize timer when game starts
    if (status === 'playing' && !timerInitialized) {
      setTimeLeft(timeLimit);
      setTimerInitialized(true);
      return;
    }

    // 2. Countdown and Auto-End Logic
    if (status === 'playing' && timerInitialized) {
      if (timeLeft > 0) {
        const timerId = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
        return () => clearInterval(timerId);
      } 
      // Auto-End if time runs out and we're the host (to prevent multiple updates from clients)
      else if (timeLeft === 0 && isHost) {
        updateStatus('voting');
      }
    }

    // 3. Reset, if we go back to the lobby
    if (status === 'lobby') {
      setTimerInitialized(false);
    }
  }, [status, timeLeft, timeLimit, isHost, timerInitialized]);

  // Format the time for display
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

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

  // Status update handler
  const updateStatus = async (nextStatus: GameStatus) => {
    const { error } = await supabase.from('games').update({ status: nextStatus }).eq('id', gameId);
    if (error) console.error("Error updating game status:", error);
  };

  const handleStartGame = async () => {
    if (categories.length === 0) {
      showToast('Please add at least one category to start the game.');
      return;
    }

    if (gameMode === 'bingo') {
      const neededCount = gridSize * gridSize;
      if (categories.length < neededCount) {
        showToast(`Please add at least ${neededCount} categories (current: ${categories.length}).`);
        return;
      }
      // Generate a distinct shuffled board for EACH player
      const promises = players.map(p => {
        const shuffledPool = [...categories].sort(() => Math.random() - 0.5).slice(0, neededCount);
        return supabase.from('players').update({ bingo_board: shuffledPool }).eq('id', p.id);
      });
      await Promise.all(promises);
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

  const handleVoteEndRound = async () => {
    const updatedReadyPlayers = [...readyPlayers, playerId];
    const votesNeeded = players.length;

    if (updatedReadyPlayers.length >= votesNeeded) {
      // End the round for everyone immediately
      await supabase.from('games').update({ 
        ready_players: updatedReadyPlayers, 
        status: 'voting' 
      }).eq('id', gameId);
    } else {
      // Just record the player's vote
      await supabase.from('games').update({ ready_players: updatedReadyPlayers }).eq('id', gameId);
    }
  };

  const hasVotedToEnd = readyPlayers.includes(playerId);
  const votesNeeded = players.length; // All players

  const renderToast = () => (
    <div 
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ${toastMessage ? 'translate-y-0 opacity-100' : '-translate-y-20 opacity-0 pointer-events-none'}`}
    >
      <div className="bg-slate-800 border-b-4 border-red-500 text-white px-6 py-4 rounded-xl shadow-2xl font-bold flex items-center gap-3">
        <span className="text-red-500 text-2xl leading-none">⚠️</span>
        <span>{toastMessage}</span>
      </div>
    </div>
  );

  // --- VIEW 1: LOBBY ---
  if (status === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center p-10 bg-slate-900 text-white relative">
        {renderToast()}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12">
          <Image 
            src="/mappin.and.ellipse.png"
            alt="Geo Bingo Logo"
            width={80}
            height={80}
            className={"w-auto h-auto drop-shadow-[0_0_15px_rgba(96,165,250,0.5)] transform-gpu transition-transform hidden sm:block"}
          />
          <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">GEO BINGO</h1>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
          
          {/* Settings (Categories, Time) */}
          <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            <h2 className="text-xl font-semibold mb-4 text-slate-300">Settings</h2>
            
            {/* Game Mode Selection */}
            <div className="mb-6 flex bg-slate-900 rounded-lg p-1">
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
                  {gameMode === 'bingo' ? `${Math.min(categories.length, gridSize * gridSize)} / ${gridSize * gridSize}` : `${categories.length} Words`}
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

            {gameMode === 'bingo' ? (
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
                      className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg font-bold h-[42px] whitespace-nowrap shadow-md transition-all text-sm tracking-wider"
                    >
                      Random
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
                    <span className={`flex-1 truncate ${p.id === playerId ? 'text-green-400' : 'text-white'}`}>
                      {p.name} {p.id === gameHostId ? '(Host)' : ''}
                    </span>
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
              onClick={() => router.push('/')}
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

  // --- VIEW 2: PLAYING ---
  if (status === 'playing') {
    return (
      <div className="min-h-screen p-4 bg-slate-900">
        {renderToast()}
        <div className="flex justify-between items-center mb-4 w-full max-w-[95%] xl:max-w-[90vw] mx-auto text-white">
          <div className="flex items-center gap-4">
            <Image 
              src="/mappin.and.ellipse.png"
              alt="Geo Bingo Logo"
              width={40}
              height={40}
              className="w-auto h-auto drop-shadow-[0_0_10px_rgba(96,165,250,0.5)] transform-gpu"
            />
            <h1 className="text-2xl font-bold text-indigo-400">Hunt in Progress</h1>
          </div>
          
          <div className="flex items-stretch gap-3 sm:gap-6">
            {/* Timer Display */}
            <div className="flex items-center justify-center text-xl sm:text-3xl font-black bg-slate-800 px-3 sm:px-6 rounded-lg sm:rounded-xl border border-slate-700 shadow-lg tracking-wider py-1.5 sm:py-2">
              {timeLeft <= 60 ? (
                <span className="text-red-500 animate-pulse">{formatTime(timeLeft)}</span>
              ) : (
                <span className="text-white">{formatTime(timeLeft)}</span>
              )}
            </div>
            
            <div className="flex items-stretch gap-2 sm:gap-4">
              <span className="text-slate-400 font-medium hidden md:flex items-center">
                Votes to end:&nbsp;<strong className="text-white">{readyPlayers.length} / {votesNeeded}</strong>
              </span>
              <button 
                onClick={handleVoteEndRound}
                disabled={hasVotedToEnd}
                className={`flex items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm shadow-lg
                  ${hasVotedToEnd ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white'}`}
              >
                {hasVotedToEnd ? 'Wait...' : 'End Vote'}
              </button>
            </div>
          </div>
        </div>
        
        <div className="w-full max-w-[95%] xl:max-w-[90vw] mx-auto">
          {playerId && (
            <StreetView 
              categories={gameMode === 'bingo' ? (players.find(p => p.id === playerId)?.bingo_board || categories) : categories} 
              gameId={gameId} 
              playerId={playerId}
              gameMode={gameMode}
              gridSize={gridSize}
            />
          )}
        </div>
      </div>
    );
  }

  const handleFinishGame = async () => {
    await supabase.from('games').update({ status: 'finished' }).eq('id', gameId);
  };

  // --- VIEW 3: VOTING ---
  if (status === 'voting') {
    return (
      <div className="min-h-screen flex flex-col items-center p-4 bg-slate-900 text-white">
        {renderToast()}
        <div className="w-full max-w-[95%] xl:max-w-[90vw] flex justify-between items-center mb-8 mt-4">
          <div className="flex items-center gap-4">
            <Image 
              src="/mappin.and.ellipse.png"
              alt="Geo Bingo Logo"
              width={50}
              height={50}
              className="w-auto h-auto drop-shadow-[0_0_10px_rgba(96,165,250,0.5)] transform-gpu hidden sm:block"
            />
            <h1 className="text-4xl font-black uppercase tracking-widest text-indigo-400">Voting Phase</h1>
          </div>
        </div>

        <div className="w-full max-w-[95%] xl:max-w-[90vw]">
          <VotingView 
            gameId={gameId} 
            isHost={isHost} 
            categories={categories} 
            playerId={playerId} 
            totalPlayers={players.length} 
            onFinishGame={handleFinishGame}
          />
        </div>
      </div>
    );
  }

  // --- VIEW 4: PODIUM (FINISHED) ---
  if (status === 'finished') {
    return (
      <div className="min-h-screen flex flex-col items-center p-4 bg-slate-900 text-white">
        {renderToast()}
        <div className="w-full max-w-5xl flex justify-between items-center mb-4 mt-4">
          <div className="flex items-center gap-4">
            <Image 
              src="/mappin.and.ellipse.png"
              alt="Geo Bingo Logo"
              width={50}
              height={50}
              className="w-auto h-auto drop-shadow-[0_0_10px_rgba(96,165,250,0.5)] transform-gpu hidden sm:block"
            />
            <h1 className="text-4xl font-black uppercase tracking-widest text-indigo-400">Final Results</h1>
          </div>
          {isHost ? (
            <button 
              onClick={async () => {
                // Delete old submissions for the new round
                await supabase.from('submissions').delete().eq('game_id', gameId);
                // Status zurück auf Lobby setzen
                const { error } = await supabase.from('games').update({ status: 'lobby', ready_players: [] }).eq('id', gameId);
                if (error) console.error("Error returning to lobby:", error);
              }}
              className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg transition-all uppercase text-sm tracking-wide shadow-lg"
            >
              Back to Lobby
            </button>
          ) : (
            <div className="text-slate-400 italic font-medium bg-slate-800 px-6 py-3 rounded-lg border border-slate-700">
              Waiting for Host...
            </div>
          )}
        </div>

        <PodiumView gameId={gameId} />
      </div>
    );
  }
}