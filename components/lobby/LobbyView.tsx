'use client';

/*
================================================================================
LOBBY VIEW COMPONENT
================================================================================
Main game lobby interface for game setup and player management.
Integrates categories, map, settings, and player management components.
Handles game state synchronization and start game functionality.
================================================================================
*/

import { useEffect, useState, useRef } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import Image from 'next/image';
import toast from 'react-hot-toast';

import { CategoryLanguage, Locale, normalizeLocale } from '@/lib/i18n/locales';
import OptionsButton from '@/lib/settings/OptionsButton';

import { AI_TARGET_CATEGORIES } from './AICategories';
import LobbyCategories from './LobbyCategories';
import LobbyCommunityPresets from './LobbyCommunityPresets';
import LobbyMap from './LobbyMap';
import LobbySettings from './LobbySettings';
import LobbySidebar from './LobbySidebar';
import { shuffle } from '../utils/Functions';
import GlassAmbience from '../utils/GlassAmbience';
import { GOOGLE_MAPS_LIBRARIES, isLocationAllowed } from '../utils/mapUtils';
import type { CommunityPreset } from '../utils/types';
import type { CategoryVoteModes, VotingMode } from '../utils/votes';

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

interface LobbyViewProps {
    lastUpdated: string;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    startingPoint: string;
    endCondition: 'first_bingo' | 'timer';
    gameBoundary: string;
    updateGameModeInfo: (updates: Record<string, unknown>) => void;
    isHost: boolean;
    gridSize: number;
    timeLimit: number;
    exclusiveMode: boolean;
    votingMode: VotingMode;
    categoryVoteModes: CategoryVoteModes;
    categories: string[];
    suggestedCategories: string[];
    gameId: string;
    players: Player[];
    onlinePlayers: string[];
    playerId: string;
    gameHostId: string;
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    router: AppRouterInstance;
    supabase: SupabaseClient;
    updateStatus: (nextStatus: GameStatus) => Promise<void>;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
    hideMapSymbols: boolean;
    hideMiniMap: boolean;
    aiEndGame: boolean;
    anonymousVoting: boolean;
    categorySource: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
    aiEnabled: boolean;
    isDeveloper: boolean;
    generationRadius: number;
    language: CategoryLanguage;
    difficulty: 'default' | 'easy' | 'hard';
    categoriesGenerated: boolean;
    notifyGameEvent?: (event: 'ai_end_game' | 'ai_generating_categories', payload: { player_id: string }) => void;
    onCategoryLanguageChange?: (newLanguage: CategoryLanguage) => Promise<void>;
    translateCategories: boolean;
    displayLocale: Locale;
    onDisplayLocaleChange: (locale: Locale) => void;
}

