'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useJsApiLoader } from '@react-google-maps/api';

import { shuffle } from '../utils/Functions';
import { GOOGLE_MAPS_LIBRARIES } from '../utils/mapUtils';

// Sub-components
import LobbySettings from './LobbySettings';
import LobbyMap from './LobbyMap';
import LobbyCategories from './LobbyCategories';
import LobbySidebar from './LobbySidebar';

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

interface LobbyViewProps {
    renderToast: () => React.ReactNode;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    bingoBoardMode: 'shared' | 'individual';
    startingPoint: string;
    endCondition: 'first_bingo' | 'timer';
    gameBoundary?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateGameModeInfo: (updates: any) => void;
    isHost: boolean;
    gridSize: number;
    timeLimit: number;
    updateTimeLimit: (minutes: number) => void;
    categories: string[];
    gameId: string;
    players: Player[];
    onlinePlayers: string[];
    playerId: string;
    gameHostId: string;
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    showToast: (message: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    updateStatus: (nextStatus: GameStatus) => Promise<void>;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
}

export default function LobbyView(props: LobbyViewProps) {
    const [libraries] = useState<("places" | "geometry")[]>(['places', 'geometry']);
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries
    });
    const MAXGRIDSIZE = 6;

    const handleStartGame = async () => {
        if (props.categories.length === 0) {
            props.showToast('Please add at least one category to start the game.');
            return;
        }

        // Boundary Validation
        if (props.gameBoundary && props.gameBoundary !== '[]') {
            try {
                const points = JSON.parse(props.gameBoundary);
                if (Array.isArray(points) && points.length >= 3 && props.startingPoint !== 'open-world' && window.google) {
                    const startPos = JSON.parse(props.startingPoint);
                    const point = new google.maps.LatLng(startPos.lat, startPos.lng);
                    const polygon = new google.maps.Polygon({ paths: points });
                    
                    if (!google.maps.geometry.poly.containsLocation(point, polygon)) {
                        props.showToast('Error: Starting point is outside the boundary!');
                        return;
                    }
                }
            } catch {
                props.showToast('Invalid map configuration.');
                return;
            }
        }

        // Bingo Board Generation Logic
        if (props.gameMode === 'bingo') {
            const neededCount = props.gridSize * props.gridSize;
            if (props.categories.length < neededCount) {
                props.showToast(`Need at least ${neededCount} categories.`);
                return;
            }

            try {
                if (props.bingoBoardMode === 'shared') {
                    const board = props.categories.slice(0, neededCount);
                    await props.supabase.from('players').update({ bingo_board: board }).eq('game_id', props.gameId);
                } else {
                    const promises = props.players.map(p => {
                        const board = shuffle([...props.categories]).slice(0, neededCount);
                        return props.supabase.from('players').update({ bingo_board: board }).eq('id', p.id);
                    });
                    await Promise.all(promises);
                }
            } catch {
                props.showToast("Failed to generate boards.");
                return;
            }
        }

        props.updateStatus('playing');
    };


    const handleLeaveLobby = () => {
        // If host leaves, assign new host
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
            {props.renderToast()}
            
            {/* Logo Header */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 hidden sm:flex">
                <Image src="/mappin.and.ellipse.png" alt="Logo" width={60} height={60} className="w-auto h-auto" />
                <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">GEO BINGO</h1>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
                <div className="flex-1 gap-6 flex flex-col">
                    <LobbySettings 
                        isHost={props.isHost}
                        gameMode={props.gameMode}
                        teamMode={props.teamMode}
                        gridSize={props.gridSize}
                        bingoBoardMode={props.bingoBoardMode}
                        timeLimit={props.timeLimit}
                        endCondition={props.endCondition}
                        maxGridSize={MAXGRIDSIZE}
                        updateGameModeInfo={props.updateGameModeInfo}
                        updateTimeLimit={props.updateTimeLimit}
                    />

                    <LobbyCategories 
                        isHost={props.isHost}
                        gameMode={props.gameMode}
                        gridSize={props.gridSize}
                        bingoBoardMode={props.bingoBoardMode}
                        categories={props.categories}
                        gameId={props.gameId}
                        supabase={props.supabase}
                        maxGridSize={MAXGRIDSIZE}
                        showToast={props.showToast}
                    />

                    <LobbyMap 
                        isHost={props.isHost}
                        isLoaded={isLoaded}
                        startingPoint={props.startingPoint}
                        gameBoundary={props.gameBoundary || null}
                        updateGameModeInfo={props.updateGameModeInfo}
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
                    showToast={props.showToast}
                    makeHost={props.makeHost}
                    kickPlayer={props.kickPlayer}
                    banPlayer={props.banPlayer}
                    handleStartGame={handleStartGame}
                    handleLeaveLobby={handleLeaveLobby}
                    setPlayers={props.setPlayers}
                />
            </div>
        </div>
    );
}