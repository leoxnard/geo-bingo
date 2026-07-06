/*
================================================================================
FRIENDS — DATA LAYER
================================================================================
Thin wrappers over the friends SECURITY DEFINER RPCs (see
supabase/migrations/20260706_friend_requests_and_usernames.sql). Adding a friend
— by invite link OR by username — creates a pending request the addressee then
accepts or declines. A reciprocal request auto-accepts. An invite "code" is
simply the inviter's account id: /account?add=<id> sends a request to them.
================================================================================
*/

import type { FriendRequest, FriendWithStats } from '@/components/utils/types';

import { supabase } from './supabase';

/** Build the shareable invite link for the given account id. */
export function friendInviteLink(accountId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/account?add=${accountId}`;
}

export interface RequestResult {
    success: boolean;
    error?: string; // INVALID | NOT_FOUND | USER_NOT_FOUND | ALREADY_FRIENDS
    status?: 'requested' | 'accepted';
    name?: string;
}

export async function sendFriendRequest(addresseeId: string): Promise<RequestResult> {
    const { data, error } = await supabase.rpc('send_friend_request', { p_addressee_id: addresseeId });
    if (error) throw error;
    return data as RequestResult;
}

export async function sendFriendRequestByUsername(username: string): Promise<RequestResult> {
    const { data, error } = await supabase.rpc('send_friend_request_by_username', { p_username: username });
    if (error) throw error;
    return data as RequestResult;
}

export async function acceptFriendRequest(requesterId: string): Promise<{ success: boolean; error?: string; name?: string }> {
    const { data, error } = await supabase.rpc('accept_friend_request', { p_requester_id: requesterId });
    if (error) throw error;
    return data as { success: boolean; error?: string; name?: string };
}

export async function declineFriendRequest(requesterId: string): Promise<void> {
    const { data, error } = await supabase.rpc('decline_friend_request', { p_requester_id: requesterId });
    if (error) throw error;
    const result = (data ?? {}) as { success: boolean; error?: string };
    if (!result.success) throw new Error(result.error || 'DECLINE_FAILED');
}

export async function getIncomingRequests(): Promise<FriendRequest[]> {
    const { data, error } = await supabase.rpc('get_incoming_friend_requests');
    if (error) throw error;
    if (!data?.success) return [];
    return (data.data ?? []) as FriendRequest[];
}

export async function removeFriend(friendId: string): Promise<void> {
    const { data, error } = await supabase.rpc('remove_friend', { p_friend_id: friendId });
    if (error) throw error;
    const result = (data ?? {}) as { success: boolean; error?: string };
    if (!result.success) throw new Error(result.error || 'REMOVE_FAILED');
}

export async function getFriendsWithStats(): Promise<FriendWithStats[]> {
    const { data, error } = await supabase.rpc('get_friends_with_stats');
    if (error) throw error;
    if (!data?.success) return [];
    return (data.data ?? []) as FriendWithStats[];
}
