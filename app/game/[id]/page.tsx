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
import toast from 'react-hot-toast';

import NamePrompt from '@/components/game/NamePrompt';
import TwitchGate from '@/components/game/TwitchGate';
import LobbyView from '@/components/lobby/LobbyView';
import { buildHintMap } from '@/components/streetview/streetViewHelpers';
import { ErrorBoundary } from '@/components/utils/ErrorBoundary';
import { shuffle } from '@/components/utils/Functions';
import { Player } from '@/components/utils/types';
import type { CategoryVoteModes, VotingMode } from '@/components/utils/votes';
import { track } from '@/lib/analytics';
import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import { categoryLanguageForLocale, CategoryLanguage, defaultCategoryLanguage, isLocale, Locale, normalizeLocale, storeCategoryLanguage } from '@/lib/i18n/locales';
import { clearLastMapPoint } from '@/lib/lastMapPoint';
import { hasTwitchLinked } from '@/lib/twitch';
import { useCategoryLabels } from '@/lib/useCategoryLabels';

import { getHostToken, newHostToken, clearHostToken } from '../../../lib/hostToken';
import { adjectives, animals } from '../../../lib/names';
import { supabase } from '../../../lib/supabase';
import { checkAiKeysAvailable } from '../actions';

// Phase views are code-split: only the lobby (the first thing every player
// sees) ships in the initial bundle. StreetView/VotingView/PodiumView load
// lazily when the game actually transitions, cutting the initial load time.
const phaseLoading = () => (
    <div className="min-h-dvh flex items-center justify-center bg-slate-950">
        <div className="h-10 w-10 rounded-full border-4 border-slate-700 border-t-indigo-500 animate-spin" aria-label="Loading" />
    </div>
);
const StreetView = dynamic(() => import('@/components/streetview/StreetView'), { ssr: false, loading: phaseLoading });
const VotingView = dynamic(() => import('@/components/VotingView').then((m) => m.VotingView), { ssr: false, loading: phaseLoading });
const PodiumView = dynamic(() => import('@/components/PodiumView'), { ssr: false, loading: phaseLoading });

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

