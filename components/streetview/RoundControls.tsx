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
                    <div className="flex items-center justify-center text-xl sm:text-3xl font-black bg-slate-800 px-3 sm:px-6 rounded-lg sm:rounded-xl border border-slate-700 shadow-lg tracking-wider py-1.5 sm:py-2">{timer}</div>

                    <div className="ml-auto flex items-stretch justify-end gap-2 sm:gap-4">
                        {aiEndGame && !isBingoFirstWithAi && (
                            <button
                                type="button"
                                onClick={handleAiVerifyAndEnd}
                                disabled={!allCategoriesFilled || isVerifying}
                                title={!allCategoriesFilled ? t('sv.fillToEnable') : t('sv.verifyAllEnd')}
                                className={`flex items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm shadow-lg
                                    ${!allCategoriesFilled || isVerifying ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                            >
                                {isVerifying ? t('sv.verifying') : t('sv.aiVerifyEnd')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleVoteEndRound}
                            disabled={hasVotedToEnd}
                            className={`flex flex-col items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm shadow-lg leading-tight text-center border-2
                                        ${aiVerificationSuccess ? 'border-green-500' : 'border-transparent'}
                                ${hasVotedToEnd ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white'}`}
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
        <div className="flex items-stretch gap-2 sm:gap-4 pb-3 border-b border-slate-700">
            <div className="flex items-center justify-center text-base sm:text-2xl font-black bg-slate-700 px-3 sm:px-4 rounded-lg border border-slate-600 shadow-lg tracking-wider py-1.5 sm:py-2">{timer}</div>

            <div className="ml-auto flex items-stretch justify-end gap-2">
                {aiEndGame && !isBingoFirstWithAi && (
                    <button
                        type="button"
                        onClick={handleAiVerifyAndEnd}
                        disabled={!allCategoriesFilled || isVerifying}
                        title={!allCategoriesFilled ? t('sv.fillToEnable') : t('sv.verifyAllEnd')}
                        className={`flex flex-col items-center justify-center whitespace-nowrap px-2 sm:px-3 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-xs shadow-lg leading-tight text-center
                                ${!allCategoriesFilled || isVerifying ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                    >
                        <span>{isVerifying ? t('sv.verifying') : t('sv.aiVerifyEnd')}</span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleVoteEndRound}
                    disabled={hasVotedToEnd}
                    className={`flex flex-col items-center justify-center whitespace-nowrap px-2 sm:px-3 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-xs shadow-lg leading-tight text-center border-2
                        ${aiVerificationSuccess ? 'border-green-500' : 'border-transparent'}
                        ${hasVotedToEnd ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white'}`}
                >
                    <span>{hasVotedToEnd ? t('sv.wait') : t('sv.endVote')}</span>
                    <span className="text-[9px] sm:text-[10px] normal-case opacity-80">{t('sv.voted', { count: readyPlayers.length, total: votesNeeded })}</span>
                </button>
            </div>
        </div>
    );
}
