'use client';

import { useState } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateGameModeInfo: (updates: any) => void;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    updateStatus: (nextStatus: GameStatus) => Promise<void>;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
    hideMapSymbols: boolean;
    hideMiniMap: boolean;
    categorySource: 'manual' | 'nearbyPlaces' | 'nearbyStreetView';
    generationRadius: number;
    generationNumber: number;
    language: 'english' | 'german';
    difficulty: 'default' | 'easy';
}

export default function LobbyView(props: LobbyViewProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [libraries] = useState<("places" | "geometry")[]>(['places', 'geometry']);
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries
    });

    const MAXGRIDSIZE = 6;

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
            const { error } = await props.supabase
                .from('players')
                .update({ path: [] })
                .eq('game_id', props.gameId);
                
            if (error) console.error("Error clearing player paths on game start:", error);
        } catch (err) {
            console.error("Unexpected error while clearing paths:", err);
        }

        let finalCategories = [...props.categories];
        const neededCount = props.gameMode === 'bingo' ? props.gridSize * props.gridSize : props.generationNumber;

        if ((props.categorySource === 'nearbyPlaces' || props.categorySource === 'nearbyStreetView') && props.startingPoint !== 'open-world' && startPos) {
            setIsGenerating(true);

            try {
                const generatedCategoryNames = await toast.promise(
                    (async () => {
                        let complexResult;
                        
                        if (props.categorySource === 'nearbyStreetView') {
                            complexResult = await generateNearbyStreetViewCategories(startPos, props.generationRadius, neededCount, props.difficulty);
                        } else {
                            complexResult = await generateNearbyPlaceCategories(startPos, props.generationRadius, neededCount, props.difficulty);
                        }

                        const simpleCategoryNames = complexResult.map(cat => cat.categoryName);

                        const { error: dbError } = await props.supabase
                            .from('games')
                            .update({ 
                                categories: simpleCategoryNames,
                                category_details: complexResult
                            })
                            .eq('id', props.gameId);

                        if (dbError) throw new Error(dbError.message);
                        
                        return simpleCategoryNames;
                    })(),
                    {
                        loading: props.categorySource === 'nearbyStreetView' ? 'Analysze Street-View-Panoramas...' : 'Generating...',
                        success: <b>Categories generated successfully!</b>,
                        error: (err) => {
                            const errorMessage = err instanceof Error ? err.message : "Unknown error during generation";
                            console.error("AI Generation Error Details:", err);
                            return `${errorMessage}`;
                        },
                    }
                );

                finalCategories = generatedCategoryNames;

            } catch {
                setIsGenerating(false);
                return;
            }

            setIsGenerating(false);
        }
        
        if (props.gameMode === 'bingo' && finalCategories.length < neededCount) {
            toast.error(`You need at least ${neededCount} categories to start a Bingo game with a grid size of ${props.gridSize}. Please add more categories or reduce the grid size.`);
            return;
        }

        // Bingo Board Generation Logic
        if (props.gameMode === 'bingo') {
            try {
                const board = finalCategories.slice(0, neededCount);
                const { error } = await props.supabase.from('players').update({ bingo_board: board }).eq('game_id', props.gameId);
                if (error) throw error;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Unknown database error";
                toast.error(`Board Generation Failed: ${errorMessage}`);
                return;
            }
        }

        props.updateStatus('playing');
    };

    const handleLeaveLobby = () => {
        if (props.isHost && props.players.length > 1) {
            const newHost = props.players.find(p => p.id !== props.playerId);
            if (newHost) {
                props.makeHost(newHost.id);
            }
        }
        props.router.push('/');
    };

    return (
        <div className="min-h-screen flex flex-col items-center p-10 bg-slate-900 text-white relative">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 hidden sm:flex">
                <Image src="/mappin.and.ellipse.png" alt="Logo" width={60} height={60} className="w-auto h-auto" />
                <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">GEO BINGO</h1>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
                <div className="flex-1 gap-6 flex flex-col">
                    <LobbySettings 
                        key={`settings-${props.gameId}-${props.lastUpdated}`}
                        isHost={props.isHost}
                        gameMode={props.gameMode}
                        teamMode={props.teamMode}
                        gridSize={props.gridSize}
                        timeLimit={props.timeLimit}
                        endCondition={props.endCondition}
                        exclusiveMode={props.exclusiveMode}
                        updateGameModeInfo={props.updateGameModeInfo}
                    />

                    <LobbyMap 
                        isHost={props.isHost}
                        isLoaded={isLoaded}
                        startingPoint={props.startingPoint}
                        gameBoundary={props.gameBoundary}
                        generationRadius={props.categorySource !== 'manual' ? props.generationRadius : undefined}
                        updateGameModeInfo={props.updateGameModeInfo}
                    />

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
                        supabase={props.supabase}
                        maxGridSize={MAXGRIDSIZE}
                        startingPoint={props.startingPoint}
                        categorySource={props.categorySource}
                        generationRadius={props.generationRadius}
                        generationNumber={props.generationNumber}
                        difficulty={props.difficulty}
                    />
                </div>

                <LobbySidebar 
                    gameId={props.gameId}
                    language={props.language}
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
                    updateGameModeInfo={props.updateGameModeInfo}
                    categorySource={props.categorySource}
                    isGenerating={isGenerating}
                />
            </div>
        </div>
    );
}