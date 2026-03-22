// lib/types.ts

export type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

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

export interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

export interface PlayerStat {
    id: string;
    name: string;
    score: number;
    totalFound: number;
    bingos: number;
    communityApproval: number;
    totalYes: number;
    totalNo: number;
    rank: number;
}

export interface LobbyViewProps {
    renderToast: () => React.ReactNode;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    bingoBoardMode: 'shared' | 'individual';
    startingPoint: string;
    updateGameModeInfo: (updates: { 
        game_mode?: string; 
        team_mode?: string; 
        grid_size?: number; 
        bingo_board_mode?: 'shared' | 'individual'; 
        starting_point?: string; 
        gameBoundary?: string | null 
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
    showToast : (message: string) => void;
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
    gameBoundary?: string | null;
    renderToast: () => React.ReactNode;
    showToast : (message: string) => void;
    timeLeft: number;
    readyPlayers: string[];
    players: Player[];
    endCondition?: 'first_bingo' | 'timer';
}

export interface VotingViewProps {
    gameId: string;
    isHost: boolean;
    categories: string[];
    playerId: string;
    players: Player[];
    teamMode: 'ffa' | 'teams';
    onFinishGame: () => Promise<void> | void;
    renderToast: () => React.ReactNode;
}

export interface PodiumViewProps {
    gameId: string;
    renderToast: () => React.ReactNode;
    isHost: boolean;
    teamMode: 'ffa' | 'teams';
}

export interface ScoreEntity {
    id: string;
    name: string;
    members: Player[];
    bingo_board?: string[];
}