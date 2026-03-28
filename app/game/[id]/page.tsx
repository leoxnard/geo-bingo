'use client';

import { useState, use, useEffect, useRef, useCallback } from 'react';

import { useRouter } from 'next/navigation';
import { IoIosWarning } from "react-icons/io";
import toast, { Toaster } from 'react-hot-toast';

import LobbyView from '../../../components/lobby/LobbyView';
import PodiumView from '../../../components/PodiumView';
import StreetView from '../../../components/StreetView';
import { Player } from '../../../components/utils/types';
import VotingView from '../../../components/VotingJourneyView';
import FastVotingView from '../../../components/VotingView';
import { adjectives, animals } from '../../../lib/names';
import { supabase } from '../../../lib/supabase';
import { shuffle } from '../../../components/utils/Functions';


type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';


export default function GameRoom({ params }: { params: Promise<{ id: string }> }) {
    const unwrappedParams = use(params);
    const gameId = unwrappedParams.id;
    const router = useRouter();

    // Game state
    const [status, setStatus] = useState<GameStatus>('lobby');
    const [exclusiveMode, setExclusiveMode] = useState(false);
    const [categories, setCategories] = useState<string[]>([]);
    const [suggestedCategories, setSuggestedCategories] = useState<string[]>([]);
    const [isHost, setIsHost] = useState(false);
    const [gameHostId, setGameHostId] = useState<string>('');
    const [timeLimit, setTimeLimit] = useState(300);
    const [categorySource, setCategorySource] = useState<'manual' | 'generation'>('manual');
    const [generationRadius, setGenerationRadius] = useState<number>(10); // in 100m
  
    // Bingo Mode State
    const [gameMode, setGameMode] = useState<'list' | 'bingo'>('list');
    const [teamMode, setTeamMode] = useState<'ffa' | 'teams'>('ffa');
    const [gridSize, setGridSize] = useState(3);
    const [bingoBoardMode, setBingoBoardMode] = useState<'shared' | 'individual'>('shared');
    const [endCondition, setEndCondition] = useState<'first_bingo' | 'timer'>('timer');
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

    const timeUpTriggeredRef = useRef(false);

    // advanced game options
    const [hideMapSymbols, setHideMapSymbols] = useState(false);
    const [fastVoting, setFastVoting] = useState(false);

    const updateGameModeInfo = async (updates: {
        game_mode?: string;
        team_mode?: string;
        grid_size?: number;
        bingo_board_mode?: 'shared' | 'individual';
        starting_point?: string;
        gameBoundary?: string | null;
        end_condition?: 'first_bingo' | 'timer';
        hide_map_symbols?: boolean;
        fast_voting?: boolean;
        exclusive_mode?: boolean;
        category_source?: 'manual' | 'generation';
        generation_radius?: number;
    }) => {
        if (!isHost) return;
        if (updates.game_mode) setGameMode(updates.game_mode as 'list' | 'bingo');
        if (updates.team_mode) setTeamMode(updates.team_mode as 'ffa' | 'teams');
        if (updates.grid_size) setGridSize(updates.grid_size);
        if (updates.bingo_board_mode) setBingoBoardMode(updates.bingo_board_mode);
        if (updates.starting_point) setStartingPoint(updates.starting_point);
        if (updates.gameBoundary !== undefined) setGameBoundary(updates.gameBoundary);
        if (updates.end_condition) setEndCondition(updates.end_condition as 'first_bingo' | 'timer');
        if (updates.hide_map_symbols !== undefined) setHideMapSymbols(updates.hide_map_symbols);
        if (updates.fast_voting !== undefined) setFastVoting(updates.fast_voting);
        if (updates.exclusive_mode !== undefined) setExclusiveMode(updates.exclusive_mode);
        if (updates.category_source !== undefined) setCategorySource(updates.category_source);
        if (updates.generation_radius !== undefined) setGenerationRadius(updates.generation_radius);
        await supabase.from('games').update(updates).eq('id', gameId);
    };

    useEffect(() => {
        let localId = sessionStorage.getItem('geoBingoSessionUUID');
        if (!localId) {
            localId = crypto.randomUUID();
            sessionStorage.setItem('geoBingoSessionUUID', localId);
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPlayerId(localId);

        const currentPlayerId = localId; 

        const initializeRoom = async () => {
            const storedName = localStorage.getItem('geoBingoPlayerName') || '';
            const playerName = storedName.trim() && storedName !== 'Unknown Player'
                ? storedName
                : `${adjectives[Math.floor(Math.random() * adjectives.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
            if (!storedName.trim() || storedName === 'Unknown Player') {
                localStorage.setItem('geoBingoPlayerName', playerName);
            }

            const [gameResponse, playerResponse] = await Promise.all([
                supabase.from('games').select('*').eq('id', gameId).single(),
                supabase.from('players').select('id, bingo_board').eq('id', currentPlayerId).single()
            ]);

            let gameData = gameResponse.data;
            const existingPlayer = playerResponse.data;

            // Kick Check
            if (gameData?.banned_players?.includes(currentPlayerId)) {
                toast('You have been kicked from this lobby.');
                setTimeout(() => router.push('/'), 2000);
                return;
            }

            // Setup or Load the Game Room
            if (!gameData) {
                const newGameData = { 
                    id: gameId, status: 'lobby', categories: [], ready_players: [], time_limit: 300, 
                    host_id: currentPlayerId, banned_players: [], game_mode: 'list', team_mode: 'ffa', 
                    grid_size: 3, starting_point: 'open-world', end_condition: 'timer', 
                    hide_map_symbols: false, exclusive_mode: false, category_source: 'manual', generation_radius: 10
                };
                const { error } = await supabase.from('games').insert([newGameData]);
                if (!error) {
                    setIsHost(true);
                    setGameHostId(currentPlayerId);
                    gameData = newGameData;
                    localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                } else {
                    console.error("CRITICAL: Failed to create game.", error);
                }
            } else {
                setStatus(gameData.status || 'lobby');
                setCategories(gameData.categories || []);
                setSuggestedCategories(gameData.suggested_categories || []);
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
                setEndCondition(gameData.end_condition || 'timer');
                setHideMapSymbols(gameData.hide_map_symbols || false);
                setFastVoting(gameData.fast_voting || false);
                setExclusiveMode(gameData.exclusive_mode || false);
                setCategorySource(gameData.category_source || 'manual');
                setGenerationRadius(gameData.generation_radius || 10);

                const isActuallyHost = gameData.host_id === currentPlayerId;
                setIsHost(isActuallyHost);
                if (isActuallyHost) localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                else localStorage.removeItem(`geoBingoHost_${gameId}`);
            }

            // register player
            let bingoBoardToAssign = null;
            if (gameData.status === 'playing' && gameData.game_mode === 'bingo' && gameData.categories) {
                const neededCount = (gameData.grid_size || 3) * (gameData.grid_size || 3);
                
                if (gameData.bingo_board_mode === 'shared') {
                    const { data: otherPlayers } = await supabase.from('players')
                        .select('bingo_board')
                        .eq('game_id', gameId)
                        .not('bingo_board', 'is', null)
                        .limit(1);
                        
                    if (otherPlayers && otherPlayers.length > 0 && otherPlayers[0].bingo_board) {
                        bingoBoardToAssign = otherPlayers[0].bingo_board;
                    } else {
                        bingoBoardToAssign = gameData.categories.slice(0, neededCount);
                    }
                } else {
                    bingoBoardToAssign = shuffle([...gameData.categories]).slice(0, neededCount);
                }
            }

            if (!existingPlayer) {
                const insertData: any = { id: currentPlayerId, game_id: gameId, name: playerName };
                if (bingoBoardToAssign) insertData.bingo_board = bingoBoardToAssign;
                const { error: playerInsertErr } = await supabase.from('players').insert([insertData]);
                if (playerInsertErr) console.error("CRITICAL: Failed to insert player.", playerInsertErr);
            } else {
                const updateData: any = { name: playerName, game_id: gameId };
                if ((!existingPlayer.bingo_board || existingPlayer.bingo_board.length === 0) && bingoBoardToAssign) {
                    updateData.bingo_board = bingoBoardToAssign;
                }
                const { error: playerUpdateErr } = await supabase.from('players').update(updateData).eq('id', currentPlayerId);
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
                    setSuggestedCategories(payload.new.suggested_categories || []);
                    setReadyPlayers(payload.new.ready_players || []);
                    setBannedPlayers(payload.new.banned_players || []);
                    setTimeLimit(payload.new.time_limit || 300);
                    setGameMode(payload.new.game_mode || 'list');
                    setTeamMode(payload.new.team_mode || 'ffa');
                    setGridSize(payload.new.grid_size || 3);
                    setBingoBoardMode(payload.new.bingo_board_mode || 'shared');
                    setStartingPoint(payload.new.starting_point || 'open-world');
                    setGameBoundary(payload.new.gameBoundary || null);
                    setEndCondition(payload.new.end_condition || 'timer');
                    setHideMapSymbols(payload.new.hide_map_symbols || false);
                    setFastVoting(payload.new.fast_voting || false);
                    setExclusiveMode(payload.new.exclusive_mode || false);
                    setCategorySource(payload.new.category_source || 'manual');
                    setGenerationRadius(payload.new.generation_radius || 10);
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
            toast("You are no longer the host.");
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

    const selectView = () => {
        // --- VIEW 1: LOBBY ---
        if (status === 'lobby') {
            return (
                <LobbyView
                    gameMode={gameMode}
                    teamMode={teamMode}
                    isHost={isHost}
                    gridSize={gridSize}
                    bingoBoardMode={bingoBoardMode}
                    startingPoint={startingPoint}
                    endCondition={endCondition}
                    gameBoundary={gameBoundary}
                    updateGameModeInfo={updateGameModeInfo}
                    timeLimit={timeLimit}
                    updateTimeLimit={updateTimeLimit}
                    exclusiveMode={exclusiveMode}
                    categories={categories}
                    suggestedCategories={suggestedCategories}
                    gameId={gameId}
                    players={players}
                    onlinePlayers={onlinePlayers}
                    playerId={playerId}
                    gameHostId={gameHostId}
                    makeHost={makeHost}
                    kickPlayer={kickPlayer}
                    banPlayer={banPlayer}
                    router={router}
                    supabase={supabase}
                    updateStatus={updateStatus}
                    setPlayers={setPlayers}
                    hideMapSymbols={hideMapSymbols}
                    fastVoting={fastVoting}
                    categorySource={categorySource}
                    generationRadius={generationRadius}
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
                    endCondition={endCondition}
                    timeLeft={timeLeft}
                    readyPlayers={readyPlayers}
                    players={players}
                    hideMapSymbols={hideMapSymbols}
                    exclusiveMode={exclusiveMode}
                />
            );
        }

        // --- VIEW 3: VOTING ---
        if (status === 'voting') {
            if (fastVoting) {
                return (
                    <FastVotingView
                        gameId={gameId}
                        isHost={isHost}
                        categories={categories}
                        playerId={playerId}
                        players={players}
                        teamMode={teamMode}
                        onFinishGame={handleFinishGame}
                    />
                );
            }
            return (
                <VotingView
                    gameId={gameId}
                    isHost={isHost}
                    categories={categories}
                    playerId={playerId}
                    players={players}
                    teamMode={teamMode}
                    onFinishGame={handleFinishGame}
                />
            );
        }

        // --- VIEW 4: PODIUM (FINISHED) ---
        if (status === 'finished') {
            return (
                <PodiumView
                    gameId={gameId}
                    isHost={isHost}
                    teamMode={teamMode}
                />
            );
        }
    };

    return (
        <>
            <Toaster
                position="top-center"
                reverseOrder={false}
            />
            {selectView()}
        </>
    );
}