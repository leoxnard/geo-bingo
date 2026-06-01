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
    notifyGameEvent?: (event: 'ai_end_game' | 'ai_generating_categories', payload: { player_id: string }) => void;
}

export function useAiVerify({ gameId, playerId, myBoard, mySubmissions, setAllSubmissions, notifyGameEvent }: UseAiVerifyArgs) {
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

            const optimisticUpdates = new Map(results.map((r) => [r.submissionId, r.error ? { ai_verdict: null, ai_verified_hash: null } : { ai_verdict: r.passed, ai_verified_hash: r.hash }]));
            setAllSubmissions((prev) => prev.map((s) => (optimisticUpdates.has(s.id) ? { ...s, ...optimisticUpdates.get(s.id)! } : s)));

            const persistTasks = results.filter((r) => !r.fromCache && !r.error).map((r) => supabase.rpc('set_submission_ai_verdict', { p_id: r.submissionId, p_player_id: playerId, p_verdict: r.passed, p_hash: r.hash }));
            // supabase.rpc reports failures via { error } (and the function via
            // data.success), not by throwing — so if any verdict failed to persist,
            // bail before ending the round to avoid ending on verdicts that were
            // never stored.
            const persistResults = await Promise.all(persistTasks);
            const persistFailure = persistResults.find((r) => r.error || (r.data && r.data.success === false));
            if (persistFailure) {
                throw new Error(`Failed to persist AI verdict: ${persistFailure.error?.message || persistFailure.data?.error || 'unknown error'}`);
            }

            const failed = results.filter((r) => !r.passed);
            const errored = failed.filter((r) => !!r.error);
            const rejected = failed.filter((r) => !r.error);
            if (failed.length === 0) {
                await supabase.rpc('player_end_round', { p_game_id: gameId, p_player_id: playerId });
                notifyGameEvent?.('ai_end_game', { player_id: playerId });
                setAiVerificationSuccess(true);
                return { success: true as const, rejectedCount: 0, erroredCount: 0 };
            }
            setAiVerificationSuccess(false);
            const parts: string[] = [];
            if (rejected.length > 0) parts.push(`${rejected.length} rejected by AI`);
            if (errored.length > 0) parts.push(`${errored.length} API error${errored.length === 1 ? '' : 's'} (see console)`);
            throw new Error(`${parts.join(', ')}. Retake or try again.`);
        })();

        try {
            await toast.promise(verifyPromise, {
                loading: `Verifying ${subsToCheck.length} categories with AI...`,
                success: 'All categories verified — ending round.',
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
