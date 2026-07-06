'use client';

/*
================================================================================
ROUND CONTROLS
================================================================================
The timer readout plus the "AI Verify & End" and "End Vote" buttons shown
during a round. Rendered in two layouts: a `portrait` header (above the map on
narrow/portrait screens) and a `sidebar` header (inside the checklist panel on
landscape/desktop).
================================================================================
*/

import { useT } from '@/lib/i18n/I18nProvider';

interface RoundControlsProps {
    variant: 'portrait' | 'sidebar';
    isNarrow?: boolean;
    timeLeft: number;
    aiEndGame: boolean;
    isBingoFirstWithAi: boolean;
    handleAiVerifyAndEnd: () => void;
    allCategoriesFilled: boolean;
    isVerifying: boolean;
    handleVoteEndRound: () => void;
    hasVotedToEnd: boolean;
    aiVerificationSuccess: boolean;
    readyPlayers: string[];
    votesNeeded: number;
}

const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function RoundControls({ variant, isNarrow = false, timeLeft, aiEndGame, isBingoFirstWithAi, handleAiVerifyAndEnd, allCategoriesFilled, isVerifying, handleVoteEndRound, hasVotedToEnd, aiVerificationSuccess, readyPlayers, votesNeeded }: RoundControlsProps) {
    const { t } = useT();
    const timer = timeLeft <= 60 ? <span className="text-red-500 animate-pulse">{formatTime(timeLeft)}</span> : <span className="text-white">{formatTime(timeLeft)}</span>;

    if (variant === 'portrait') {
        return (
            <div className={`flex justify-between w-full mx-auto text-white ${isNarrow ? 'flex-col gap-3 mb-3' : 'items-center mb-4'}`}>
                <div className="flex items-stretch gap-3 sm:gap-6 w-full sm:w-auto">
                    <div className="glass flex items-center justify-center text-xl sm:text-3xl font-black px-3 sm:px-6 rounded-lg sm:rounded-xl tracking-wider py-1.5 sm:py-2">{timer}</div>

                    <div className="ml-auto flex items-stretch justify-end gap-2 sm:gap-4">
                        {aiEndGame && !isBingoFirstWithAi && (
                            <button
                                type="button"
                                onClick={handleAiVerifyAndEnd}
                                disabled={!allCategoriesFilled || isVerifying}
                                title={!allCategoriesFilled ? t('sv.fillToEnable') : t('sv.verifyAllEnd')}
                                className={`flex items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm
                                    ${!allCategoriesFilled || isVerifying ? 'glass-inset text-slate-500 cursor-not-allowed' : 'btn-sheen press bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]'}`}
                            >
                                {isVerifying ? t('sv.verifying') : t('sv.aiVerifyEnd')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleVoteEndRound}
                            disabled={hasVotedToEnd}
                            className={`flex flex-col items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm leading-tight text-center border-2
                                        ${aiVerificationSuccess ? 'border-green-500' : 'border-transparent'}
                                ${hasVotedToEnd ? 'glass-inset text-slate-500 cursor-not-allowed' : 'btn-sheen press bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-[0_10px_20px_-8px_rgba(244,63,94,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]'}`}
                        >
                            <span>{hasVotedToEnd ? t('sv.wait') : t('sv.endVote')}</span>
                            <span className="text-[9px] sm:text-xs normal-case opacity-80">{t('sv.voted', { count: readyPlayers.length, total: votesNeeded })}</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-stretch gap-2 sm:gap-4 pb-3 border-b border-white/10">
            <div className="glass-inset flex items-center justify-center text-base sm:text-2xl font-black px-3 sm:px-4 rounded-lg tracking-wider py-1.5 sm:py-2">{timer}</div>

            <div className="ml-auto flex items-stretch justify-end gap-2">
                {aiEndGame && !isBingoFirstWithAi && (
                    <button
                        type="button"
                        onClick={handleAiVerifyAndEnd}
                        disabled={!allCategoriesFilled || isVerifying}
                        title={!allCategoriesFilled ? t('sv.fillToEnable') : t('sv.verifyAllEnd')}
                        className={`flex flex-col items-center justify-center whitespace-nowrap px-2 sm:px-3 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-xs leading-tight text-center
                                ${!allCategoriesFilled || isVerifying ? 'glass-inset text-slate-500 cursor-not-allowed' : 'btn-sheen press bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]'}`}
                    >
                        <span>{isVerifying ? t('sv.verifying') : t('sv.aiVerifyEnd')}</span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleVoteEndRound}
                    disabled={hasVotedToEnd}
                    className={`flex flex-col items-center justify-center whitespace-nowrap px-2 sm:px-3 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-xs leading-tight text-center border-2
                        ${aiVerificationSuccess ? 'border-green-500' : 'border-transparent'}
                        ${hasVotedToEnd ? 'glass-inset text-slate-500 cursor-not-allowed' : 'btn-sheen press bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-[0_10px_20px_-8px_rgba(244,63,94,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]'}`}
                >
                    <span>{hasVotedToEnd ? t('sv.wait') : t('sv.endVote')}</span>
                    <span className="text-[9px] sm:text-[10px] normal-case opacity-80">{t('sv.voted', { count: readyPlayers.length, total: votesNeeded })}</span>
                </button>
            </div>
        </div>
    );
}
