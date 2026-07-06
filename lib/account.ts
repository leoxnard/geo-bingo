/*
================================================================================
PLAYER PROFILE — DATA LAYER
================================================================================
Thin wrappers over the player-profile SECURITY DEFINER RPCs (see
supabase/migrations/20260630_player_profiles_and_friends.sql). All are scoped to
the signed-in account (auth.uid() server-side); guests get a NOT_AUTHENTICATED
payload, which the callers treat as "no stats yet". Friends live in lib/friends.ts.
================================================================================
*/

import type { AccountStats, GameFind, GameHistoryEntry } from '@/components/utils/types';

import { supabase } from './supabase';

/**
 * Record the signed-in player's outcome for a finished game. Idempotent per
 * round (keyed server-side on games.finished_at), so re-renders/refreshes don't
 * double-count and a replay in the same lobby records a fresh row. No-op for
 * guests — the RPC simply returns NOT_AUTHENTICATED.
 */
export async function recordGameResult(input: { gameId: string; playerId: string; gameMode: string; teamMode: string; placement: number; playerCount: number; score: number; categoriesFound: number; won: boolean; finds: GameFind[] }): Promise<void> {
    const { error } = await supabase.rpc('record_my_game_result', {
        p_game_id: input.gameId,
        p_player_id: input.playerId,
        p_game_mode: input.gameMode,
        p_team_mode: input.teamMode,
        p_placement: input.placement,
        p_player_count: input.playerCount,
        p_score: input.score,
        p_categories_found: input.categoriesFound,
        p_won: input.won,
        p_finds: input.finds,
    });
    if (error) throw error;
}

export async function getMyAccountStats(): Promise<AccountStats | null> {
    const { data, error } = await supabase.rpc('get_my_account_stats');
    if (error) throw error;
    if (!data?.success) return null;
    return {
        games_played: data.games_played as number,
        games_won: data.games_won as number,
        multiplayer_played: data.multiplayer_played as number,
        multiplayer_won: data.multiplayer_won as number,
        categories_found: data.categories_found as number,
        finds_count: data.finds_count as number,
    };
}

export async function getMyGameHistory(limit = 20): Promise<GameHistoryEntry[]> {
    const { data, error } = await supabase.rpc('get_my_game_history', { p_limit: limit });
    if (error) throw error;
    if (!data?.success) return [];
    return (data.data ?? []) as GameHistoryEntry[];
}
