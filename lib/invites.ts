/*
================================================================================
GAME INVITATIONS — DATA LAYER
================================================================================
Thin wrappers over the game-invitation SECURITY DEFINER RPCs (see
supabase/migrations/20260707_game_invitations.sql). A player in a lobby invites a
friend into the current game; the invitee receives it in realtime (postgres_changes
on `game_invitations`) and can Join. Invitations self-expire after 2 minutes, so
these calls only ever surface live ones.
================================================================================
*/

import type { GameInvitation } from '@/components/utils/types';

import { supabase } from './supabase';

export interface InviteResult {
    success: boolean;
    error?: string; // NOT_AUTHENTICATED | INVALID | NOT_FRIENDS
    name?: string; // invitee's display name, on success
}

/** Invite a friend into a specific game. Only friends can be invited. */
export async function sendGameInvitation(gameId: string, inviteeId: string): Promise<InviteResult> {
    const { data, error } = await supabase.rpc('send_game_invitation', { p_game_id: gameId, p_invitee_id: inviteeId });
    if (error) throw error;
    return data as InviteResult;
}

/** My live (< 2 min) invitations, newest first. */
export async function getMyGameInvitations(): Promise<GameInvitation[]> {
    const { data, error } = await supabase.rpc('get_my_game_invitations');
    if (error) throw error;
    if (!data?.success) return [];
    return (data.data ?? []) as GameInvitation[];
}

/** Drop an invitation once it's been joined or declined. */
export async function dismissGameInvitation(id: string): Promise<void> {
    const { error } = await supabase.rpc('dismiss_game_invitation', { p_id: id });
    if (error) throw error;
}
