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
  is_valid: boolean | null;
  votes: Record<string, boolean>;
}

export interface BingoCategory {
    categoryName: string;
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
}

export interface LobbyViewProps {
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    startingPoint: string;
    updateGameModeInfo: (updates: { 
        game_mode?: string; 
        team_mode?: string; 
        grid_size?: number; 
        bingo_board_mode?: 'shared' | 'individual'; 
        starting_point?: string; 
        gameBoundary?: string;
    }) => void;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
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
}

export interface VotingViewProps {
    gameId: string;
    isHost: boolean;
    categories: string[];
    playerId: string;
    players: Player[];
    teamMode: 'ffa' | 'teams';
    onFinishGame: () => Promise<void> | void;
}

export interface PodiumViewProps {
    gameId: string;
    isHost: boolean;
    teamMode: 'ffa' | 'teams';
}

export interface ScoreEntity {
    id: string;
    name: string;
    members: Player[];
    bingo_board?: string[];
}