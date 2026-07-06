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

import { useState, use, useEffect, useRef, useCallback, useMemo } from 'react';

import type { RealtimeChannel } from '@supabase/supabase-js';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';
import { CiCircleAlert, CiCircleCheck } from 'react-icons/ci';

import NamePrompt from '@/components/game/NamePrompt';
import LobbyView from '@/components/lobby/LobbyView';
import { buildHintMap } from '@/components/streetview/streetViewHelpers';
import { ErrorBoundary } from '@/components/utils/ErrorBoundary';
import { shuffle } from '@/components/utils/Functions';
import { Player } from '@/components/utils/types';
import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import { categoryLanguageForLocale, CategoryLanguage, defaultCategoryLanguage, normalizeLocale, storeCategoryLanguage } from '@/lib/i18n/locales';

import { getHostToken, newHostToken, clearHostToken } from '../../../lib/hostToken';
import { adjectives, animals } from '../../../lib/names';
import { supabase } from '../../../lib/supabase';
import { checkAiKeysAvailable } from '../actions';

// Phase views are code-split: only the lobby (the first thing every player
// sees) ships in the initial bundle. StreetView/VotingView/PodiumView load
// lazily when the game actually transitions, cutting the initial load time.
const phaseLoading = () => (
    <div className="min-h-dvh flex items-center justify-center bg-slate-900">
        <div className="h-10 w-10 rounded-full border-4 border-slate-700 border-t-indigo-500 animate-spin" aria-label="Loading" />
    </div>
);
const StreetView = dynamic(() => import('@/components/streetview/StreetView'), { ssr: false, loading: phaseLoading });
const VotingView = dynamic(() => import('@/components/VotingView').then((m) => m.VotingView), { ssr: false, loading: phaseLoading });
const PodiumView = dynamic(() => import('@/components/PodiumView'), { ssr: false, loading: phaseLoading });

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

