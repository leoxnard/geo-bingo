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
    // yes/no votes are booleans; scale-voting ratings (0–10) are numbers; hype keys
    // (`hype:<id>`) are booleans. All keyed off the voter id.
    votes: Record<string, boolean | number>;
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
    totalHype: number;
    // Scale-voting aggregates (0–10 ratings received across this entity's submissions).
    scaleTotal: number;
    scaleCount: number;
    scaleAvg: number;
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

// A saved category carrying its exact Street View viewpoint (same shape as a game
// submission), so the preset can render a real preview in the browse / voting UI.
export interface CommunityCategory {
    categoryName: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
    hint?: string;
    // Optional admin-picked start point (Daily Challenge manual select only).
    startLat?: number;
    startLng?: number;
}

// Optional gameplay toggles carried by a preset (applied to the game on import).
export interface PresetSettings {
    hideMiniMap?: boolean;
    hideMapSymbols?: boolean;
    exclusiveMode?: boolean;
    aiEndGame?: boolean;
    endCondition?: 'timer' | 'first_bingo';
    scaleVoting?: boolean;
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
// (via sessionStorage). `pendingCategoryNames` are configured-but-never-found
// categories that still need a Street View spot captured.
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

// ---- daily challenge ----

export type DailySource = 'game' | 'ai' | 'manual' | 'database';

// A camera angle (viewpoint) with no surrounding game/submission context.
export interface DailyViewpoint {
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
}

// The active challenge as served to a player — deliberately WITHOUT the hidden
// answer coordinates (those come only from revealDailyLocation after success/forfeit).
export interface DailyChallenge {
    id: string;
    challenge_date: string; // 'YYYY-MM-DD' (UTC)
    category: string;
    category_translations: Record<string, string> | null; // per-locale category text
    source: DailySource;
    has_location: boolean;
    boundary: string | null; // gameBoundary-style polygon JSON (gates play movement)
    start_lat: number | null;
    start_lng: number | null;
    created_at: string;
    // Server-side attempt state — null for guests or if no attempt exists yet.
    my_attempt: {
        started_at: string | null; // ISO timestamp set when play begins
        duration_ms: number | null; // set on successful submission
        forfeited: boolean;
    } | null;
}

// One row of the last-7-days hub list, with the caller's per-day status.
export interface DailyRecentChallenge {
    id: string;
    challenge_date: string;
    category: string;
    category_translations: Record<string, string> | null;
    source: DailySource;
    has_location: boolean;
    players: number;
    top_time: number | null;
    my_time: number | null;
    my_forfeited: boolean | null;
}

export interface DailyLeaderboardEntry {
    rank: number;
    name: string;
    duration_ms: number;
    created_at: string;
    mine: boolean;
}

// A find in the post-submit feed (others' Street View captures), downvotable.
export interface DailyFind {
    id: string;
    name: string;
    duration_ms: number;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
    downvotes: number;
    my_downvote: boolean;
}

export interface DailyStats {
    completed: number;
    won: number;
}

// An admin-pool candidate (raw table row, returned by the admin list RPC).
export interface DailyCandidate {
    id: string;
    category: string;
    category_norm: string;
    source: DailySource;
    source_ref: string | null;
    lat: number | null;
    lng: number | null;
    heading: number | null;
    pitch: number | null;
    zoom: number | null;
    boundary: string | null;
    is_fallback: boolean;
    status: 'pending' | 'approved' | 'rejected' | 'used';
    sort_order: number | null;
    category_translations: Record<string, string> | null;
    created_at: string;
    reviewed_at: string | null;
}

// A materialised challenge as seen by the admin editor (current + previous days).
// Admin-gated, so it carries the answer viewpoint for a thumbnail + the count of
// recorded plays (so the admin can decide whether to wipe them on an edit).
export interface DailyAdminChallenge {
    challenge_date: string;
    category: string;
    category_translations: Record<string, string> | null;
    source: DailySource;
    has_location: boolean;
    lat: number | null;
    lng: number | null;
    heading: number | null;
    pitch: number | null;
    zoom: number | null;
    attempts: number;
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
    // Rate submissions 0–10 instead of yes/no/hype (list mode only).
    scaleVoting?: boolean;
    // Category name -> resolved hint for the active locale (preset hints).
    hintByCategory?: Record<string, string>;
}

export interface PodiumViewProps {
    gameId: string;
    gameHostId: string;
    isHost: boolean;
    teamMode: 'ffa' | 'teams';
    playerId: string;
}

// ── Player profile (account_game_results / friendships) ──────────────────────

/** A single recorded find (persisted for the future heatmap). */
export interface GameFind {
    lat: number;
    lng: number;
    category: string;
}

/** Lifetime multiplayer summary from get_my_account_stats. */
export interface AccountStats {
    games_played: number;
    games_won: number;
    multiplayer_played: number;
    multiplayer_won: number;
    categories_found: number;
    finds_count: number;
}

/** One recorded game from get_my_game_history. */
export interface GameHistoryEntry {
    id: string;
    game_mode: string | null;
    team_mode: string | null;
    placement: number | null;
    player_count: number | null;
    score: number | null;
    categories_found: number | null;
    won: boolean;
    finished_at: string;
}

/** A friend plus their lifetime summary, from get_friends_with_stats. */
export interface FriendWithStats {
    id: string;
    name: string;
    games_played: number;
    games_won: number;
    categories_found: number;
    daily_completed: number;
}

/** A pending friend request. `id` is the OTHER account (requester for incoming, addressee for outgoing). */
export interface FriendRequest {
    id: string;
    name: string;
    created_at: string;
}

/** A live invitation to join a friend's game. Valid for 2 minutes from `created_at`. */
export interface GameInvitation {
    id: string;
    game_id: string;
    inviter_id: string;
    inviter_name: string;
    created_at: string;
}

export interface ScoreEntity {
    id: string;
    name: string;
    members: Player[];
    bingo_board?: string[];
}
