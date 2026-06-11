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

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import toast from 'react-hot-toast';

import { supabase } from '../../lib/supabase';
import { isSubmissionVerified, verifySubmissions } from '../utils/aiVerify';
import type { Submission } from '../utils/types';

// Loading toast counts only submissions actually sent to Gemini (already-verified
// ones are skipped). `noun` distinguishes the all-categories vs Bingo-line flow.
const buildVerifyLabel = (subsToCheck: Submission[], noun: string): string => {
    const pendingCount = subsToCheck.filter((s) => !isSubmissionVerified(s)).length;
    if (pendingCount === 0) return 'All categories already verified — ending round...';
    const alreadyDone = subsToCheck.length - pendingCount;
    const tail = alreadyDone > 0 ? ` (${alreadyDone} already verified)` : '';
    return `Verifying ${pendingCount} ${noun}${pendingCount === 1 ? '' : 's'} with AI${tail}...`;
};

// Sentinel for the "AI rejected one of your cells" path: a user-actionable outcome
// (retake the cell), not a bug, so it's surfaced via toast only (no console.error).
class AiRejectionError extends Error {}

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

    const runVerifyAndEnd = useCallback(
        async (subsToCheck: Submission[], loadingLabel: string) => {
            const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
            if (!mapsKey) {
                toast.error('AI verification is unavailable: missing API keys.');
                return;
            }

            // A lingering `false` verdict (cleared on retake) means the player must
            // replace that submission before the round can end.
            const previouslyRejected = subsToCheck.filter((s) => s.ai_verdict === false);
            if (previouslyRejected.length > 0) {
                toast.error(`Retake ${previouslyRejected.length} AI-rejected ${previouslyRejected.length === 1 ? 'category' : 'categories'} before ending: ${previouslyRejected.map((s) => s.category).join(', ')}`);
                return;
            }

            setIsVerifying(true);
            setAiVerificationSuccess(false);
            const verifyPromise = (async () => {
                const results = await verifySubmissions(subsToCheck, mapsKey);

                const optimisticUpdates = new Map(results.map((r) => [r.submissionId, r.error ? { ai_verdict: null, ai_verified_hash: null, ai_reason: null } : { ai_verdict: r.passed, ai_verified_hash: r.hash, ai_reason: r.reason ?? null }]));
                setAllSubmissions((prev) => prev.map((s) => (optimisticUpdates.has(s.id) ? { ...s, ...optimisticUpdates.get(s.id)! } : s)));

                const persistTasks = results.filter((r) => !r.fromCache && !r.error).map((r) => supabase.rpc('set_submission_ai_verdict', { p_id: r.submissionId, p_player_id: playerId, p_verdict: r.passed, p_hash: r.hash }));
                // rpc reports failures via { error } / data.success, not by throwing — so
                // bail before ending the round if any verdict failed to persist.
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
                throw new AiRejectionError(`${parts.join(', ')}. Retake or try again.`);
            })();

            try {
                await toast.promise(verifyPromise, {
                    loading: loadingLabel,
                    success: 'All categories verified — ending round.',
                    error: (err) => `AI verification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
                });
            } catch (err) {
                if (!(err instanceof AiRejectionError)) console.error('AI verification error:', err);
                setAiVerificationSuccess(false);
            } finally {
                setIsVerifying(false);
            }
        },
        [gameId, playerId, setAllSubmissions, notifyGameEvent],
    );

    const handleVerifyAndEnd = async () => {
        if (isVerifying) return;
        if (!allCategoriesFilled) {
            toast.error('Fill every category before AI verification.');
            return;
        }
        const subsToCheck = myBoard.map((cat) => mySubmissions.find((s) => s.category === cat)).filter((s): s is Submission => !!s);
        await runVerifyAndEnd(subsToCheck, buildVerifyLabel(subsToCheck, 'category'));
    };

    const handleVerifyBingoAndEnd = async (bingoLineSubs: Submission[]) => {
        if (isVerifying) return;
        if (bingoLineSubs.length === 0) {
            toast.error('Get a Bingo first to verify.');
            return;
        }
        await runVerifyAndEnd(bingoLineSubs, buildVerifyLabel(bingoLineSubs, 'Bingo category'));
    };

    return { isVerifying, aiVerificationSuccess, allCategoriesFilled, handleVerifyAndEnd, handleVerifyBingoAndEnd };
}
