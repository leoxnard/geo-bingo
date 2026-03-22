'use client';

import { useState, use, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import StreetView from '../../../components/StreetView';
import VotingView from '../../../components/VotingView';
import PodiumView from '../../../components/PodiumView';
import LobbyView from '../../../components/lobby/LobbyView';
import { supabase } from '../../../lib/supabase';
import { adjectives, animals } from '../../../lib/names';
import { IoIosWarning } from "react-icons/io";

import { Player } from '../../../components/utils/types';
type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';


export default function GameRoom({ params }: { params: Promise<{ id: string }> }) {
    const unwrappedParams = use(params);
    const gameId = unwrappedParams.id;
    const router = useRouter();

    // Game state
    const [status, setStatus] = useState<GameStatus>('lobby');
    const [categories, setCategories] = useState<string[]>([]);
    
    const [isHost, setIsHost] = useState(false);
    const [gameHostId, setGameHostId] = useState<string>('');
    const [timeLimit, setTimeLimit] = useState(300);  
  
    // Bingo Mode State
    const [gameMode, setGameMode] = useState<'list' | 'bingo'>('list');
    const [teamMode, setTeamMode] = useState<'ffa' | 'teams'>('ffa');
    const [gridSize, setGridSize] = useState(3);
    const [bingoBoardMode, setBingoBoardMode] = useState<'shared' | 'individual'>('shared');
    const [startingPoint, setStartingPoint] = useState<string>('open-world');
    const [gameBoundary, setGameBoundary] = useState<string | null>(null);
  
    // Players & Voting
    const [playerId, setPlayerId] = useState<string>('');
    const [players, setPlayers] = useState<Player[]>([]);
    const [onlinePlayers, setOnlinePlayers] = useState<string[]>([]);
    const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
    const [bannedPlayers, setBannedPlayers] = useState<string[]>([]);
    const [gameLoaded, setGameLoaded] = useState(false);

    const [timeLeft, setTimeLeft] = useState<number>(0);

    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const timeUpTriggeredRef = useRef(false);

    const showToast = (message: string) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 3500);
    };

    const updateGameModeInfo = async (updates: { game_mode?: string; team_mode?: string; grid_size?: number; bingo_board_mode?: 'shared' | 'individual'; starting_point?: string; gameBoundary?: string | null }) => {
        if (!isHost) return;
        if (updates.game_mode) setGameMode(updates.game_mode as 'list' | 'bingo');
        if (updates.team_mode) setTeamMode(updates.team_mode as 'ffa' | 'teams');
        if (updates.grid_size) setGridSize(updates.grid_size);
        if (updates.bingo_board_mode) setBingoBoardMode(updates.bingo_board_mode);
        if (updates.starting_point) setStartingPoint(updates.starting_point);
        if (updates.gameBoundary !== undefined) setGameBoundary(updates.gameBoundary);
        await supabase.from('games').update(updates).eq('id', gameId);
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
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
                    game_mode: 'list', team_mode: 'ffa', grid_size: 3, starting_point: 'open-world'
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
                setTeamMode(gameData.team_mode || 'ffa');
                setGridSize(gameData.grid_size || 3);
                setBingoBoardMode(gameData.bingo_board_mode || 'shared');
                setStartingPoint(gameData.starting_point || 'open-world');
                setGameBoundary(gameData.gameBoundary || null);
        
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
            const { data } = await supabase.from('players').select('id, name, bingo_board, team').eq('game_id', gameId);
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
          
                    const newHostId = payload.new.host_id || '';
                    setGameHostId(newHostId);
                    setIsHost(newHostId === currentPlayerId);
                    if (newHostId === currentPlayerId) {
                        localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                    } else {
                        localStorage.removeItem(`geoBingoHost_${gameId}`);
                    }
                    setStatus(payload.new.status);
                    setCategories(payload.new.categories);
                    setReadyPlayers(payload.new.ready_players || []);
                    setBannedPlayers(payload.new.banned_players || []);
                    setTimeLimit(payload.new.time_limit || 300);
                    setGameMode(payload.new.game_mode || 'list');
                    setTeamMode(payload.new.team_mode || 'ffa');
                    setGridSize(payload.new.grid_size || 3);
                    setBingoBoardMode(payload.new.bingo_board_mode || 'shared');
                    setStartingPoint(payload.new.starting_point || 'open-world');
                    setGameBoundary(payload.new.gameBoundary || null);
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
            const rawStored = localStorage.getItem(timerStorageKey);
            const hasValidStored = rawStored !== null && !isNaN(Number(rawStored));
            
            const endTs = hasValidStored ? Number(rawStored) : now + (timeLimit * 1000);

            if (!hasValidStored) {
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
    const updateTimeLimit = async (minutes: number) => {
        const seconds = minutes * 60;
        setTimeLimit(seconds);
        await supabase.from('games').update({ time_limit: seconds }).eq('id', gameId);
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
                teamMode={teamMode}
                isHost={isHost}
                gridSize={gridSize}
                bingoBoardMode={bingoBoardMode}
                startingPoint={startingPoint}
                gameBoundary={gameBoundary}
                updateGameModeInfo={updateGameModeInfo}
                timeLimit={timeLimit}
                updateTimeLimit={updateTimeLimit}
                categories={categories}
                gameId={gameId}
                players={players}
                onlinePlayers={onlinePlayers}
                playerId={playerId}
                gameHostId={gameHostId}
                makeHost={makeHost}
                kickPlayer={kickPlayer}
                banPlayer={banPlayer}
                showToast={showToast}
                router={router}
                supabase={supabase}
                updateStatus={updateStatus}
                setPlayers={setPlayers}
            />
        );
    }

    // --- VIEW 2: PLAYING ---
    if (status === 'playing') {
        const currentPlayer = players.find(p => p.id === playerId);
        const myBoard = gameMode === 'bingo' && currentPlayer?.bingo_board && currentPlayer.bingo_board.length > 0 
            ? currentPlayer.bingo_board 
            : categories;
        return (
            <StreetView
                myBoard={myBoard}
                gameId={gameId}
                playerId={playerId}
                gameMode={gameMode}
                teamMode={teamMode}
                gridSize={gridSize}
                startingPoint={startingPoint}
                gameBoundary={gameBoundary}
                renderToast={renderToast}
                showToast={showToast}
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
                teamMode={teamMode}
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
                teamMode={teamMode}
            />
        );
    }
}