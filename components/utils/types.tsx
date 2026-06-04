/*
================================================================================
TYPES DEFINITIONS
================================================================================
Core TypeScript interfaces and type definitions for Geo Bingo.
Includes game states, player data, submission structures, and component props.
Provides type safety across the entire application.
================================================================================
*/

// lib/types.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

export type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

export type PathPoint = { lat: number; lng: number; timestamp: number };

export interface Submission {
    id: string;
    player_id: string;
    category: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
    votes: Record<string, boolean>;
    ai_verdict?: boolean | null;
    ai_verified_hash?: string | null;
    ai_reason?: string | null;
}

export interface BingoCategory {
    categoryName: string;
    score?: number;
    matchedPlaces: {
        name: string;
        lat: number;
        lng: number;
    }[];
}

export interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

export interface PlayerStats {
    bingos: number;
    communityApproval: number;
    gridSize: number;
    gridStatus: number[];
    id: string;
    name: string;
    rank: number;
    score: number;
    totalFound: number;
    totalNo: number;
    totalYes: number;
    bingoBoard?: string[];
}

export interface BoundaryPolygon {
    id: string;
    groupId?: string;
    type: 'allow' | 'forbid';
    points: { lat: number; lng: number }[];
    name?: string;
    isComplete?: boolean; // true if polygon drawing is complete and in refinement phase
}

export interface LobbyViewProps {
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    startingPoint: string;
    updateGameModeInfo: (updates: { game_mode?: string; team_mode?: string; grid_size?: number; bingo_board_mode?: 'shared' | 'individual'; starting_point?: string; gameBoundary?: string }) => void;
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
    router: AppRouterInstance;
    supabase: SupabaseClient;
    updateStatus: (nextStatus: GameStatus) => Promise<void>;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
}

export interface StreetViewProps {
    myBoard: string[];
    gameId: string;
    playerId: string;
    gameMode?: 'list' | 'bingo';
    teamMode?: 'ffa' | 'teams';
    gridSize?: number;
    startingPoint?: string;
    gameBoundary?: string;
    timeLeft: number;
    readyPlayers: string[];
    players: Player[];
    endCondition?: 'first_bingo' | 'timer';
    hideMapSymbols?: boolean;
    hideMiniMap?: boolean;
    exclusiveMode?: boolean;
    allowHints?: boolean;
    aiEndGame?: boolean;
    onVoteEnd?: () => void;
    notifyGameEvent?: (event: 'ai_end_game' | 'ai_generating_categories', payload: { player_id: string }) => void;
}

export interface VotingViewProps {
    gameId: string;
    isHost: boolean;
    categories: string[];
    playerId: string;
    players: Player[];
    teamMode: 'ffa' | 'teams';
    onFinishGame: () => Promise<void> | void;
    isDeveloper?: boolean;
}

export interface PodiumViewProps {
    gameId: string;
    gameHostId: string;
    isHost: boolean;
    teamMode: 'ffa' | 'teams';
}

export interface ScoreEntity {
    id: string;
    name: string;
    members: Player[];
    bingo_board?: string[];
}
