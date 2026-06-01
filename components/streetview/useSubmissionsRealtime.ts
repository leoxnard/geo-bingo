'use client';

/*
================================================================================
useSubmissionsRealtime HOOK
================================================================================
Owns the player's view of all submissions in the current game:
- initial fetch of the submissions table for this game
- supabase realtime subscription for INSERT + UPDATE
- team-aware derivations (mine vs others, plus team ids and my team)

The setter is returned so the parent can apply optimistic updates when
the local player captures or removes a submission, and so the AI verify
hook can write verdicts.
================================================================================
*/

import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../../lib/supabase';
import type { Player, Submission } from '../utils/types';

interface UseSubmissionsRealtimeArgs {
    gameId: string;
    playerId: string;
    players: Player[];
    teamMode: 'ffa' | 'teams';
}

export function useSubmissionsRealtime({ gameId, playerId, players, teamMode }: UseSubmissionsRealtimeArgs) {
    const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);

    useEffect(() => {
        const fetchAllSubmissions = async () => {
            const { data } = await supabase.from('submissions').select('*').eq('game_id', gameId);
            if (data) setAllSubmissions(data);
        };
        fetchAllSubmissions();

        const channel = supabase
            .channel(`game-submissions-${gameId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'submissions',
                    filter: `game_id=eq.${gameId}`,
                },
                (payload) => {
                    console.log('New submission received via realtime:', payload);
                    const newSub = payload.new as Submission;
                    setAllSubmissions((prev) => {
                        if (prev.find((s) => s.id === newSub.id)) return prev;
                        return [...prev, newSub];
                    });
                },
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'submissions',
                    filter: `game_id=eq.${gameId}`,
                },
                (payload) => {
                    const updatedSub = payload.new as Submission;
                    setAllSubmissions((prev) => prev.map((s) => (s.id === updatedSub.id ? { ...s, ...updatedSub } : s)));
                },
            )
            .subscribe();

        return () => {
            const cleanup = async () => {
                await supabase.removeChannel(channel);
            };
            cleanup();
        };
    }, [gameId]);

    const myTeam = useMemo(() => players.find((p) => p.id === playerId)?.team ?? -1, [players, playerId]);
    const teamIds = useMemo(() => (teamMode === 'teams' ? players.filter((p) => p.team === myTeam).map((p) => p.id) : [playerId]), [teamMode, players, myTeam, playerId]);

    const mySubmissions = useMemo(() => allSubmissions.filter((s) => teamIds.includes(s.player_id)), [allSubmissions, teamIds]);
    const otherSubmissions = useMemo(() => allSubmissions.filter((s) => !teamIds.includes(s.player_id)), [allSubmissions, teamIds]);

    return { allSubmissions, setAllSubmissions, mySubmissions, otherSubmissions, teamIds, myTeam };
}
