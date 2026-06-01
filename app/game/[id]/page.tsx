'use client';

/*
================================================================================
GAME PAGE
================================================================================
Main game interface controller for the Geo Bingo application.
Manages game state transitions between lobby, playing, and voting phases.
Integrates LobbyView, StreetView, VotingView, and PodiumView components.
================================================================================
*/

import { useState, use, useEffect, useRef, useCallback } from 'react';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';
import { CiCircleAlert, CiCircleCheck } from 'react-icons/ci';

import LobbyView from '@/components/lobby/LobbyView';
import PodiumView from '@/components/PodiumView';
import StreetView from '@/components/StreetView';
import { shuffle } from '@/components/utils/Functions';
import { Player } from '@/components/utils/types';
import { VotingView } from '@/components/VotingView';

import { adjectives, animals } from '../../../lib/names';
import { supabase } from '../../../lib/supabase';
import { checkAiKeysAvailable } from '../actions';

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

export default function GameRoom({ params }: { params: Promise<{ id: string }> }) {
    const unwrappedParams = use(params);
    const gameId = unwrappedParams.id.toLowerCase();
    const router = useRouter();

    useEffect(() => {
        if (unwrappedParams.id !== gameId) {
            router.replace(`/game/${gameId}`);
        }
    }, [unwrappedParams.id, gameId, router]);

    // Game state
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [status, setStatus] = useState<GameStatus>('lobby');
    const [exclusiveMode, setExclusiveMode] = useState(false);
    const [categories, setCategories] = useState<string[]>([]);
    const [suggestedCategories, setSuggestedCategories] = useState<string[]>([]);
    const [isHost, setIsHost] = useState(false);
    const [gameHostId, setGameHostId] = useState<string>('');
    const [timeLimit, setTimeLimit] = useState(600);
    const [categorySource, setCategorySource] = useState<'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView'>('manual');
    const [generationRadius, setGenerationRadius] = useState<number>(10); // in 100m
    const [generationNumber, setGenerationNumber] = useState<number>(10);
    const [difficulty, setDifficulty] = useState<'default' | 'easy'>('default');
    const [categoriesGenerated, setCategoriesGenerated] = useState<boolean>(false);
    const [apiStatus, setApiStatus] = useState({ aiEnabled: false, mapsEnabled: false, isDeveloper: false });
    const apiStatusRef = useRef({ aiEnabled: false, mapsEnabled: false, isDeveloper: false });

    // Bingo Mode State
    const [gameMode, setGameMode] = useState<'list' | 'bingo'>('list');
    const [teamMode, setTeamMode] = useState<'ffa' | 'teams'>('ffa');
    const [gridSize, setGridSize] = useState(3);
    const [endCondition, setEndCondition] = useState<'first_bingo' | 'timer'>('timer');
    const [startingPoint, setStartingPoint] = useState<string>('open-world');
    const [gameBoundary, setGameBoundary] = useState<string>('[]');

    // Players & Voting
    const [playerId, setPlayerId] = useState<string>('');
    const [players, setPlayers] = useState<Player[]>([]);
    const [onlinePlayers, setOnlinePlayers] = useState<string[]>([]);
    const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
    const [bannedPlayers, setBannedPlayers] = useState<string[]>([]);
    const [gameLoaded, setGameLoaded] = useState(false);

    const [timeLeft, setTimeLeft] = useState<number>(0);

    const timeUpTriggeredRef = useRef(false);
    const pendingOptimisticUpdatesRef = useRef<Set<string>>(new Set());
    const gameEventsChannelRef = useRef<RealtimeChannel | null>(null);
    const playersRef = useRef<Player[]>([]);
    // Run initializeRoom once per game (guards against React strict-mode running
    // the effect twice and racing two initializers).
    const initedGameRef = useRef<string | null>(null);
    // Only treat "I'm not in the players list" as a kick AFTER we've seen
    // ourselves present at least once — otherwise the transient empty reads
    // during startup would bounce us home.
    const confirmedMemberRef = useRef(false);

    // more game options
    const [language, setLanguage] = useState<'german' | 'english'>('german');
    const [hideMapSymbols, setHideMapSymbols] = useState(false);
    const [hideMiniMap, setHideMiniMap] = useState(false);
    const [aiEndGame, setAiEndGame] = useState(true);

    const updateGameModeInfo = (updates: {
        game_mode?: string;
        team_mode?: string;
        time_limit?: number;
        grid_size?: number;
        bingo_board_mode?: 'shared' | 'individual';
        starting_point?: string;
        gameBoundary?: string;
        end_condition?: 'first_bingo' | 'timer';
        hide_map_symbols?: boolean;
        hide_minimap?: boolean;
        ai_end_game?: boolean;
        exclusive_mode?: boolean;
        category_source?: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
        generation_radius?: number;
        generation_number?: number;
        language?: 'english' | 'german';
        difficulty?: 'default' | 'easy';
        categories_generated?: boolean;
    }) => {
        if (!isHost) return;

        // Track which fields we're optimistically updating to prevent subscription from overwriting
        const fieldsToUpdate: string[] = [];

        // Optimistic update: update UI immediately
        if (updates.game_mode) {
            setGameMode(updates.game_mode as 'list' | 'bingo');
            fieldsToUpdate.push('game_mode');
        }
        if (updates.team_mode) {
            setTeamMode(updates.team_mode as 'ffa' | 'teams');
            fieldsToUpdate.push('team_mode');
        }
        if (updates.time_limit) {
            setTimeLimit(updates.time_limit);
            fieldsToUpdate.push('time_limit');
        }
        if (updates.grid_size) {
            setGridSize(updates.grid_size);
            fieldsToUpdate.push('grid_size');
        }
        if (updates.starting_point) {
            setStartingPoint(updates.starting_point);
            fieldsToUpdate.push('starting_point');
        }
        if (updates.gameBoundary) {
            setGameBoundary(updates.gameBoundary);
            fieldsToUpdate.push('gameBoundary');
        }
        if (updates.end_condition) {
            setEndCondition(updates.end_condition as 'first_bingo' | 'timer');
            fieldsToUpdate.push('end_condition');
        }
        if (updates.hide_map_symbols !== undefined) {
            setHideMapSymbols(updates.hide_map_symbols);
            fieldsToUpdate.push('hide_map_symbols');
        }
        if (updates.hide_minimap !== undefined) {
            setHideMiniMap(updates.hide_minimap);
            fieldsToUpdate.push('hide_minimap');
        }
        if (updates.ai_end_game !== undefined) {
            setAiEndGame(updates.ai_end_game);
            fieldsToUpdate.push('ai_end_game');
        }
        if (updates.exclusive_mode !== undefined) {
            setExclusiveMode(updates.exclusive_mode);
            fieldsToUpdate.push('exclusive_mode');
        }
        if (updates.category_source !== undefined) {
            setCategorySource(updates.category_source);
            fieldsToUpdate.push('category_source');
        }
        if (updates.generation_radius !== undefined) {
            setGenerationRadius(updates.generation_radius);
            fieldsToUpdate.push('generation_radius');
        }
        if (updates.generation_number !== undefined) {
            setGenerationNumber(updates.generation_number);
            fieldsToUpdate.push('generation_number');
        }
        if (updates.language !== undefined) {
            setLanguage(updates.language);
            fieldsToUpdate.push('language');
        }
        if (updates.difficulty !== undefined) {
            setDifficulty(updates.difficulty);
            fieldsToUpdate.push('difficulty');
        }
        if (updates.categories_generated !== undefined) {
            setCategoriesGenerated(updates.categories_generated);
            fieldsToUpdate.push('categories_generated');
        }

        // Add to pending optimistic updates to prevent subscription from overwriting
        fieldsToUpdate.forEach((field) => pendingOptimisticUpdatesRef.current.add(field));

        // Background DB update: fire-and-forget without awaiting
        (async () => {
            try {
                // The RPC reports logical failures (NOT_HOST / NO_VALID_KEYS) in
                // its returned payload, not as a PostgREST error, so check both.
                const { data, error } = await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: gameHostId, p_patch: updates });
                if (error || (data && data.success === false)) {
                    console.error('Failed to update game settings:', error || data?.error);
                    toast.error('Failed to save settings');
                }
            } catch (err) {
                console.error('Failed to update game settings:', err);
                toast.error('Failed to save settings');
            } finally {
                // Clear pending updates after a delay to allow subscription to process
                setTimeout(() => {
                    fieldsToUpdate.forEach((field) => pendingOptimisticUpdatesRef.current.delete(field));
                }, 500);
            }
        })();
    };

    useEffect(() => {
        checkAiKeysAvailable().then((status) => {
            setApiStatus(status);
            apiStatusRef.current = status;
        });
        let localId = sessionStorage.getItem('geoBingoSessionUUID');
        if (!localId) {
            localId = crypto.randomUUID();
            sessionStorage.setItem('geoBingoSessionUUID', localId);
        }

        setPlayerId(localId);

        const currentPlayerId = localId;

        const initializeRoom = async () => {
            const storedName = localStorage.getItem('geoBingoPlayerName') || '';
            const playerName = storedName.trim() && storedName !== 'Unknown Player' ? storedName : `${adjectives[Math.floor(Math.random() * adjectives.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
            if (!storedName.trim() || storedName === 'Unknown Player') {
                localStorage.setItem('geoBingoPlayerName', playerName);
            }

            console.log('[GameRoom] Initializing room for gameId:', gameId, 'at', new Date().toISOString());

            const [gameResponse, playerResponse] = await Promise.all([supabase.from('games').select('*').eq('id', gameId).single(), supabase.from('players').select('id, bingo_board').eq('id', currentPlayerId).single()]);

            let gameData = gameResponse.data;
            const existingPlayer = playerResponse.data;

            // Kick Check
            if (gameData?.banned_players?.includes(currentPlayerId)) {
                toast('You have been kicked from this lobby.');
                setTimeout(() => router.push('/'), 2000);
                return;
            }

            // Setup or Load the Game Room
            let justCreated = false;
            if (!gameData) {
                const newGameData = {
                    id: gameId,
                    status: 'lobby',
                    categories: ['', '', '', '', ''],
                    ready_players: [],
                    time_limit: 600,
                    host_id: currentPlayerId,
                    banned_players: [],
                    game_mode: 'list',
                    team_mode: 'ffa',
                    grid_size: 3,
                    starting_point: 'open-world',
                    end_condition: 'timer',
                    hide_map_symbols: false,
                    ai_end_game: false,
                    exclusive_mode: false,
                    category_source: 'manual',
                    generation_radius: 10,
                    generation_number: 10,
                    language: 'german',
                    categories_generated: false,
                };
                const { error } = await supabase.from('games').insert([newGameData]);
                if (!error) {
                    justCreated = true;
                    setIsHost(true);
                    setGameHostId(currentPlayerId);
                    gameData = newGameData;
                    localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                } else {
                    // A concurrent initializer already created this room — React
                    // strict mode runs this effect twice in dev, and two clients can
                    // open the same fresh code at once. Re-fetch the now-existing row
                    // and fall through to the load path instead of leaving gameData null.
                    const { data: refetched } = await supabase.from('games').select('*').eq('id', gameId).single();
                    gameData = refetched;
                }
            }

            if (!gameData) {
                console.error('CRITICAL: game unavailable after init', gameId);
                return;
            }

            if (!justCreated) {
                console.log('[GameRoom] Loading existing game, status:', gameData.status);
                setLastUpdated(gameData.updated_at);
                setStatus(gameData.status || 'lobby');
                setCategories(gameData.categories || []);
                setSuggestedCategories(gameData.suggested_categories || []);
                setReadyPlayers(gameData.ready_players || []);
                setBannedPlayers(gameData.banned_players || []);
                setTimeLimit(gameData.time_limit || 600);
                setGameHostId(gameData.host_id || '');
                setGameMode(gameData.game_mode || 'list');
                setTeamMode(gameData.team_mode || 'ffa');
                setGridSize(gameData.grid_size || 3);
                setStartingPoint(gameData.starting_point || 'open-world');
                setGameBoundary(gameData.gameBoundary || '[]');
                setEndCondition(gameData.end_condition || 'timer');
                setHideMapSymbols(gameData.hide_map_symbols || false);
                setHideMiniMap(gameData.hide_minimap || false);
                setAiEndGame(gameData.ai_end_game ?? false);
                setExclusiveMode(gameData.exclusive_mode || false);
                setCategorySource(gameData.category_source || 'manual');
                setGenerationRadius(gameData.generation_radius || 10);
                setGenerationNumber(gameData.generation_number || 10);
                setLanguage(gameData.language || 'german');
                setCategoriesGenerated(gameData.categories_generated || false);

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
                    const { data: otherPlayers } = await supabase.from('players').select('bingo_board').eq('game_id', gameId).not('bingo_board', 'is', null).limit(1);

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
                const insertData = {
                    id: currentPlayerId,
                    game_id: gameId,
                    name: playerName,
                    ...(bingoBoardToAssign && { bingo_board: bingoBoardToAssign }),
                };
                const { error: playerInsertErr } = await supabase.from('players').insert([insertData]);
                // 23505 = this player row was already inserted by a concurrent init
                // (strict-mode double effect); that's benign, not a failure.
                if (playerInsertErr && playerInsertErr.code !== '23505') console.error('CRITICAL: Failed to insert player.', playerInsertErr);
            } else {
                const shouldAssignBoard = (!existingPlayer.bingo_board || existingPlayer.bingo_board.length === 0) && bingoBoardToAssign;
                // A session's player UUID is reused across games (one row, keyed
                // by the session UUID), so re-joining/switching games has to move
                // that row to the current game by patching game_id — otherwise the
                // player stays stuck in their previous game and fetchPlayers here
                // never sees them.
                const updateData = {
                    name: playerName,
                    game_id: gameId,
                    ...(shouldAssignBoard && { bingo_board: bingoBoardToAssign }),
                };
                const { data: updateRes, error: playerUpdateErr } = await supabase.rpc('update_player', { p_id: currentPlayerId, p_patch: updateData });
                if (playerUpdateErr) {
                    console.error('CRITICAL: Failed to update player.', playerUpdateErr);
                } else if (updateRes && updateRes.success === false) {
                    // The join was refused server-side (banned, or trying to join a
                    // game that's already in progress without having been in it).
                    if (updateRes.error === 'BANNED') toast('You have been banned from this lobby.');
                    else if (updateRes.error === 'GAME_IN_PROGRESS') toast('This game has already started.');
                    else toast('Could not join this game.');
                    setTimeout(() => router.push('/'), 1500);
                    return;
                }
            }

            fetchPlayers();
            console.log('[GameRoom] Init complete, gameLoaded=true at', new Date().toISOString());
            setGameLoaded(true);
        };

        const fetchPlayers = async () => {
            const { data } = await supabase.from('players').select('id, name, bingo_board, team').eq('game_id', gameId);
            if (data) {
                setPlayers(data);
                if (data.some((p) => p.id === currentPlayerId)) {
                    confirmedMemberRef.current = true;
                } else if (confirmedMemberRef.current) {
                    // We were in the game and now we're gone → actually kicked.
                    // (A "not present yet" read during startup must not bounce us.)
                    router.push('/');
                }
            }
        };

        // Run init once per game. React strict mode mounts the effect twice in
        // dev; without this guard both runs race (duplicate game/player inserts,
        // 409s, and a premature kick-redirect). The realtime channels below still
        // (re)subscribe every mount since the cleanup tears them down.
        if (initedGameRef.current !== gameId) {
            initedGameRef.current = gameId;
            confirmedMemberRef.current = false;
            initializeRoom();
        }

        // Realtime Listeners
        const gameChannel = supabase
            .channel(`game-updates-${gameId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'games',
                    filter: `id=eq.${gameId}`,
                },
                (payload) => {
                    if (payload.new.banned_players?.includes(currentPlayerId)) {
                        router.push('/');
                        return;
                    }

                    if (payload.new.host_id !== undefined) {
                        const newHostId = payload.new.host_id;
                        setGameHostId(newHostId);
                        setIsHost(newHostId === currentPlayerId);
                        if (newHostId === currentPlayerId) {
                            localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                        } else {
                            localStorage.removeItem(`geoBingoHost_${gameId}`);
                        }
                    }

                    if (payload.new.updated_at !== undefined) setLastUpdated(payload.new.updated_at);
                    if (payload.new.status !== undefined) {
                        console.log('[GameRoom] Subscription status update:', payload.new.status, 'at', new Date().toISOString());
                        setStatus(payload.new.status);
                    }
                    if (payload.new.categories !== undefined) setCategories(payload.new.categories);
                    if (payload.new.suggested_categories !== undefined) setSuggestedCategories(payload.new.suggested_categories);
                    if (payload.new.ready_players !== undefined) setReadyPlayers(payload.new.ready_players);
                    if (payload.new.banned_players !== undefined) setBannedPlayers(payload.new.banned_players);
                    if (payload.new.time_limit !== undefined && !pendingOptimisticUpdatesRef.current.has('time_limit')) setTimeLimit(payload.new.time_limit);
                    if (payload.new.game_mode !== undefined && !pendingOptimisticUpdatesRef.current.has('game_mode')) setGameMode(payload.new.game_mode);
                    if (payload.new.team_mode !== undefined && !pendingOptimisticUpdatesRef.current.has('team_mode')) setTeamMode(payload.new.team_mode);
                    if (payload.new.grid_size !== undefined && !pendingOptimisticUpdatesRef.current.has('grid_size')) setGridSize(payload.new.grid_size);
                    if (payload.new.starting_point !== undefined && !pendingOptimisticUpdatesRef.current.has('starting_point')) setStartingPoint(payload.new.starting_point);
                    if (payload.new.gameBoundary !== undefined && !pendingOptimisticUpdatesRef.current.has('gameBoundary')) setGameBoundary(payload.new.gameBoundary);
                    if (payload.new.end_condition !== undefined && !pendingOptimisticUpdatesRef.current.has('end_condition')) setEndCondition(payload.new.end_condition);
                    if (payload.new.hide_map_symbols !== undefined && !pendingOptimisticUpdatesRef.current.has('hide_map_symbols')) setHideMapSymbols(payload.new.hide_map_symbols);
                    if (payload.new.hide_minimap !== undefined && !pendingOptimisticUpdatesRef.current.has('hide_minimap')) setHideMiniMap(payload.new.hide_minimap);
                    if (payload.new.ai_end_game !== undefined && !pendingOptimisticUpdatesRef.current.has('ai_end_game')) setAiEndGame(payload.new.ai_end_game);
                    if (payload.new.exclusive_mode !== undefined && !pendingOptimisticUpdatesRef.current.has('exclusive_mode')) setExclusiveMode(payload.new.exclusive_mode);
                    if (payload.new.category_source !== undefined && !pendingOptimisticUpdatesRef.current.has('category_source')) {
                        setCategorySource(payload.new.category_source);
                    }
                    if (payload.new.generation_radius !== undefined && !pendingOptimisticUpdatesRef.current.has('generation_radius')) setGenerationRadius(payload.new.generation_radius);
                    if (payload.new.generation_number !== undefined && !pendingOptimisticUpdatesRef.current.has('generation_number')) setGenerationNumber(payload.new.generation_number);
                    if (payload.new.language !== undefined && !pendingOptimisticUpdatesRef.current.has('language')) setLanguage(payload.new.language);
                    if (payload.new.difficulty !== undefined && !pendingOptimisticUpdatesRef.current.has('difficulty')) setDifficulty(payload.new.difficulty);
                    if (payload.new.categories_generated !== undefined && !pendingOptimisticUpdatesRef.current.has('categories_generated')) setCategoriesGenerated(payload.new.categories_generated);
                },
            )
            .subscribe();

        const playerChannel = supabase
            .channel(`player-updates-${gameId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'players',
                    filter: `game_id=eq.${gameId}`,
                },
                (payload) => {
                    // Auto-Kick & redirect if we were deleted from the DB
                    if (payload.eventType === 'DELETE' && payload.old.id === currentPlayerId) {
                        router.push('/');
                    } else {
                        fetchPlayers();
                    }
                },
            )
            .subscribe();

        const gameEventsChannel = supabase
            .channel(`game-events-${gameId}`)
            .on('broadcast', { event: 'ai_end_game' }, ({ payload }: { payload: { player_id: string } }) => {
                if (payload.player_id === currentPlayerId) return;
                const playerName = playersRef.current.find((p) => p.id === payload.player_id)?.name || 'A player';
                toast.success(`${playerName} found all categories — round ended!`);
            })
            .on('broadcast', { event: 'ai_generating_categories' }, ({ payload }: { payload: { player_id: string } }) => {
                if (payload.player_id === currentPlayerId) return;
                toast('Game starting — AI is generating categories...');
            })
            .subscribe();
        gameEventsChannelRef.current = gameEventsChannel;

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
            supabase.removeChannel(gameEventsChannel);
            gameEventsChannelRef.current = null;
            pendingOptimisticUpdatesRef.current.clear();
        };
    }, [gameId, router]);

    useEffect(() => {
        playersRef.current = players;
    }, [players]);

    const notifyGameEvent = useCallback((event: 'ai_end_game' | 'ai_generating_categories', payload: { player_id: string }) => {
        gameEventsChannelRef.current?.send({ type: 'broadcast', event, payload });
    }, []);

    // Status update handler (host-only path; uses the SECURITY DEFINER rpc so
    // we don't depend on table-level UPDATE policies staying open).
    const updateStatus = useCallback(
        async (nextStatus: GameStatus) => {
            // set_game_status returns NOT_HOST / BAD_STATUS in its payload rather
            // than as a PostgREST error, so check data.success too — otherwise a
            // rejected transition (e.g. the timer auto-advance) silently no-ops.
            const { data, error } = await supabase.rpc('set_game_status', { p_game_id: gameId, p_host_id: gameHostId, p_status: nextStatus });
            if (error || (data && data.success === false)) console.error('Error updating game status:', error || data?.error);
        },
        [gameId, gameHostId],
    );

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

            const endTs = hasValidStored ? Number(rawStored) : now + timeLimit * 1000;

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

    const kickPlayer = async (idToKick: string) => {
        if (isHost) {
            setPlayers((prev) => prev.filter((p) => p.id !== idToKick));

            const { data, error } = await supabase.rpc('delete_player', { p_id: idToKick, p_host_id: gameHostId });

            if (error || (data && data.success === false)) {
                console.error('Error deleting player:', error || data?.error);
            }

            // Also remove them from ready_players if they were ready
            if (readyPlayers.includes(idToKick)) {
                const updatedReady = readyPlayers.filter((id) => id !== idToKick);
                await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: gameHostId, p_patch: { ready_players: updatedReady } });
            }
        }
    };

    const makeHost = async (newHostId: string) => {
        if (isHost) {
            const { error } = await supabase.rpc('transfer_host', { p_game_id: gameId, p_current_host_id: gameHostId, p_new_host_id: newHostId });
            if (error) {
                console.error('Failed to transfer host:', error);
                return;
            }
            setIsHost(false);
            localStorage.removeItem(`geoBingoHost_${gameId}`);
            toast('You are no longer the host.');
        }
    };

    const banPlayer = async (idToKick: string) => {
        if (isHost) {
            setPlayers((prev) => prev.filter((p) => p.id !== idToKick));

            // Add to banned list in the DB
            const updatedBanned = [...bannedPlayers, idToKick];
            await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: gameHostId, p_patch: { banned_players: updatedBanned } });

            const { data, error } = await supabase.rpc('delete_player', { p_id: idToKick, p_host_id: gameHostId });

            if (error || (data && data.success === false)) {
                console.error('Error deleting player:', error || data?.error);
            }

            // Also remove them from ready_players if they were ready
            if (readyPlayers.includes(idToKick)) {
                const updatedReady = readyPlayers.filter((id) => id !== idToKick);
                await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: gameHostId, p_patch: { ready_players: updatedReady } });
            }
        }
    };

    const handleFinishGame = async () => {
        await supabase.rpc('set_game_status', { p_game_id: gameId, p_host_id: gameHostId, p_status: 'finished' });
    };

    const handleVoteEndOptimistic = useCallback(() => {
        const updatedReadyPlayers = [...readyPlayers, playerId];
        const votesNeeded = players.length;

        setReadyPlayers(updatedReadyPlayers);

        if (updatedReadyPlayers.length >= votesNeeded) {
            setStatus('voting');
        }

        pendingOptimisticUpdatesRef.current.add('ready_players');
        if (updatedReadyPlayers.length >= votesNeeded) {
            pendingOptimisticUpdatesRef.current.add('status');
        }

        // player_vote_to_end_round handles the dedup-append to ready_players
        // and the status='voting' transition atomically when the last player votes.
        (async () => {
            try {
                await supabase.rpc('player_vote_to_end_round', { p_game_id: gameId, p_player_id: playerId });
            } catch (err) {
                console.error('Failed to vote:', err);
            } finally {
                setTimeout(() => {
                    pendingOptimisticUpdatesRef.current.delete('ready_players');
                    pendingOptimisticUpdatesRef.current.delete('status');
                }, 500);
            }
        })();
    }, [gameId, playerId, readyPlayers, players.length]);

    const selectView = () => {
        // --- VIEW 1: LOBBY ---
        if (status === 'lobby') {
            return (
                <LobbyView
                    lastUpdated={lastUpdated}
                    gameMode={gameMode}
                    teamMode={teamMode}
                    isHost={isHost}
                    gridSize={gridSize}
                    startingPoint={startingPoint}
                    endCondition={endCondition}
                    gameBoundary={gameBoundary}
                    updateGameModeInfo={updateGameModeInfo}
                    timeLimit={timeLimit}
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
                    hideMiniMap={hideMiniMap}
                    aiEndGame={aiEndGame}
                    categorySource={categorySource}
                    aiEnabled={apiStatus.aiEnabled}
                    isDeveloper={apiStatus.isDeveloper}
                    generationRadius={generationRadius}
                    generationNumber={generationNumber}
                    language={language}
                    difficulty={difficulty}
                    categoriesGenerated={categoriesGenerated}
                    notifyGameEvent={notifyGameEvent}
                />
            );
        }

        // --- VIEW 2: PLAYING ---
        if (status === 'playing') {
            const currentPlayer = players.find((p) => p.id === playerId);
            const myBoard = gameMode === 'bingo' && currentPlayer?.bingo_board && currentPlayer.bingo_board.length > 0 ? currentPlayer.bingo_board : categories;
            return <StreetView myBoard={myBoard} gameId={gameId} playerId={playerId} gameMode={gameMode} teamMode={teamMode} gridSize={gridSize} startingPoint={startingPoint} gameBoundary={gameBoundary} endCondition={endCondition} timeLeft={timeLeft} readyPlayers={readyPlayers} players={players} hideMapSymbols={hideMapSymbols} hideMiniMap={hideMiniMap} exclusiveMode={exclusiveMode} aiEndGame={aiEndGame} onVoteEnd={handleVoteEndOptimistic} notifyGameEvent={notifyGameEvent} />;
        }

        // --- VIEW 3: VOTING ---
        if (status === 'voting') {
            return <VotingView gameId={gameId} isHost={isHost} categories={categories} playerId={playerId} players={players} teamMode={teamMode} onFinishGame={handleFinishGame} />;
        }

        // --- VIEW 4: PODIUM (FINISHED) ---
        if (status === 'finished') {
            return <PodiumView gameId={gameId} gameHostId={gameHostId} isHost={isHost} teamMode={teamMode} />;
        }
    };

    return (
        <>
            <Toaster
                toastOptions={{
                    style: {
                        borderRadius: '20px',
                        background: '#333',
                        color: '#fff',
                    },
                    success: {
                        icon: <CiCircleCheck size="3em" color="#00b01d" />,
                        style: {
                            color: '#00b01d',
                        },
                    },
                    error: {
                        icon: <CiCircleAlert size="3em" color="#ff0000" />,
                        style: {
                            color: '#ff0000',
                        },
                        duration: 5000,
                    },
                }}
            />
            {selectView()}
        </>
    );
}