export default function LobbyView(props: LobbyViewProps) {
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES,
    });

    const MAXGRIDSIZE = 6;

    const [showCommunityPresets, setShowCommunityPresets] = useState(false);
    const isPendingSyncRef = useRef(false);

    const handleImportPreset = (preset: CommunityPreset) => {
        if (!props.isHost) return;

        // Import the categories in the lobby's currently-selected board language.
        const catLocale = normalizeLocale(props.language);
        const originals = preset.categories.map((c) => c.categoryName);
        const translatedList = preset.category_translations?.[catLocale];
        const importedNames = Array.isArray(translatedList) && translatedList.length === originals.length ? translatedList : originals;

        const targetCount = props.gameMode === 'bingo' ? props.gridSize * props.gridSize : importedNames.length;
        const paddedCategories = props.gameMode === 'bingo' ? [...importedNames, ...Array(Math.max(0, targetCount - importedNames.length)).fill('')] : importedNames;

        // Carry the preset's target spots so the voting map can mark them, plus the
        // per-locale translations + hints, exactly like the fork-on-create import.
        const presetPositions = preset.categories.filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number').map((c) => ({ categoryName: c.categoryName, lat: c.lat, lng: c.lng }));

        isPendingSyncRef.current = true;

        props.updateGameModeInfo({
            categories: paddedCategories,
            gameBoundary: JSON.stringify(preset.boundaries),
            starting_point: preset.starting_point,
            game_mode: preset.game_mode === 'bingo' ? 'bingo' : 'list',
            grid_size: preset.game_mode === 'bingo' ? preset.grid_size : props.gridSize,
            time_limit: preset.recommended_time ?? props.timeLimit,
            difficulty: preset.difficulty === 'easy' || preset.difficulty === 'hard' ? preset.difficulty : 'default',
            ...(preset.settings?.endCondition && { end_condition: preset.settings.endCondition }),
            ...(preset.settings?.hideMiniMap !== undefined && { hide_minimap: preset.settings.hideMiniMap }),
            ...(preset.settings?.hideMapSymbols !== undefined && { hide_map_symbols: preset.settings.hideMapSymbols }),
            ...(preset.settings?.exclusiveMode !== undefined && { exclusive_mode: preset.settings.exclusiveMode }),
            ...(preset.settings?.aiEndGame !== undefined && { ai_end_game: preset.settings.aiEndGame }),
            ...(preset.category_translations && { category_translations: preset.category_translations }),
            ...(preset.category_hint_translations && { category_hint_translations: preset.category_hint_translations }),
            ...(presetPositions.length > 0 && { preset_categories: presetPositions }),
            category_source: 'manual',
            categories_generated: false,
        });

        // Success toast is shown by the import modal (LobbyCommunityPresets).
        setTimeout(() => {
            isPendingSyncRef.current = false;
        }, 1200);
    };

    useEffect(() => {
        const today = new Date().toDateString();
        const storedDate = localStorage.getItem('geoBingoPromptDate');

        if (storedDate !== today) {
            localStorage.setItem('geoBingoPromptDate', today);
            localStorage.setItem('geoBingoPromptCount', '0');
        }
    }, []);

    const handleStartGame = async () => {
        let startPos;
        if (props.startingPoint !== 'open-world') {
            try {
                startPos = JSON.parse(props.startingPoint);
                if (props.gameBoundary && props.gameBoundary !== '[]') {
                    if (!isLocationAllowed(startPos, props.gameBoundary)) {
                        toast.error('Starting point is outside the defined game boundary!');
                        return;
                    }
                }
            } catch {
                toast.error('Invalid map configuration!');
                return;
            }
        }

        try {
            // Bulk reset paths via per-player update_player. Players in this
            // game are already in props.players from the parent's realtime sub.
            const results = await Promise.all(props.players.map((p) => props.supabase.rpc('update_player', { p_id: p.id, p_patch: { path: [] } })));
            const failure = results.find((r) => r.error);
            if (failure?.error) console.error('Error clearing player paths on game start:', failure.error);
        } catch (err) {
            console.error('Unexpected error while clearing paths:', err);
        }

        const neededCount = props.gameMode === 'bingo' ? props.gridSize * props.gridSize : AI_TARGET_CATEGORIES;

        const seenCategories = new Set<string>();
        let finalCategories = props.categories
            .map((cat) => cat.trim())
            .filter((cat) => {
                if (cat === '') return false;
                const key = cat.toLowerCase();
                if (seenCategories.has(key)) return false;
                seenCategories.add(key);
                return true;
            });

        // No categories set — auto-fill from the balanced dataset (in the board
        // language) up to the number of needed spots and start straight away.
        if (finalCategories.length === 0 && neededCount > 0) {
            const { categoriesBalanced } = await import('../../lib/categories');
            const pool = shuffle(categoriesBalanced[props.language] ?? categoriesBalanced.english);
            finalCategories = pool.slice(0, neededCount);
        }

        if (props.gameMode === 'bingo' && finalCategories.length < neededCount) {
            toast.error(`You need at least ${neededCount} categories to start a Bingo game with a grid size of ${props.gridSize}. Please add more categories or reduce the grid size.`);
            return;
        }

        // Persist the resolved categories to the game (optimistic local update +
        // host-only DB write). This keeps the host's local `categories` state in
        // sync so the playing view renders immediately — the auto-filled list is
        // never round-tripped through Realtime before we flip to `playing` — and
        // lets late joiners generate their board from `games.categories`.
        props.updateGameModeInfo({ categories: finalCategories });

        // Bingo Board Generation Logic
        if (props.gameMode === 'bingo') {
            try {
                const board = finalCategories.slice(0, neededCount);
                // Shared board: every player gets the same one, one rpc per row (bulk UPDATE is locked down).
                const results = await Promise.all(props.players.map((p) => props.supabase.rpc('update_player', { p_id: p.id, p_patch: { bingo_board: board } })));
                const failure = results.find((r) => r.error);
                if (failure?.error) throw failure.error;
                // Reflect the freshly-assigned board in local state so the host's
                // board renders at once instead of empty tiles until Realtime lands.
                props.setPlayers((prev) => prev.map((p) => ({ ...p, bingo_board: board })));
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown database error';
                toast.error(`Board Generation Failed: ${errorMessage}`);
                return;
            }
        }

        props.updateStatus('playing');
    };

    const handleLeaveLobby = () => {
        if (props.isHost && props.players.length > 1) {
            const newHost = props.players.find((p) => p.id !== props.playerId);
            if (newHost) {
                props.makeHost(newHost.id);
            }
        }
        props.router.push('/');
    };

    return (
        <div className="min-h-screen flex flex-col items-center px-4 pb-6 pt-14 sm:pt-8 sm:pb-8 lg:p-10 bg-slate-950 text-white relative overflow-hidden">
            <GlassAmbience drifters={false} />
            <OptionsButton />
            <div className="relative flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-8 sm:mb-12 hidden sm:flex">
                <Image src="/mappin.and.ellipse.png" alt="Logo" width={60} height={60} className="w-auto h-auto" />
                <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text pb-[0.12em] text-6xl font-extrabold tracking-tighter text-transparent">Geo BingBong</h1>
            </div>

            <div className="relative flex flex-col lg:flex-row gap-4 sm:gap-6 w-full max-w-5xl">
                <div className="flex-1 gap-4 sm:gap-6 flex flex-col">
                    <LobbySettings isHost={props.isHost} gameMode={props.gameMode} teamMode={props.teamMode} gridSize={props.gridSize} timeLimit={props.timeLimit} endCondition={props.endCondition} exclusiveMode={props.exclusiveMode} votingMode={props.votingMode} updateGameModeInfo={props.updateGameModeInfo} />

                    <LobbyMap isHost={props.isHost} isLoaded={isLoaded} startingPoint={props.startingPoint} gameBoundary={props.gameBoundary} generationRadius={props.categorySource !== 'manual' ? props.generationRadius : undefined} updateGameModeInfo={props.updateGameModeInfo} />

                    <LobbyCategories
                        key={`settings-${props.gameId}`}
                        updateGameModeInfo={props.updateGameModeInfo}
                        isHost={props.isHost}
                        gameMode={props.gameMode}
                        language={props.language}
                        gridSize={props.gridSize}
                        categories={props.categories}
                        suggestedCategories={props.suggestedCategories}
                        gameId={props.gameId}
                        gameHostId={props.gameHostId}
                        playerId={props.playerId}
                        supabase={props.supabase}
                        maxGridSize={MAXGRIDSIZE}
                        startingPoint={props.startingPoint}
                        categorySource={props.categorySource}
                        aiEnabled={props.aiEnabled}
                        isDeveloper={props.isDeveloper}
                        gameBoundary={props.gameBoundary}
                        votingMode={props.votingMode}
                        categoryVoteModes={props.categoryVoteModes}
                        generationRadius={props.generationRadius}
                        difficulty={props.difficulty}
                        categoriesGenerated={props.categoriesGenerated}
                    />
                </div>

                <LobbySidebar
                    gameId={props.gameId}
                    players={props.players}
                    onlinePlayers={props.onlinePlayers}
                    playerId={props.playerId}
                    gameHostId={props.gameHostId}
                    isHost={props.isHost}
                    teamMode={props.teamMode}
                    categories={props.categories}
                    supabase={props.supabase}
                    makeHost={props.makeHost}
                    kickPlayer={props.kickPlayer}
                    banPlayer={props.banPlayer}
                    handleStartGame={handleStartGame}
                    handleLeaveLobby={handleLeaveLobby}
                    setPlayers={props.setPlayers}
                    hideMapSymbols={props.hideMapSymbols}
                    hideMiniMap={props.hideMiniMap}
                    aiEndGame={props.aiEndGame}
                    anonymousVoting={props.anonymousVoting}
                    language={props.language}
                    updateGameModeInfo={props.updateGameModeInfo}
                    onCategoryLanguageChange={props.onCategoryLanguageChange}
                    translateCategories={props.translateCategories}
                    displayLocale={props.displayLocale}
                    onDisplayLocaleChange={props.onDisplayLocaleChange}
                    categorySource={props.categorySource}
                    isGenerating={false}
                    onPresetClick={() => setShowCommunityPresets(true)}
                />
            </div>

            {props.isHost && <LobbyCommunityPresets isOpen={showCommunityPresets} onClose={() => setShowCommunityPresets(false)} onImport={handleImportPreset} />}
        </div>
    );
}
