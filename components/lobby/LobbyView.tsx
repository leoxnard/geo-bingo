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

import { useState, useEffect } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import Image from 'next/image';
import toast from 'react-hot-toast';

import LobbyCategories from './LobbyCategories';
import LobbyMap from './LobbyMap';
import LobbySettings from './LobbySettings';
import LobbySidebar from './LobbySidebar';
import { generateNearbyPlaceCategories } from './NearbyPlaceCategories';
import { generateNearbyStreetViewCategories } from './NearbyStreetViewCategories';
import { isLocationAllowed } from '../utils/mapUtils';

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
    categorySource: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
    aiEnabled: boolean;
    isDeveloper: boolean;
    generationRadius: number;
    generationNumber: number;
    language: 'english' | 'german';
    difficulty: 'default' | 'easy';
    categoriesGenerated: boolean;
}

export default function LobbyView(props: LobbyViewProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [libraries] = useState<('places' | 'geometry')[]>(['places', 'geometry']);
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries,
    });

    const MAXGRIDSIZE = 6;

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

        let finalCategories = [...props.categories];
        const neededCount = props.gameMode === 'bingo' ? props.gridSize * props.gridSize : props.generationNumber;

        if ((props.categorySource === 'nearbyPlaces' || props.categorySource === 'nearbyStreetView') && props.startingPoint !== 'open-world' && startPos) {
            if (!props.isDeveloper) {
                const currentCount = parseInt(localStorage.getItem('geoBingoPromptCount') || '0', 10);
                localStorage.setItem('geoBingoPromptCount', (currentCount + 1).toString());
            }

            setIsGenerating(true);

            try {
                const generatedCategoryNames = await toast.promise(
                    (async () => {
                        let complexResult;

                        if (props.categorySource === 'nearbyStreetView') {
                            complexResult = await generateNearbyStreetViewCategories(startPos, props.generationRadius, neededCount, props.difficulty, props.language);
                        } else {
                            complexResult = await generateNearbyPlaceCategories(startPos, props.generationRadius, neededCount, props.difficulty, props.language);
                        }

                        const simpleCategoryNames = complexResult.map((cat) => cat.categoryName);

                        const { error: dbError } = await props.supabase
                            .from('games')
                            .update({
                                categories: simpleCategoryNames,
                                category_details: complexResult,
                            })
                            .eq('id', props.gameId);

                        if (dbError) throw new Error(dbError.message);

                        return simpleCategoryNames;
                    })(),
                    {
                        loading: props.categorySource === 'nearbyStreetView' ? 'Analysze Street-View-Panoramas...' : 'Generating...',
                        success: <b>Categories generated successfully!</b>,
                        error: (err) => {
                            const errorMessage = err instanceof Error ? err.message : 'Unknown error during generation';
                            console.error('AI Generation Error Details:', err);
                            return `${errorMessage}`;
                        },
                    },
                );

                finalCategories = generatedCategoryNames;
            } catch {
                setIsGenerating(false);
                return;
            }

            setIsGenerating(false);
        }

        finalCategories = finalCategories.filter((cat) => cat.trim() !== '');
        if (finalCategories.length === 0) {
            toast.error('Please add at least one valid category before starting the game.');
            return;
        }

        if (props.gameMode === 'bingo' && finalCategories.length < neededCount) {
            toast.error(`You need at least ${neededCount} categories to start a Bingo game with a grid size of ${props.gridSize}. Please add more categories or reduce the grid size.`);
            return;
        }

        // Bingo Board Generation Logic
        if (props.gameMode === 'bingo') {
            try {
                const board = finalCategories.slice(0, neededCount);
                // Shared-board mode: every player gets the same board, written
                // one rpc per row since direct bulk UPDATE on players is the
                // policy we want to lock down.
                const results = await Promise.all(props.players.map((p) => props.supabase.rpc('update_player', { p_id: p.id, p_patch: { bingo_board: board } })));
                const failure = results.find((r) => r.error);
                if (failure?.error) throw failure.error;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown database error';
                toast.error(`Board Generation Failed: ${errorMessage}`);
                return;
            }
        } else {
            try {
                const { error } = await props.supabase.rpc('update_game_settings', { p_game_id: props.gameId, p_host_id: props.gameHostId, p_patch: { categories: finalCategories } });
                if (error) throw error;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown database error';
                toast.error(`Failed to update categories: ${errorMessage}`);
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
        <div className="min-h-screen flex flex-col items-center px-4 py-6 sm:px-6 sm:py-8 lg:p-10 bg-slate-900 text-white relative">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-8 sm:mb-12 hidden sm:flex">
                <Image src="/mappin.and.ellipse.png" alt="Logo" width={60} height={60} className="w-auto h-auto" />
                <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">Geo BingBong</h1>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 w-full max-w-5xl">
                <div className="flex-1 gap-4 sm:gap-6 flex flex-col">
                    <LobbySettings key={`settings-${props.gameId}-${props.lastUpdated}`} isHost={props.isHost} gameMode={props.gameMode} teamMode={props.teamMode} gridSize={props.gridSize} timeLimit={props.timeLimit} endCondition={props.endCondition} exclusiveMode={props.exclusiveMode} updateGameModeInfo={props.updateGameModeInfo} />

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
                        generationRadius={props.generationRadius}
                        generationNumber={props.generationNumber}
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
                    updateGameModeInfo={props.updateGameModeInfo}
                    categorySource={props.categorySource}
                    isGenerating={isGenerating}
                />
            </div>
        </div>
    );
}
