'use client';

/*
================================================================================
STREET VIEW SIDEBAR
================================================================================
The right column of the play screen: the round controls header (landscape only),
the submission count, and the category checklist — rendered as a list
(ChecklistList) or a bingo grid (BingoBoard) depending on game mode.
================================================================================
*/

import { useT } from '@/lib/i18n/I18nProvider';

import BingoBoard from './BingoBoard';
import ChecklistList from './ChecklistList';
import RoundControls from './RoundControls';
import type { HintMap } from './streetViewHelpers';
import { Submission } from '../utils/types';

interface StreetViewSidebarProps {
    isMobileLandscape: boolean;
    isPortrait: boolean;
    sidebarWidthClass: string;
    gameMode: 'list' | 'bingo';
    gridSize: number;
    textSizeClass: string;

    // round controls
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

    // board data
    listLayout: 'roomy' | 'compact';
    setGridEl: (el: HTMLDivElement | null) => void;
    myBoard: string[];
    mySubmissions: Submission[];
    otherSubmissions: Submission[];
    exclusiveMode: boolean;
    allowHints: boolean;
    submittingCategory: string | null;
    inStreetView: boolean;
    handleSubmit: (category: string) => void;
    jumpToLocation: (sub: Submission) => void;
    hintByCategory?: HintMap;
    handleBingoTileClick: (category: string) => void;
}

export default function StreetViewSidebar(props: StreetViewSidebarProps) {
    const { t } = useT();
    const { isMobileLandscape, isPortrait, sidebarWidthClass, gameMode } = props;

    return (
        <div className={`${isMobileLandscape ? 'basis-[42%] max-w-[42%]' : isPortrait ? 'w-full' : sidebarWidthClass} flex flex-col gap-4 bg-slate-800 ${isPortrait ? '' : 'sm:p-6'} rounded-2xl shadow-xl h-full min-h-0 border border-2 border-slate-700 overflow-hidden transition-all`}>
            {!isPortrait && <RoundControls variant="sidebar" timeLeft={props.timeLeft} aiEndGame={props.aiEndGame} isBingoFirstWithAi={props.isBingoFirstWithAi} handleAiVerifyAndEnd={props.handleAiVerifyAndEnd} allCategoriesFilled={props.allCategoriesFilled} isVerifying={props.isVerifying} handleVoteEndRound={props.handleVoteEndRound} hasVotedToEnd={props.hasVotedToEnd} aiVerificationSuccess={props.aiVerificationSuccess} readyPlayers={props.readyPlayers} votesNeeded={props.votesNeeded} />}

            <div className={`justify-between items-center mb-2 ${isPortrait ? 'hidden' : 'hidden sm:flex'}`}>
                <h2 className="text-indigo-400 font-bold text-xl tracking-wide uppercase">{gameMode === 'bingo' ? t('sv.bingoBoard') : t('sv.checklist')}</h2>
                <span className="bg-slate-700 text-slate-300 font-bold px-3 py-1 rounded-full text-sm">
                    {props.mySubmissions.length} / {props.myBoard.length}
                </span>
            </div>

            {gameMode === 'list' ? (
                <ChecklistList listLayout={props.listLayout} isPortrait={isPortrait} setGridEl={props.setGridEl} myBoard={props.myBoard} mySubmissions={props.mySubmissions} otherSubmissions={props.otherSubmissions} exclusiveMode={props.exclusiveMode} allowHints={props.allowHints} submittingCategory={props.submittingCategory} inStreetView={props.inStreetView} handleSubmit={props.handleSubmit} jumpToLocation={props.jumpToLocation} hintByCategory={props.hintByCategory} />
            ) : (
                <BingoBoard gridSize={props.gridSize} myBoard={props.myBoard} mySubmissions={props.mySubmissions} otherSubmissions={props.otherSubmissions} exclusiveMode={props.exclusiveMode} allowHints={props.allowHints} submittingCategory={props.submittingCategory} inStreetView={props.inStreetView} textSizeClass={props.textSizeClass} handleSubmit={props.handleSubmit} handleBingoTileClick={props.handleBingoTileClick} jumpToLocation={props.jumpToLocation} hintByCategory={props.hintByCategory} />
            )}
        </div>
    );
}