export default function GameRoom({ params }: { params: Promise<{ id: string }> }) {
    const unwrappedParams = use(params);
    const gameId = unwrappedParams.id.toLowerCase();
    const router = useRouter();
    const { t, locale } = useT();

    useEffect(() => {
        if (unwrappedParams.id !== gameId) {
            router.replace(`/game/${gameId}`);
        }
    }, [unwrappedParams.id, gameId, router]);

    // Game state
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [status, setStatus] = useState<GameStatus>('lobby');
    const [exclusiveMode, setExclusiveMode] = useState(false);
    const [categories, setCategories] = useState<string[]>(['', '', '', '', '', '', '', '', '', '']);
    const [suggestedCategories, setSuggestedCategories] = useState<string[]>([]);
    const [isHost, setIsHost] = useState(false);
    const [gameHostId, setGameHostId] = useState<string>('');
    const [timeLimit, setTimeLimit] = useState(600);
    const [categorySource, setCategorySource] = useState<'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView'>('manual');
    const [generationRadius, setGenerationRadius] = useState<number>(10); // in 100m
    const [generationNumber, setGenerationNumber] = useState<number>(10);
    const [difficulty, setDifficulty] = useState<'default' | 'easy' | 'hard'>('default');
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
    const [nameGate, setNameGate] = useState<'checking' | 'prompt' | 'ready'>('checking');

    const [timeLeft, setTimeLeft] = useState<number>(0);

    const timeUpTriggeredRef = useRef(false);
    const pendingOptimisticUpdatesRef = useRef<Set<string>>(new Set());
    const gameEventsChannelRef = useRef<RealtimeChannel | null>(null);
    const playersRef = useRef<Player[]>([]);
    const initedGameRef = useRef<string | null>(null);
    const gameHostIdRef = useRef<string>('');
    const confirmedMemberRef = useRef(false);

    // more game options
    const [language, setLanguage] = useState<CategoryLanguage>('german');
    const [categoryTranslations, setCategoryTranslations] = useState<Record<string, string[]>>({});
    const [categoryHintTranslations, setCategoryHintTranslations] = useState<Record<string, string[]>>({});
    const [hideMapSymbols, setHideMapSymbols] = useState(false);
    const [hideMiniMap, setHideMiniMap] = useState(false);
    const [aiEndGame, setAiEndGame] = useState(true);
    const [scaleVoting, setScaleVoting] = useState(false);

    // (Re)register this client's host capability secret with the server. Used both
    // when a player is promoted to host (a transfer DELETEs the previous secret) and
    // as a self-heal when a host RPC unexpectedly reports NOT_HOST. The local token is
    // the source of truth, so we reuse it when present and only mint one if missing.
    const ensureHostSecret = useCallback(async (): Promise<string | null> => {
        const selfId = typeof window !== 'undefined' ? sessionStorage.getItem('geoBingoSessionUUID') : null;
        if (!selfId || gameHostIdRef.current !== selfId) return null;
        const token = getHostToken(gameId) ?? newHostToken(gameId);
        const { data, error } = await supabase.rpc('register_host_secret', { p_game_id: gameId, p_player_id: selfId, p_token: token });
        if (error || (data && data.success === false)) {
            console.error('Failed to register host secret:', error || data?.error);
            return null;
        }
        return token;
    }, [gameId]);

    // Run a host-gated RPC, passing the current host token. If the server reports
    // NOT_HOST while we still believe we're the host (e.g. our secret went missing
    // after a host transfer), re-register the secret and retry once.
    const withHostRetry = useCallback(
        async (run: (token: string | null) => PromiseLike<{ data: { success?: boolean; error?: string } | null; error: unknown }>) => {
            let result = await run(getHostToken(gameId));
            const notHost = !result.error && result.data?.success === false && result.data?.error === 'NOT_HOST';
            if (notHost) {
                const token = await ensureHostSecret();
                if (token) result = await run(token);
            }
            return result;
        },
        [gameId, ensureHostSecret],
    );

    const updateGameModeInfo = (updates: {
        game_mode?: string;
        team_mode?: string;
        categories?: string[];
        suggested_categories?: string[];
        category_details?: unknown;
        time_limit?: number;
        grid_size?: number;
        starting_point?: string;
        gameBoundary?: string;
        end_condition?: 'first_bingo' | 'timer';
        hide_map_symbols?: boolean;
        hide_minimap?: boolean;
        ai_end_game?: boolean;
        exclusive_mode?: boolean;
        scale_voting?: boolean;
        category_source?: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
        generation_radius?: number;
        generation_number?: number;
        language?: CategoryLanguage;
        difficulty?: 'default' | 'easy' | 'hard';
        categories_generated?: boolean;
    }) => {
        if (!isHost) return;

        // Optimistic update: update UI immediately. The host is the sole writer of
        // settings (all fields go through the host-only update_game_settings RPC),
        // so the host's local state is authoritative and never reconciled against
        // its own Realtime echo (see the games subscription, which only applies
        // settings for non-hosts). That makes this the single source of truth.
        if (updates.game_mode) setGameMode(updates.game_mode as 'list' | 'bingo');
        if (updates.team_mode) setTeamMode(updates.team_mode as 'ffa' | 'teams');
        if (updates.categories) setCategories(updates.categories);
        if (updates.suggested_categories !== undefined) setSuggestedCategories(updates.suggested_categories);
        if (updates.time_limit) setTimeLimit(updates.time_limit);
        if (updates.grid_size) setGridSize(updates.grid_size);
        if (updates.starting_point) setStartingPoint(updates.starting_point);
        if (updates.gameBoundary) setGameBoundary(updates.gameBoundary);
        if (updates.end_condition) setEndCondition(updates.end_condition as 'first_bingo' | 'timer');
        if (updates.hide_map_symbols !== undefined) setHideMapSymbols(updates.hide_map_symbols);
        if (updates.hide_minimap !== undefined) setHideMiniMap(updates.hide_minimap);
        if (updates.ai_end_game !== undefined) setAiEndGame(updates.ai_end_game);
        if (updates.exclusive_mode !== undefined) setExclusiveMode(updates.exclusive_mode);
        if (updates.scale_voting !== undefined) setScaleVoting(updates.scale_voting);
        if (updates.category_source !== undefined) setCategorySource(updates.category_source);
        if (updates.generation_radius !== undefined) setGenerationRadius(updates.generation_radius);
        if (updates.generation_number !== undefined) setGenerationNumber(updates.generation_number);
        if (updates.language !== undefined) setLanguage(updates.language);
        if (updates.difficulty !== undefined) setDifficulty(updates.difficulty);
        if (updates.categories_generated !== undefined) setCategoriesGenerated(updates.categories_generated);

        // Background DB update: fire-and-forget without awaiting
        (async () => {
            try {
                // The RPC reports logical failures (NOT_HOST / NO_VALID_KEYS) in
                // its returned payload, not as a PostgREST error, so check both.
                const { data, error } = await withHostRetry((token) => supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: token, p_patch: updates }));
                if (error || (data && data.success === false)) {
                    console.error('Failed to update game settings:', error || data?.error);
                    toast.error(t('game.failedSaveSettings'));
                }
            } catch (err) {
                console.error('Failed to update game settings:', err);
                toast.error(t('game.failedSaveSettings'));
            }
        })();
    };

    // Switch the shared board language. Reuse the imported preset's aligned
    // translations when the board still matches them; otherwise DeepL-translate the
    // current category names. Always updates language + categories together.
    const handleBoardLanguageChange = async (newLang: CategoryLanguage) => {
        if (!isHost) return;
        const newLocale = normalizeLocale(newLang);
        const curLocale = normalizeLocale(language);
        if (newLocale === curLocale) return;

        // Remember this choice so future new games default to it (not the UI locale).
        storeCategoryLanguage(newLang);

        const cats = categories;
        const sugg = suggestedCategories;
        const nonEmptyCats = cats.filter((c) => c.trim());
        const nonEmptySugg = sugg.filter((c) => c.trim());
        if (nonEmptyCats.length === 0 && nonEmptySugg.length === 0) {
            updateGameModeInfo({ language: newLang });
            return;
        }

        // Reuse: the imported preset's aligned category translations, when the board
        // still matches the stored source-locale list exactly (suggestions have no
        // pre-aligned translations, so they always go through DeepL below).
        const srcList = categoryTranslations[curLocale];
        const tgtList = categoryTranslations[newLocale];
        const canReuseCats = Array.isArray(srcList) && Array.isArray(tgtList) && srcList.length === cats.length && srcList.every((v, i) => v === cats[i]);

        // DeepL — translate the categories (unless reused) and the suggestion pool
        // together in one call, preserving each list's positions.
        try {
            const texts = [...(canReuseCats ? [] : nonEmptyCats), ...nonEmptySugg];
            let translatedCats: string[] | null = canReuseCats ? tgtList : null;
            let translatedSugg: string[] | null = null;

            if (texts.length > 0) {
                const res = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ texts, targetLangs: [newLocale], sourceLang: curLocale }),
                });
                if (res.ok) {
                    const data = await res.json();
                    const arr = data?.translations?.[newLocale];
                    if (Array.isArray(arr) && arr.length === texts.length) {
                        let offset = 0;
                        if (!canReuseCats) {
                            const catSlice = arr.slice(0, nonEmptyCats.length);
                            let k = 0;
                            translatedCats = cats.map((c) => (c.trim() ? catSlice[k++] : c));
                            offset = nonEmptyCats.length;
                        }
                        const suggSlice = arr.slice(offset);
                        let m = 0;
                        translatedSugg = sugg.map((c) => (c.trim() ? suggSlice[m++] : c));
                    }
                }
            }

            const updates: Parameters<typeof updateGameModeInfo>[0] = { language: newLang };
            if (translatedCats) updates.categories = translatedCats;
            if (translatedSugg) updates.suggested_categories = translatedSugg;
            updateGameModeInfo(updates);
        } catch {
            updateGameModeInfo({ language: newLang });
        }
    };

    const prevLocaleRef = useRef(locale);

    useEffect(() => {
        if (prevLocaleRef.current === locale) return;
        prevLocaleRef.current = locale;
        if (!isHost) return;
        const nextLanguage = categoryLanguageForLocale(locale);
        if (nextLanguage !== language) handleBoardLanguageChange(nextLanguage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locale, isHost, language]);

    useEffect(() => {
        const storedName = localStorage.getItem('geoBingoPlayerName') || '';
        setNameGate(storedName.trim() && storedName !== 'Unknown Player' ? 'ready' : 'prompt');
    }, []);

    const handleNameSubmit = useCallback((name: string) => {
        localStorage.setItem('geoBingoPlayerName', name);
        setNameGate('ready');
    }, []);

    useEffect(() => {
        if (nameGate !== 'ready') return;
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
                toast(t('game.kicked'));
                setTimeout(() => router.push('/'), 2000);
                return;
            }

            // Setup or Load the Game Room
            let justCreated = false;
            if (!gameData) {
                // Fork-on-import: arriving via /game/<id>?preset=<presetId> seeds the
                // fresh room from a community preset (category names + boundaries +
                // starting point). The import is a copy — it never touches the preset.
                let seedCategories: string[] | null = null;
                let seedBoundary: string | null = null;
                let seedStartingPoint: string | null = null;
                let seedGameMode: string | null = null;
                let seedGridSize: number | null = null;
                let seedTimeLimit: number | null = null;
                let seedSettings: { hideMiniMap?: boolean; hideMapSymbols?: boolean; exclusiveMode?: boolean; aiEndGame?: boolean; endCondition?: string; scaleVoting?: boolean } = {};
                let seedCategoryTranslations: Record<string, string[]> = {};
                let seedCategoryHintTranslations: Record<string, string[]> = {};
                let seedPresetPositions: { categoryName: string; lat: number; lng: number }[] = [];
                const presetId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('preset') : null;
                if (presetId) {
                    const { data: preset, error: presetError } = await supabase.from('community_presets').select('*').eq('id', presetId).maybeSingle();
                    if (presetError) console.error('[GameRoom] preset import read failed:', presetError);
                    if (preset) {
                        const originals = Array.isArray(preset.categories) ? (preset.categories as { categoryName?: string }[]).map((c) => c.categoryName || '') : [];
                        const translatedList = (preset.category_translations as Record<string, string[]> | null)?.[locale];
                        const names = (Array.isArray(translatedList) && translatedList.length === originals.length ? translatedList : originals).filter(Boolean);
                        if (names.length) seedCategories = names;
                        if (preset.boundaries) seedBoundary = JSON.stringify(preset.boundaries);
                        if (preset.starting_point) seedStartingPoint = preset.starting_point;
                        if (preset.game_mode) seedGameMode = preset.game_mode;
                        if (preset.grid_size) seedGridSize = preset.grid_size;
                        if (preset.recommended_time) seedTimeLimit = preset.recommended_time;
                        if (preset.settings && typeof preset.settings === 'object') seedSettings = preset.settings;
                        if (preset.category_translations && typeof preset.category_translations === 'object') seedCategoryTranslations = preset.category_translations as Record<string, string[]>;
                        if (preset.category_hint_translations && typeof preset.category_hint_translations === 'object') seedCategoryHintTranslations = preset.category_hint_translations as Record<string, string[]>;
                        if (Array.isArray(preset.categories)) {
                            seedPresetPositions = (preset.categories as Array<{ categoryName?: string; lat?: number; lng?: number }>).filter((c) => c && typeof c.lat === 'number' && typeof c.lng === 'number').map((c) => ({ categoryName: c.categoryName || '', lat: c.lat as number, lng: c.lng as number }));
                        }
                    }
                }

                const newGameData = {
                    id: gameId,
                    status: 'lobby',
                    categories: seedCategories ?? ['', '', '', '', '', '', '', '', '', ''],
                    ready_players: [],
                    time_limit: seedTimeLimit ?? 600,
                    host_id: currentPlayerId,
                    banned_players: [],
                    game_mode: seedGameMode ?? 'list',
                    team_mode: 'ffa',
                    grid_size: seedGridSize ?? 3,
                    starting_point: seedStartingPoint ?? 'open-world',
                    gameBoundary: seedBoundary ?? '[]',
                    end_condition: seedSettings.endCondition === 'first_bingo' ? 'first_bingo' : 'timer',
                    hide_minimap: seedSettings.hideMiniMap ?? false,
                    hide_map_symbols: seedSettings.hideMapSymbols ?? false,
                    ai_end_game: seedSettings.aiEndGame ?? false,
                    exclusive_mode: seedSettings.exclusiveMode ?? false,
                    scale_voting: seedSettings.scaleVoting ?? false,
                    category_source: 'manual',
                    generation_radius: 10,
                    generation_number: 10,
                    language: defaultCategoryLanguage(locale),
                    categories_generated: false,
                };
                const optionalCols: Record<string, unknown> = {};
                if (Object.keys(seedCategoryTranslations).length > 0) optionalCols.category_translations = seedCategoryTranslations;
                if (Object.keys(seedCategoryHintTranslations).length > 0) optionalCols.category_hint_translations = seedCategoryHintTranslations;
                if (seedPresetPositions.length > 0) optionalCols.preset_categories = seedPresetPositions;
                const hasOptionalCols = Object.keys(optionalCols).length > 0;
                let { error } = await supabase.from('games').insert([hasOptionalCols ? { ...newGameData, ...optionalCols } : newGameData]);
                if (error && hasOptionalCols) {
                    console.warn('[GameRoom] optional preset columns not available; importing without persisting them.', error);
                    ({ error } = await supabase.from('games').insert([newGameData]));
                }
                if (!error) {
                    justCreated = true;
                    setIsHost(true);
                    setGameHostId(currentPlayerId);
                    gameHostIdRef.current = currentPlayerId;
                    gameData = newGameData;
                    localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                    setCategories(newGameData.categories);
                    setTimeLimit(newGameData.time_limit);
                    setGameMode(newGameData.game_mode as 'list' | 'bingo');
                    setGridSize(newGameData.grid_size);
                    setStartingPoint(newGameData.starting_point);
                    setGameBoundary(newGameData.gameBoundary);
                    setEndCondition(newGameData.end_condition as 'timer' | 'first_bingo');
                    setHideMapSymbols(newGameData.hide_map_symbols);
                    setHideMiniMap(newGameData.hide_minimap);
                    setAiEndGame(newGameData.ai_end_game);
                    setExclusiveMode(newGameData.exclusive_mode);
                    setScaleVoting(newGameData.scale_voting);
                    setLanguage(newGameData.language as CategoryLanguage);
                    setCategoryTranslations(seedCategoryTranslations);
                    setCategoryHintTranslations(seedCategoryHintTranslations);
                    await supabase.rpc('register_host_secret', { p_game_id: gameId, p_player_id: currentPlayerId, p_token: newHostToken(gameId) });
                } else {
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
                setCategories(gameData.categories || ['', '', '', '', '', '', '', '', '', '']);
                setSuggestedCategories(gameData.suggested_categories || []);
                setReadyPlayers(gameData.ready_players || []);
                setBannedPlayers(gameData.banned_players || []);
                setTimeLimit(gameData.time_limit || 600);
                setGameHostId(gameData.host_id || '');
                gameHostIdRef.current = gameData.host_id || '';
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
                setScaleVoting(gameData.scale_voting || false);
                setCategorySource(gameData.category_source || 'manual');
                setGenerationRadius(gameData.generation_radius || 10);
                setGenerationNumber(gameData.generation_number || 10);
                setLanguage(gameData.language || 'german');
                setCategoryTranslations(gameData.category_translations || {});
                setCategoryHintTranslations(gameData.category_hint_translations || {});
                setCategoriesGenerated(gameData.categories_generated || false);

                const isActuallyHost = gameData.host_id === currentPlayerId;
                setIsHost(isActuallyHost);
                if (isActuallyHost) {
                    localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                    if (!getHostToken(gameId)) {
                        await supabase.rpc('register_host_secret', { p_game_id: gameId, p_player_id: currentPlayerId, p_token: newHostToken(gameId) });
                    }
                } else {
                    localStorage.removeItem(`geoBingoHost_${gameId}`);
                }
            }

            // register player
            let bingoBoardToAssign = null;
            if (gameData.status === 'playing' && gameData.game_mode === 'bingo' && gameData.categories) {
                const neededCount = (gameData.grid_size || 3) * (gameData.grid_size || 3);
                bingoBoardToAssign = shuffle([...gameData.categories]).slice(0, neededCount);
            }

            if (!existingPlayer) {
                // Attribute this player to their account (if signed in) so their
                // profile can record this game's outcome at the finished phase.
                const accountId = FEATURES.playerProfiles ? (await supabase.auth.getUser()).data.user?.id : undefined;
                const insertData = {
                    id: currentPlayerId,
                    game_id: gameId,
                    name: playerName,
                    ...(accountId && { account_id: accountId }),
                    ...(bingoBoardToAssign && { bingo_board: bingoBoardToAssign }),
                };
                const { error: playerInsertErr } = await supabase.from('players').insert([insertData]);
                // 23505 = this player row was already inserted by a concurrent init
                // (strict-mode double effect); that's benign, not a failure.
                if (playerInsertErr && playerInsertErr.code !== '23505') console.error('CRITICAL: Failed to insert player.', playerInsertErr);
            } else {
                const shouldAssignBoard = (!existingPlayer.bingo_board || existingPlayer.bingo_board.length === 0) && bingoBoardToAssign;
                const updateData = {
                    name: playerName,
                    game_id: gameId,
                    ...(shouldAssignBoard && { bingo_board: bingoBoardToAssign }),
                };
                const { data: updateRes, error: playerUpdateErr } = await supabase.rpc('update_player', { p_id: currentPlayerId, p_patch: updateData });
                if (playerUpdateErr) {
                    console.error('CRITICAL: Failed to update player.', playerUpdateErr);
                } else if (updateRes && updateRes.success === false) {
                    if (updateRes.error === 'BANNED') toast(t('game.banned'));
                    else if (updateRes.error === 'GAME_IN_PROGRESS') toast(t('game.alreadyStarted'));
                    else toast(t('game.couldNotJoin'));
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
                    router.push('/');
                }
            }
        };

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
                        const justPromoted = newHostId === currentPlayerId && gameHostIdRef.current !== currentPlayerId;
                        gameHostIdRef.current = newHostId;
                        setGameHostId(newHostId);
                        setIsHost(newHostId === currentPlayerId);
                        if (newHostId === currentPlayerId) {
                            localStorage.setItem(`geoBingoHost_${gameId}`, 'true');
                            if (justPromoted) {
                                // A host transfer DELETEs the previous secret, so the new host
                                // must register its own before any host action works. Retry a
                                // couple of times so a transient failure doesn't leave the new
                                // host unable to act (the symptom is host RPCs returning NOT_HOST).
                                void (async () => {
                                    for (let attempt = 0; attempt < 3; attempt++) {
                                        if (await ensureHostSecret()) return;
                                        await new Promise((r) => setTimeout(r, 500));
                                    }
                                })();
                            }
                        } else {
                            localStorage.removeItem(`geoBingoHost_${gameId}`);
                            clearHostToken(gameId);
                        }
                    }

                    if (payload.new.updated_at !== undefined) setLastUpdated(payload.new.updated_at);
                    if (payload.new.status !== undefined) {
                        console.log('[GameRoom] Subscription status update:', payload.new.status, 'at', new Date().toISOString());
                        setStatus(payload.new.status);
                    }
                    if (payload.new.ready_players !== undefined) setReadyPlayers(payload.new.ready_players);
                    if (payload.new.banned_players !== undefined) setBannedPlayers(payload.new.banned_players);

                    // Settings are written exclusively by the host (via the host-only
                    // update_game_settings RPC), so the host's local state is the source
                    // of truth and must NOT be overwritten by its own Realtime echo —
                    // doing so caused stale echoes to revert fast/rapid edits. Only push
                    // these fields to non-host players.
                    const isHostNow = gameHostIdRef.current === currentPlayerId;
                    if (!isHostNow) {
                        if (payload.new.categories !== undefined) setCategories(payload.new.categories);
                        if (payload.new.suggested_categories !== undefined) setSuggestedCategories(payload.new.suggested_categories);
                        if (payload.new.time_limit !== undefined) setTimeLimit(payload.new.time_limit);
                        if (payload.new.game_mode !== undefined) setGameMode(payload.new.game_mode);
                        if (payload.new.team_mode !== undefined) setTeamMode(payload.new.team_mode);
                        if (payload.new.grid_size !== undefined) setGridSize(payload.new.grid_size);
                        if (payload.new.starting_point !== undefined) setStartingPoint(payload.new.starting_point);
                        if (payload.new.gameBoundary !== undefined) setGameBoundary(payload.new.gameBoundary);
                        if (payload.new.end_condition !== undefined) setEndCondition(payload.new.end_condition);
                        if (payload.new.hide_map_symbols !== undefined) setHideMapSymbols(payload.new.hide_map_symbols);
                        if (payload.new.hide_minimap !== undefined) setHideMiniMap(payload.new.hide_minimap);
                        if (payload.new.ai_end_game !== undefined) setAiEndGame(payload.new.ai_end_game);
                        if (payload.new.exclusive_mode !== undefined) setExclusiveMode(payload.new.exclusive_mode);
                        if (payload.new.scale_voting !== undefined) setScaleVoting(payload.new.scale_voting);
                        if (payload.new.category_source !== undefined) setCategorySource(payload.new.category_source);
                        if (payload.new.generation_radius !== undefined) setGenerationRadius(payload.new.generation_radius);
                        if (payload.new.generation_number !== undefined) setGenerationNumber(payload.new.generation_number);
                        if (payload.new.language !== undefined) setLanguage(payload.new.language);
                        if (payload.new.difficulty !== undefined) setDifficulty(payload.new.difficulty);
                        if (payload.new.categories_generated !== undefined) setCategoriesGenerated(payload.new.categories_generated);
                        if (payload.new.category_hint_translations !== undefined) setCategoryHintTranslations(payload.new.category_hint_translations);
                        if (payload.new.category_translations !== undefined) setCategoryTranslations(payload.new.category_translations);
                    }
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
                const playerName = playersRef.current.find((p) => p.id === payload.player_id)?.name || t('game.unknownPlayer');
                toast.success(t('game.roundEndedFoundAll', { player: playerName }));
            })
            .on('broadcast', { event: 'ai_generating_categories' }, ({ payload }: { payload: { player_id: string } }) => {
                if (payload.player_id === currentPlayerId) return;
                toast(t('game.aiGeneratingCategories'));
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

        const pendingUpdates = pendingOptimisticUpdatesRef.current;
        return () => {
            supabase.removeChannel(gameChannel);
            supabase.removeChannel(playerChannel);
            supabase.removeChannel(presenceChannel);
            supabase.removeChannel(gameEventsChannel);
            gameEventsChannelRef.current = null;
            pendingUpdates.clear();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, router, nameGate]);

    useEffect(() => {
        playersRef.current = players;
    }, [players]);

    useEffect(() => {
        if (!gameLoaded) return;
        if (status === 'lobby') {
            import('@/components/streetview/StreetView').catch(() => {});
        } else if (status === 'playing') {
            import('@/components/VotingView').catch(() => {});
        } else if (status === 'voting') {
            import('@/components/PodiumView').catch(() => {});
        }
    }, [status, gameLoaded]);

    useEffect(() => {
        if (!gameLoaded) return;
        if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preset')) {
            router.replace(`/game/${gameId}`);
        }
    }, [gameLoaded, gameId, router]);

    const notifyGameEvent = useCallback((event: 'ai_end_game' | 'ai_generating_categories', payload: { player_id: string }) => {
        gameEventsChannelRef.current?.send({ type: 'broadcast', event, payload });
    }, []);

    const updateStatus = useCallback(
        async (nextStatus: GameStatus) => {
            const { data, error } = await withHostRetry((token) => supabase.rpc('set_game_status', { p_game_id: gameId, p_host_id: token, p_status: nextStatus }));
            if (error || (data && data.success === false)) console.error('Error updating game status:', error || data?.error);
        },
        [gameId, withHostRetry],
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

            const { data, error } = await withHostRetry((token) => supabase.rpc('delete_player', { p_id: idToKick, p_host_id: token }));

            if (error || (data && data.success === false)) {
                console.error('Error deleting player:', error || data?.error);
            }

            // Also remove them from ready_players if they were ready
            if (readyPlayers.includes(idToKick)) {
                const updatedReady = readyPlayers.filter((id) => id !== idToKick);
                await withHostRetry((token) => supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: token, p_patch: { ready_players: updatedReady } }));
            }
        }
    };

    const makeHost = async (newHostId: string) => {
        if (isHost) {
            const { data, error } = await withHostRetry((token) => supabase.rpc('transfer_host', { p_game_id: gameId, p_current_host_id: token, p_new_host_id: newHostId }));
            if (error || (data && data.success === false)) {
                console.error('Failed to transfer host:', error || data?.error);
                return;
            }
            setIsHost(false);
            localStorage.removeItem(`geoBingoHost_${gameId}`);
            clearHostToken(gameId);
            toast(t('game.noLongerHost'));
        }
    };

    const banPlayer = async (idToKick: string) => {
        if (isHost) {
            setPlayers((prev) => prev.filter((p) => p.id !== idToKick));

            // Add to banned list in the DB
            const updatedBanned = [...bannedPlayers, idToKick];
            await withHostRetry((token) => supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: token, p_patch: { banned_players: updatedBanned } }));

            const { data, error } = await withHostRetry((token) => supabase.rpc('delete_player', { p_id: idToKick, p_host_id: token }));

            if (error || (data && data.success === false)) {
                console.error('Error deleting player:', error || data?.error);
            }

            // Also remove them from ready_players if they were ready
            if (readyPlayers.includes(idToKick)) {
                const updatedReady = readyPlayers.filter((id) => id !== idToKick);
                await withHostRetry((token) => supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: token, p_patch: { ready_players: updatedReady } }));
            }
        }
    };

    const handleFinishGame = async () => {
        await withHostRetry((token) => supabase.rpc('set_game_status', { p_game_id: gameId, p_host_id: token, p_status: 'finished' }));
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

    const hintByCategory = useMemo(() => buildHintMap(categories, categoryHintTranslations, normalizeLocale(language)), [categories, categoryHintTranslations, language]);

    const effectiveExclusiveMode = FEATURES.exclusiveCategories ? exclusiveMode : false;
    const effectiveHideMapSymbols = FEATURES.hideMapSymbols ? hideMapSymbols : false;
    const effectiveHideMiniMap = FEATURES.hideMiniMap ? hideMiniMap : false;
    const effectiveAiEndGame = FEATURES.aiVerifyEndGame ? aiEndGame : false;
    // Scale voting is a list-mode-only feature; a bingo game never rates 0–10.
    const effectiveScaleVoting = FEATURES.scaleVoting && scaleVoting && gameMode === 'list';

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
                    exclusiveMode={effectiveExclusiveMode}
                    categories={categories}
                    suggestedCategories={suggestedCategories}
                    gameId={gameId}
                    players={players}
                    scaleVoting={scaleVoting}
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
                    hideMapSymbols={effectiveHideMapSymbols}
                    hideMiniMap={effectiveHideMiniMap}
                    aiEndGame={effectiveAiEndGame}
                    categorySource={categorySource}
                    aiEnabled={apiStatus.aiEnabled}
                    isDeveloper={apiStatus.isDeveloper}
                    generationRadius={generationRadius}
                    generationNumber={generationNumber}
                    language={language}
                    difficulty={difficulty}
                    categoriesGenerated={categoriesGenerated}
                    notifyGameEvent={notifyGameEvent}
                    onCategoryLanguageChange={handleBoardLanguageChange}
                />
            );
        }

        // --- VIEW 2: PLAYING ---
        if (status === 'playing') {
            const currentPlayer = players.find((p) => p.id === playerId);
            const myBoard = gameMode === 'bingo' && currentPlayer?.bingo_board && currentPlayer.bingo_board.length > 0 ? currentPlayer.bingo_board : categories;
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
                    hideMapSymbols={effectiveHideMapSymbols}
                    hideMiniMap={effectiveHideMiniMap}
                    exclusiveMode={effectiveExclusiveMode}
                    aiEndGame={effectiveAiEndGame}
                    onVoteEnd={handleVoteEndOptimistic}
                    notifyGameEvent={notifyGameEvent}
                    hintByCategory={hintByCategory}
                />
            );
        }

        // --- VIEW 3: VOTING ---
        if (status === 'voting') {
            return <VotingView gameId={gameId} isHost={isHost} categories={categories} playerId={playerId} players={players} teamMode={teamMode} onFinishGame={handleFinishGame} isDeveloper={apiStatus.isDeveloper} hintByCategory={hintByCategory} scaleVoting={effectiveScaleVoting} />;
        }

        // --- VIEW 4: PODIUM (FINISHED) ---
        if (status === 'finished') {
            return <PodiumView gameId={gameId} gameHostId={gameHostId} isHost={isHost} teamMode={teamMode} playerId={playerId} />;
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
            {nameGate === 'checking' ? (
                <div className="min-h-dvh flex items-center justify-center bg-slate-900">
                    <div className="h-10 w-10 rounded-full border-4 border-slate-700 border-t-indigo-500 animate-spin" aria-label="Loading" />
                </div>
            ) : nameGate === 'prompt' ? (
                <NamePrompt onSubmit={handleNameSubmit} />
            ) : (
                <ErrorBoundary key={status}>{selectView()}</ErrorBoundary>
            )}
        </>
    );
}