type GameRow = {
    banned_players?: string[];
    host_id?: string;
    updated_at?: string;
    status?: GameStatus;
    phase_started_at?: string | null;
    ready_players?: string[];
    categories?: string[];
    suggested_categories?: string[];
    time_limit?: number;
    game_mode?: 'list' | 'bingo';
    team_mode?: 'ffa' | 'teams';
    grid_size?: number;
    starting_point?: string;
    gameBoundary?: string;
    end_condition?: 'timer' | 'first_bingo';
    hide_map_symbols?: boolean;
    hide_minimap?: boolean;
    ai_end_game?: boolean;
    exclusive_mode?: boolean;
    require_twitch?: boolean;
    voting_mode?: VotingMode;
    category_vote_modes?: CategoryVoteModes;
    anonymous_voting?: boolean;
    category_source?: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
    generation_radius?: number;
    language?: CategoryLanguage;
    difficulty?: 'default' | 'easy' | 'hard';
    categories_generated?: boolean;
    category_translations?: Record<string, string[]>;
    category_hint_translations?: Record<string, string[]>;
    translate_categories?: boolean;
};

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
    // Server-stamped start of the current 'playing' phase (games.phase_started_at).
    // Null for games started before the column existed — the timer then falls back
    // to the legacy first-observation + localStorage deadline.
    const [phaseStartedAt, setPhaseStartedAt] = useState<string | null>(null);

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
    const [requireTwitch, setRequireTwitch] = useState(false);
    // Set when a Twitch-gated lobby rejects this (non-host, unlinked) joiner —
    // shows the connect-Twitch screen instead of proceeding with the join.
    const [joinBlocked, setJoinBlocked] = useState<'twitch' | null>(null);
    const [votingMode, setVotingMode] = useState<VotingMode>('yes_no');
    const [categoryVoteModes, setCategoryVoteModes] = useState<CategoryVoteModes>({});
    // Host toggle: hide the submission author's identity during the voting phase.
    const [anonymousVoting, setAnonymousVoting] = useState(false);
    // Host toggle: let each player read the board in their own language.
    const [translateCategories, setTranslateCategories] = useState(false);
    // This viewer's own category display language (independent of the shared
    // board language and of the UI locale). Persisted per device.
    const [displayLocale, setDisplayLocale] = useState<Locale>(locale);

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
        require_twitch?: boolean;
        voting_mode?: VotingMode;
        category_vote_modes?: CategoryVoteModes;
        anonymous_voting?: boolean;
        category_source?: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
        generation_radius?: number;
        language?: CategoryLanguage;
        difficulty?: 'default' | 'easy' | 'hard';
        categories_generated?: boolean;
        translate_categories?: boolean;
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
        if (updates.require_twitch !== undefined) setRequireTwitch(updates.require_twitch);
        if (updates.voting_mode !== undefined) setVotingMode(updates.voting_mode);
        if (updates.category_vote_modes !== undefined) setCategoryVoteModes(updates.category_vote_modes);
        if (updates.anonymous_voting !== undefined) setAnonymousVoting(updates.anonymous_voting);
        if (updates.category_source !== undefined) setCategorySource(updates.category_source);
        if (updates.generation_radius !== undefined) setGenerationRadius(updates.generation_radius);
        if (updates.language !== undefined) setLanguage(updates.language);
        if (updates.difficulty !== undefined) setDifficulty(updates.difficulty);
        if (updates.categories_generated !== undefined) setCategoriesGenerated(updates.categories_generated);
        if (updates.translate_categories !== undefined) setTranslateCategories(updates.translate_categories);

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

    // Restore this device's chosen category display language once on mount.
    useEffect(() => {
        const stored = localStorage.getItem('geoBingoDisplayLocale');
        if (isLocale(stored)) setDisplayLocale(stored);
    }, []);

    // Once this player's row loads, adopt any language they already committed
    // (the durable, cross-device source of truth).
    useEffect(() => {
        const mine = players.find((p) => p.id === playerId)?.category_locale;
        if (isLocale(mine)) setDisplayLocale((cur) => (cur === mine ? cur : mine));
    }, [players, playerId]);

    // Persist the guest's pick to their row so the host can see it (and gate the
    // start button on it). Optimistically reflect it locally right away.
    const handleDisplayLocaleChange = useCallback(
        (next: Locale) => {
            setDisplayLocale(next);
            localStorage.setItem('geoBingoDisplayLocale', next);
            setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, category_locale: next } : p)));
            void (async () => {
                // Surface failures loudly: if this write is silently dropped (e.g. the
                // update_player RPC hasn't been migrated to accept category_locale),
                // the host would wait forever on a guest that looks ready locally.
                const { data, error } = await supabase.rpc('update_player', { p_id: playerId, p_patch: { category_locale: next } });
                if (error || (data && data.success === false)) {
                    console.error('Failed to persist category language:', error || data?.error);
                    toast.error(t('sidebar.languageSaveFailed'));
                }
            })();
        },
        [playerId, t],
    );

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

            // Scope the membership check to THIS game: players.id is unique across all
            // games (the session UUID), so a row left over from a previous game in this
            // session must NOT count as "already in this game" — otherwise we'd take the
            // update_player rejoin path (which rejects a running game with GAME_IN_PROGRESS)
            // instead of the join_game RPC that correctly admits a late joiner.
            const [gameResponse, playerResponse] = await Promise.all([supabase.from('games').select('*').eq('id', gameId).single(), supabase.from('players').select('id, bingo_board').eq('id', currentPlayerId).eq('game_id', gameId).maybeSingle()]);

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
                let seedSettings: { hideMiniMap?: boolean; hideMapSymbols?: boolean; exclusiveMode?: boolean; aiEndGame?: boolean; endCondition?: string; scaleVoting?: boolean; votingMode?: VotingMode } = {};
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
                    voting_mode: seedSettings.votingMode ?? (seedSettings.scaleVoting ? 'scale' : 'yes_no'),
                    category_source: 'manual',
                    generation_radius: 10,
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
                    setRequireTwitch(false);
                    setVotingMode(newGameData.voting_mode);
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
                setPhaseStartedAt(gameData.phase_started_at ?? null);
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
                setRequireTwitch(gameData.require_twitch || false);
                setVotingMode(gameData.voting_mode || 'yes_no');
                setCategoryVoteModes(gameData.category_vote_modes || {});
                setAnonymousVoting(gameData.anonymous_voting || false);
                setTranslateCategories(gameData.translate_categories || false);
                setCategorySource(gameData.category_source || 'manual');
                setGenerationRadius(gameData.generation_radius || 10);
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

            // Twitch gate: a require_twitch lobby only admits players who have
            // linked a Twitch account. The host is exempt (they set the flag).
            // Enforced again server-side by the players INSERT RLS policy; this
            // client check just shows a friendly connect screen instead of a
            // silent RLS rejection. Existing members (re-joiners) are not re-gated.
            if (!existingPlayer && FEATURES.twitchAuth && gameData.require_twitch && gameData.host_id !== currentPlayerId) {
                const linked = await hasTwitchLinked();
                if (!linked) {
                    setJoinBlocked('twitch');
                    setGameLoaded(true);
                    return;
                }
            }

            if (!existingPlayer) {
                // Register through the SECURITY DEFINER join RPC, not a direct
                // insert. A direct insert is blocked by RLS once the game leaves
                // the lobby, which stranded anyone opening the link after the host
                // started (no players row -> NOT_A_PLAYER on every claim/vote).
                // The RPC registers the row for lobby/playing/voting, is idempotent
                // on refresh, and treats a finished game as spectate-only.
                // account_id attributes the player so their profile can record this
                // game's outcome at the finished phase.
                const accountId = FEATURES.playerProfiles ? (await supabase.auth.getUser()).data.user?.id : undefined;
                const { data: joinRes, error: joinErr } = await supabase.rpc('join_game', {
                    p_game_id: gameId,
                    p_player_id: currentPlayerId,
                    p_name: playerName,
                    p_account_id: accountId ?? null,
                    p_bingo_board: bingoBoardToAssign ?? null,
                });
                if (joinErr) {
                    console.error('CRITICAL: Failed to join game.', joinErr);
                } else if (joinRes && joinRes.success === false) {
                    if (joinRes.error === 'BANNED') toast(t('game.banned'));
                    else toast(t('game.couldNotJoin'));
                    setTimeout(() => router.push('/'), 1500);
                    return;
                }
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
            const { data } = await supabase.from('players').select('id, name, bingo_board, team, category_locale').eq('game_id', gameId);
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

        const applyGameRow = (row: GameRow) => {
            if (row.banned_players?.includes(currentPlayerId)) {
                router.push('/');
                return;
            }

            if (row.host_id !== undefined) {
                const newHostId = row.host_id;
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

            if (row.updated_at !== undefined) setLastUpdated(row.updated_at);
            if (row.status !== undefined) {
                console.log('[GameRoom] Subscription status update:', row.status, 'at', new Date().toISOString());
                setStatus(row.status);
            }
            if (row.phase_started_at !== undefined) setPhaseStartedAt(row.phase_started_at);
            if (row.ready_players !== undefined) setReadyPlayers(row.ready_players);
            if (row.banned_players !== undefined) setBannedPlayers(row.banned_players);

            // Settings are written exclusively by the host (via the host-only
            // update_game_settings RPC), so the host's local state is the source
            // of truth and must NOT be overwritten by its own Realtime echo —
            // doing so caused stale echoes to revert fast/rapid edits. Only push
            // these fields to non-host players.
            const isHostNow = gameHostIdRef.current === currentPlayerId;
            if (!isHostNow) {
                if (row.categories !== undefined) setCategories(row.categories);
                if (row.suggested_categories !== undefined) setSuggestedCategories(row.suggested_categories);
                if (row.time_limit !== undefined) setTimeLimit(row.time_limit);
                if (row.game_mode !== undefined) setGameMode(row.game_mode);
                if (row.team_mode !== undefined) setTeamMode(row.team_mode);
                if (row.grid_size !== undefined) setGridSize(row.grid_size);
                if (row.starting_point !== undefined) setStartingPoint(row.starting_point);
                if (row.gameBoundary !== undefined) setGameBoundary(row.gameBoundary);
                if (row.end_condition !== undefined) setEndCondition(row.end_condition);
                if (row.hide_map_symbols !== undefined) setHideMapSymbols(row.hide_map_symbols);
                if (row.hide_minimap !== undefined) setHideMiniMap(row.hide_minimap);
                if (row.ai_end_game !== undefined) setAiEndGame(row.ai_end_game);
                if (row.exclusive_mode !== undefined) setExclusiveMode(row.exclusive_mode);
                if (row.require_twitch !== undefined) setRequireTwitch(row.require_twitch);
                if (row.voting_mode !== undefined) setVotingMode(row.voting_mode);
                if (row.category_vote_modes !== undefined) setCategoryVoteModes(row.category_vote_modes);
                if (row.anonymous_voting !== undefined) setAnonymousVoting(row.anonymous_voting);
                if (row.translate_categories !== undefined) setTranslateCategories(row.translate_categories);
                if (row.category_source !== undefined) setCategorySource(row.category_source);
                if (row.generation_radius !== undefined) setGenerationRadius(row.generation_radius);
                if (row.language !== undefined) setLanguage(row.language);
                if (row.difficulty !== undefined) setDifficulty(row.difficulty);
                if (row.categories_generated !== undefined) setCategoriesGenerated(row.categories_generated);
                if (row.category_hint_translations !== undefined) setCategoryHintTranslations(row.category_hint_translations);
                if (row.category_translations !== undefined) setCategoryTranslations(row.category_translations);
            }
        };

        // Postgres changes missed while the websocket was down are NOT replayed
        // after Supabase reconnects, so a full refetch on resubscribe-after-drop
        // is the only way to catch up.
        const refetchGame = async () => {
            const { data } = await supabase.from('games').select('*').eq('id', gameId).single();
            if (data) applyGameRow(data);
        };

        // Realtime Listeners
        let gameChannelDropped = false;
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
                (payload) => applyGameRow(payload.new),
            )
            .subscribe((channelStatus) => {
                if (channelStatus === 'SUBSCRIBED') {
                    if (gameChannelDropped) {
                        gameChannelDropped = false;
                        void refetchGame();
                    }
                } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT' || channelStatus === 'CLOSED') {
                    gameChannelDropped = true;
                }
            });

        let playerChannelDropped = false;
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
            .subscribe((channelStatus) => {
                if (channelStatus === 'SUBSCRIBED') {
                    if (playerChannelDropped) {
                        playerChannelDropped = false;
                        void fetchPlayers();
                    }
                } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT' || channelStatus === 'CLOSED') {
                    playerChannelDropped = true;
                }
            });

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

    // Once the game has left the lobby, toast the host when a player drops off or
    // reconnects (in the lobby the sidebar already shows presence live). Kicked
    // players are removed from `players`, so they don't produce a "left" toast.
    const prevOnlineRef = useRef<string[] | null>(null);
    useEffect(() => {
        if (!isHost || status === 'lobby') {
            prevOnlineRef.current = onlinePlayers;
            return;
        }
        const prev = prevOnlineRef.current;
        prevOnlineRef.current = onlinePlayers;
        if (prev === null) return; // first reading after leaving the lobby — set baseline
        const nameFor = (id: string) => players.find((p) => p.id === id)?.name ?? '';
        onlinePlayers.filter((id) => !prev.includes(id) && players.some((p) => p.id === id)).forEach((id) => toast(t('game.playerJoined', { player: nameFor(id) })));
        prev.filter((id) => !onlinePlayers.includes(id) && players.some((p) => p.id === id)).forEach((id) => toast(t('game.playerLeft', { player: nameFor(id) })));
    }, [onlinePlayers, status, isHost, players, t]);

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

    // Entering voting ends this round's Street View exploration, so drop the
    // breadcrumb marker — otherwise the next round's map would open already
    // pinned at wherever this round happened to end.
    useEffect(() => {
        if (status === 'voting' && gameId && playerId) clearLastMapPoint(gameId, playerId);
    }, [status, gameId, playerId]);

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
            if (error || (data && data.success === false)) {
                console.error('Error updating game status:', error || data?.error);
                return;
            }
            // Single choke point for every phase change, so one event covers the
            // whole lobby → playing → voting → finished funnel. Status only —
            // never the game id, which would identify a specific lobby.
            track('game_status', { status: nextStatus });
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

        // Playing phase: the deadline is server-authoritative — phase_started_at is
        // stamped by set_game_status in the same UPDATE that flips the game to
        // 'playing', so every client (including mid-round joiners and refreshers)
        // derives the same deadline. Games started before the column existed fall
        // back to the legacy per-client localStorage deadline.
        const serverStartMs = phaseStartedAt ? Date.parse(phaseStartedAt) : NaN;
        const tick = () => {
            const now = Date.now();
            let endTs: number;
            if (!isNaN(serverStartMs)) {
                endTs = serverStartMs + timeLimit * 1000;
            } else {
                const rawStored = localStorage.getItem(timerStorageKey);
                const hasValidStored = rawStored !== null && !isNaN(Number(rawStored));
                endTs = hasValidStored ? Number(rawStored) : now + timeLimit * 1000;
                if (!hasValidStored) {
                    localStorage.setItem(timerStorageKey, String(endTs));
                }
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
    }, [status, timeLimit, isHost, gameId, updateStatus, gameLoaded, phaseStartedAt]);

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

    // Per-player category display: when the host enables individual translation,
    // build a { canonical -> translated } label map for this viewer's chosen
    // language. The canonical names stay the board identity; only labels change.
    const namesToTranslate = useMemo(() => {
        const board = players.find((p) => p.id === playerId)?.bingo_board ?? [];
        return Array.from(new Set([...categories, ...suggestedCategories, ...board].filter((c) => c && c.trim())));
    }, [categories, suggestedCategories, players, playerId]);
    // The host authors and reads in the board language they picked, so they never
    // translate — only guests get a personal display language.
    const effectiveDisplayLocale = isHost ? normalizeLocale(language) : displayLocale;
    const labelByCategory = useCategoryLabels(translateCategories, namesToTranslate, language, effectiveDisplayLocale, categoryTranslations, categories);

    const effectiveExclusiveMode = FEATURES.exclusiveCategories ? exclusiveMode : false;
    const effectiveHideMapSymbols = FEATURES.hideMapSymbols ? hideMapSymbols : false;
    const effectiveHideMiniMap = FEATURES.hideMiniMap ? hideMiniMap : false;
    const effectiveAiEndGame = FEATURES.aiVerifyEndGame ? aiEndGame : false;
    // Scale voting is a list-mode-only feature; a bingo game never rates 0–10.
    // Scale/mixed are list-mode-only; a bingo game always votes yes/no.
    const effectiveVotingMode: VotingMode = FEATURES.scaleVoting && gameMode === 'list' ? votingMode : 'yes_no';

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
                    votingMode={votingMode}
                    categoryVoteModes={categoryVoteModes}
                    anonymousVoting={anonymousVoting}
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
                    requireTwitch={requireTwitch}
                    categorySource={categorySource}
                    aiEnabled={apiStatus.aiEnabled}
                    isDeveloper={apiStatus.isDeveloper}
                    generationRadius={generationRadius}
                    language={language}
                    difficulty={difficulty}
                    categoriesGenerated={categoriesGenerated}
                    notifyGameEvent={notifyGameEvent}
                    onCategoryLanguageChange={handleBoardLanguageChange}
                    translateCategories={translateCategories}
                    displayLocale={displayLocale}
                    onDisplayLocaleChange={handleDisplayLocaleChange}
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
                    labelByCategory={labelByCategory}
                    isHost={isHost}
                    onlinePlayers={onlinePlayers}
                    gameHostId={gameHostId}
                    kickPlayer={kickPlayer}
                    banPlayer={banPlayer}
                    makeHost={makeHost}
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
                    isDeveloper={apiStatus.isDeveloper}
                    hintByCategory={hintByCategory}
                    labelByCategory={labelByCategory}
                    votingMode={effectiveVotingMode}
                    categoryVoteModes={categoryVoteModes}
                    anonymousVoting={anonymousVoting}
                    onlinePlayers={onlinePlayers}
                    gameHostId={gameHostId}
                    kickPlayer={kickPlayer}
                    banPlayer={banPlayer}
                    makeHost={makeHost}
                />
            );
        }

        // --- VIEW 4: PODIUM (FINISHED) ---
        if (status === 'finished') {
            return <PodiumView gameId={gameId} gameHostId={gameHostId} isHost={isHost} teamMode={teamMode} playerId={playerId} />;
        }
    };

    return (
        <>
            {nameGate === 'checking' ? (
                <div className="min-h-dvh flex items-center justify-center bg-slate-950">
                    <div className="h-10 w-10 rounded-full border-4 border-slate-700 border-t-indigo-500 animate-spin" aria-label="Loading" />
                </div>
            ) : nameGate === 'prompt' ? (
                <NamePrompt onSubmit={handleNameSubmit} />
            ) : joinBlocked === 'twitch' ? (
                <TwitchGate />
            ) : (
                <ErrorBoundary key={status}>{selectView()}</ErrorBoundary>
            )}
        </>
    );
}
