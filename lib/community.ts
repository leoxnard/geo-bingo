/*
================================================================================
COMMUNITY PRESETS — DATA LAYER
================================================================================
Thin wrappers over the community_presets reads and the SECURITY DEFINER RPCs
(create / vote / delete). Browsing & voting work logged out; create/delete go
through Supabase Auth (auth.uid() is enforced server-side in the RPC).
================================================================================
*/

import type { SupabaseClient } from '@supabase/supabase-js';

import type { BoundaryPolygon, CommunityCategory, CommunityPreset, PresetSeed, PresetSettings } from '@/components/utils/types';

import { getDeviceId } from './deviceId';
import { supabase } from './supabase';

export type PresetSort = 'top' | 'new' | 'categories';

const TABLE = 'community_presets';

export async function listPresets(sort: PresetSort = 'top'): Promise<CommunityPreset[]> {
    let query = supabase.from(TABLE).select('*').eq('status', 'published');

    if (sort === 'new') {
        query = query.order('created_at', { ascending: false });
    } else if (sort === 'categories') {
        query = query.order('category_count', { ascending: false }).order('score', { ascending: false });
    } else {
        query = query.order('score', { ascending: false }).order('created_at', { ascending: false });
    }

    const { data, error } = await query.limit(100);
    if (error) throw error;
    return (data ?? []) as CommunityPreset[];
}

export async function getPreset(id: string): Promise<CommunityPreset | null> {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) return null;
    return (data as CommunityPreset) ?? null;
}

/** The current device's vote on each preset, as { presetId: -1 | 1 }. */
export async function getMyVotes(): Promise<Record<string, number>> {
    const deviceId = getDeviceId();
    if (!deviceId) return {};
    const { data } = await supabase.from('community_preset_votes').select('preset_id, value').eq('device_id', deviceId);
    const map: Record<string, number> = {};
    ((data ?? []) as { preset_id: string; value: number }[]).forEach((v) => {
        map[v.preset_id] = v.value;
    });
    return map;
}

export interface VoteResult {
    success: boolean;
    error?: string;
    upvotes: number;
    downvotes: number;
    my_vote: number;
}

export async function votePreset(presetId: string, value: 1 | -1): Promise<VoteResult> {
    const deviceId = getDeviceId();
    const { data, error } = await supabase.rpc('vote_community_preset', {
        p_preset_id: presetId,
        p_device_id: deviceId,
        p_value: value,
    });
    if (error) throw error;
    return data as VoteResult;
}

export interface CreatePresetInput {
    name: string;
    description: string;
    icon: string;
    authorName: string;
    categories: CommunityCategory[];
    boundaries: BoundaryPolygon[];
    startingPoint: string;
    recommendedTime: number | null; // seconds
    difficulty: string; // 'easy' | 'medium' | 'hard'
    gameMode: 'list' | 'bingo';
    gridSize: number;
    settings: PresetSettings;
    categoryTranslations: Record<string, string[]>; // { <locale>: names[] }, aligned to categories
    titleTranslations: Record<string, string>; // { <locale>: translated name }
    descriptionTranslations: Record<string, string>; // { <locale>: translated description }
    categoryHintTranslations: Record<string, string[]>; // { <locale>: hints[] }, aligned to categories
}

export interface CreateResult {
    success: boolean;
    error?: string;
    data?: CommunityPreset;
}

export async function createPreset(input: CreatePresetInput): Promise<CreateResult> {
    const { data, error } = await supabase.rpc('create_community_preset', {
        p_name: input.name,
        p_description: input.description,
        p_author_name: input.authorName,
        p_categories: input.categories,
        p_boundaries: input.boundaries,
        p_starting_point: input.startingPoint,
        p_recommended_time: input.recommendedTime,
        p_difficulty: input.difficulty,
        p_game_mode: input.gameMode,
        p_grid_size: input.gridSize,
        p_settings: input.settings,
        p_icon: input.icon,
        p_category_translations: input.categoryTranslations,
        p_title_translations: input.titleTranslations,
        p_description_translations: input.descriptionTranslations,
        p_category_hint_translations: input.categoryHintTranslations,
    });
    if (error) throw error;
    return data as CreateResult;
}

/** Edit an existing preset the caller owns (ownership enforced in the RPC). */
export async function updatePreset(id: string, input: Omit<CreatePresetInput, 'authorName'>): Promise<CreateResult> {
    const { data, error } = await supabase.rpc('update_community_preset', {
        p_id: id,
        p_name: input.name,
        p_description: input.description,
        p_categories: input.categories,
        p_boundaries: input.boundaries,
        p_starting_point: input.startingPoint,
        p_recommended_time: input.recommendedTime,
        p_difficulty: input.difficulty,
        p_game_mode: input.gameMode,
        p_grid_size: input.gridSize,
        p_settings: input.settings,
        p_icon: input.icon,
        p_category_translations: input.categoryTranslations,
        p_title_translations: input.titleTranslations,
        p_description_translations: input.descriptionTranslations,
        p_category_hint_translations: input.categoryHintTranslations,
    });
    if (error) throw error;
    return data as CreateResult;
}

/** Set the caller's account-wide display name (auth metadata + every owned preset's author_name). */
export async function renameAuthor(name: string): Promise<void> {
    const trimmed = name.trim();
    const { error: metaError } = await supabase.auth.updateUser({ data: { display_name: trimmed } });
    if (metaError) throw metaError;
    const { error: rpcError } = await supabase.rpc('rename_my_presets_author', { p_name: trimmed });
    if (rpcError) throw rpcError;
}

// Seed a builder from a played game. Every category starts empty (in "pending"):
// the author picks each spot, optionally from the game's grouped submissions.
export async function buildPresetSeedFromGame(client: SupabaseClient, gameId: string): Promise<PresetSeed | null> {
    const { data: game } = await client.from('games').select('categories, gameBoundary, starting_point').eq('id', gameId).single();
    if (!game) return null;

    const { data: subs } = await client.from('submissions').select('category, lat, lng, heading, pitch, zoom').eq('game_id', gameId);

    const names: string[] = (Array.isArray(game.categories) ? (game.categories as unknown[]) : []).map((c) => String(c).trim()).filter(Boolean);

    const submissionsByCategory: Record<string, CommunityCategory[]> = {};
    ((subs ?? []) as { category: string; lat: number | null; lng: number | null; heading: number | null; pitch: number | null; zoom: number | null }[]).forEach((s) => {
        if (s.lat == null || s.lng == null) return;
        (submissionsByCategory[s.category] ??= []).push({ categoryName: s.category, lat: s.lat, lng: s.lng, heading: s.heading ?? 0, pitch: s.pitch ?? 0, zoom: s.zoom ?? 3 });
    });

    return {
        categories: [],
        boundaries: typeof game.gameBoundary === 'string' ? game.gameBoundary : '[]',
        startingPoint: typeof game.starting_point === 'string' ? game.starting_point : 'open-world',
        pendingCategoryNames: names,
        submissionsByCategory,
    };
}

export async function deletePreset(id: string): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('delete_community_preset', { p_preset_id: id });
    if (error) throw error;
    return data as { success: boolean; error?: string };
}
