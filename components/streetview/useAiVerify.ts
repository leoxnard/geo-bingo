'use client';

/*
================================================================================
useAiVerify HOOK
================================================================================
Owns the "verify all my submissions with Gemini, then end the round" flow:
state for the in-flight + success indicators, the click handler, and the
derived allCategoriesFilled flag. Lives outside StreetView so the parent
can stay focused on panorama + grid rendering.
================================================================================
*/

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import toast from 'react-hot-toast';

import { supabase } from '../../lib/supabase';
import { verifySubmissions } from '../utils/aiVerify';
import type { Submission } from '../utils/types';

interface UseAiVerifyArgs {
    gameId: string;
    playerId: string;
    myBoard: string[];
    mySubmissions: Submission[];
    setAllSubmissions: Dispatch<SetStateAction<Submission[]>>;
}

export function useAiVerify({ gameId, playerId, myBoard, mySubmissions, setAllSubmissions }: UseAiVerifyArgs) {
    const [isVerifying, setIsVerifying] = useState(false);
    const [aiVerificationSuccess, setAiVerificationSuccess] = useState(false);

    const allCategoriesFilled = useMemo(() => myBoard.every((cat) => mySubmissions.some((s) => s.category === cat)), [myBoard, mySubmissions]);

    const handleVerifyAndEnd = async () => {
        if (isVerifying) return;
        if (!allCategoriesFilled) {
            toast.error('Fill every category before AI verification.');
            return;
        }
        const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!mapsKey) {
            toast.error('AI verification is unavailable: missing API keys.');
            return;
        }

        const subsToCheck = myBoard.map((cat) => mySubmissions.find((s) => s.category === cat)).filter((s): s is Submission => !!s);

        setIsVerifying(true);
        setAiVerificationSuccess(false);
        const verifyPromise = (async () => {
            const results = await verifySubmissions(subsToCheck, mapsKey);
            console.log('[aiVerify] all results:', results);

            const optimisticUpdates = new Map(results.map((r) => [r.submissionId, { ai_verdict: r.passed, ai_verified_hash: r.hash }]));
            setAllSubmissions((prev) => prev.map((s) => (optimisticUpdates.has(s.id) ? { ...s, ...optimisticUpdates.get(s.id)! } : s)));

            const persistTasks = results.filter((r) => !r.fromCache).map((r) => supabase.rpc('set_submission_ai_verdict', { p_id: r.submissionId, p_player_id: playerId, p_verdict: r.passed, p_hash: r.hash }));
            await Promise.all(persistTasks);

            const failed = results.filter((r) => !r.passed);
            const errored = failed.filter((r) => !!r.error);
            const rejected = failed.filter((r) => !r.error);
            if (failed.length === 0) {
                await supabase.rpc('player_end_round', { p_game_id: gameId, p_player_id: playerId });
                setAiVerificationSuccess(true);
                return { success: true as const, rejectedCount: 0, erroredCount: 0 };
            }
            setAiVerificationSuccess(false);
            return { success: false as const, rejectedCount: rejected.length, erroredCount: errored.length };
        })();

        try {
            await toast.promise(verifyPromise, {
                loading: `Verifying ${subsToCheck.length} categories with AI...`,
                success: (res) => {
                    if (res.success) return 'All categories verified — ending round.';
                    const parts: string[] = [];
                    if (res.rejectedCount > 0) parts.push(`${res.rejectedCount} rejected by AI`);
                    if (res.erroredCount > 0) parts.push(`${res.erroredCount} API error${res.erroredCount === 1 ? '' : 's'} (see console)`);
                    return `${parts.join(', ')}. Retake or try again.`;
                },
                error: (err) => `AI verification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
            });
        } catch (err) {
            console.error('AI verification error:', err);
            setAiVerificationSuccess(false);
        } finally {
            setIsVerifying(false);
        }
    };

    return { isVerifying, aiVerificationSuccess, allCategoriesFilled, handleVerifyAndEnd };
}
