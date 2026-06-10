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
    // Client-side capture time (epoch ms, same clock as the player's path). Used
    // by the voting replay to place a submission by time rather than by space.
    captured_at?: number | null;
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

// ---- community presets ----

// A saved category that carries its exact Street View viewpoint, so the preset
// can render a real preview (via the Street View Static API) in the browse /
// voting UI — the same shape a game submission stores.
export interface CommunityCategory {
    categoryName: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
    hint?: string;
}

// Optional gameplay toggles carried by a preset (applied to the game on import).
export interface PresetSettings {
    hideMiniMap?: boolean;
    hideMapSymbols?: boolean;
    exclusiveMode?: boolean;
    aiEndGame?: boolean;
    endCondition?: 'timer' | 'first_bingo';
}

export interface CommunityPreset {
    id: string;
    author_id: string;
    author_name: string | null;
    name: string;
    description: string | null;
    icon: string | null; // display emoji shown as the card banner (e.g. '🌍' or a flag)
    // Category names translated into every app locale ({ en: [...], de: [...] }),
    // aligned to `categories` order. Filled at publish time (Gemini + DeepL).
    category_translations: Record<string, string[]>;
    // Preset name + description translated per app locale ({ en: '…', de: '…' }),
    // used to render browse cards in the viewer's language.
    title_translations: Record<string, string>;
    description_translations: Record<string, string>;
    // Category hints translated per app locale ({ en: ['hint1', ...], de: [...] }),
    // aligned to `categories` order. Filled at publish time (Gemini + DeepL).
    category_hint_translations: Record<string, string[]>;
    categories: CommunityCategory[];
    boundaries: BoundaryPolygon[];
    starting_point: string; // 'open-world' or JSON {lat,lng}
    category_count: number;
    recommended_time: number | null; // suggested round length in seconds
    difficulty: string; // 'easy' | 'medium' | 'hard'
    game_mode: string; // 'list' | 'bingo'
    grid_size: number;
    settings: PresetSettings;
    upvotes: number;
    downvotes: number;
    score: number;
    status: string;
    created_at: string;
    updated_at: string;
}

// Pre-seed payload handed from the lobby "publish" path into the builder wizard
// (via sessionStorage). `boundaries`/`startingPoint` reuse the game string
// formats; `pendingCategoryNames` are categories that were configured but never
// found in the game, so they still need a Street View spot captured.
export interface PresetSeed {
    name?: string;
    description?: string;
    categories: CommunityCategory[];
    boundaries: string; // gameBoundary JSON string
    startingPoint: string;
    pendingCategoryNames?: string[];
    // Every submission from the played game, grouped by category name, so the
    // builder can let the author pick which find to use per category.
    submissionsByCategory?: Record<string, CommunityCategory[]>;
}

export interface LobbyViewProps {
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    startingPoint: string;
    updateGameModeInfo: (updates: { game_mode?: string; team_mode?: string; grid_size?: number; starting_point?: string; gameBoundary?: string }) => void;
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
    // Category name -> resolved hint for the active locale (preset hints), looked
    // up by name so it survives the bingo board shuffle.
    hintByCategory?: Record<string, string>;
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
    // Category name -> resolved hint for the active locale (preset hints).
    hintByCategory?: Record<string, string>;
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
