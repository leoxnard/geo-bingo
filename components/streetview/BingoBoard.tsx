'use client';

/*
================================================================================
BINGO BOARD
================================================================================
The bingo-mode grid of category tiles. Each tile shows its category, an optional
hint and (on larger screens) action buttons to capture / overwrite / view a
submission. Tapping a tile on mobile submits the category directly.
================================================================================
*/

import { FaCamera, FaEye, FaInfoCircle } from 'react-icons/fa';

import { useT } from '@/lib/i18n/I18nProvider';

import { getStreetViewImageUrl, resolveHint, type HintMap } from './streetViewHelpers';
import { Submission } from '../utils/types';

interface BingoBoardProps {
    gridSize: number;
    myBoard: string[];
    mySubmissions: Submission[];
    otherSubmissions: Submission[];
    exclusiveMode: boolean;
    allowHints: boolean;
    submittingCategory: string | null;
    inStreetView: boolean;
    textSizeClass: string;
    handleSubmit: (category: string) => void;
    handleBingoTileClick: (category: string) => void;
    jumpToLocation: (sub: Submission) => void;
    hintByCategory?: HintMap;
    labelByCategory?: Record<string, string>;
}

export default function BingoBoard({ gridSize, myBoard, mySubmissions, otherSubmissions, exclusiveMode, allowHints, submittingCategory, inStreetView, textSizeClass, handleSubmit, handleBingoTileClick, jumpToLocation, hintByCategory = {}, labelByCategory = {} }: BingoBoardProps) {
    const { t } = useT();
    return (
        <div className={`grid gap-2 flex-1 min-h-0 overflow-y-auto pr-1 auto-rows-fr bingo-grid-${gridSize}`}>
            {myBoard.map((cat, i) => {
                const foundSub = mySubmissions.find((s) => s.category === cat);
                const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                const hint = allowHints ? resolveHint(cat, hintByCategory) : null;
                const streetViewImageUrl = foundSub ? getStreetViewImageUrl(foundSub, 400) : '';

                return (
                    <div
                        key={`${i}-${cat}`}
                        title={isBlocked ? t('sv.claimedByTeam') : foundSub?.ai_verdict === false ? t('sv.aiCouldNotVerify') : foundSub?.ai_verdict === true ? `${t('sv.aiVerified')} ✓` : undefined}
                        onClick={() => handleBingoTileClick(cat)}
                        className={`relative p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-center items-center text-center pb-2 sm:pb-12 ${foundSub ? 'text-white border-white/25 shadow-md' : isBlocked ? 'glass-inset !border-red-500 opacity-60' : 'glass hover:brightness-125'} ${foundSub?.ai_verdict === false ? '!border-red-500' : foundSub?.ai_verdict === true ? '!border-green-500' : ''}`}
                    >
                        {/* Background Layer */}
                        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                            {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover animate-pop-in" />}
                            {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                        </div>

                        {hint && (
                            <div className="absolute top-1 right-1 sm:top-2 sm:right-2 z-[60] group cursor-help" onClick={(e) => e.stopPropagation()}>
                                {/* A focusable button so the hint also opens on tap (touch
                                    devices have no hover) and via keyboard. */}
                                <button type="button" aria-label={t('sv.tip')} className="block p-0.5 -m-0.5">
                                    <FaInfoCircle className={`transition-colors text-[11px] sm:text-sm drop-shadow-md ${foundSub ? 'text-white/70 hover:text-white' : 'text-slate-400/70 hover:text-white'}`} />
                                </button>
                                <div className="glass-dark absolute bottom-full right-0 sm:left-1/2 sm:-translate-x-1/2 mb-1 sm:mb-2 hidden group-hover:block group-focus-within:block w-max max-w-[150px] sm:max-w-[200px] text-white text-[10px] sm:text-xs p-2 rounded-lg z-[100] whitespace-normal text-left sm:text-center cursor-default">
                                    <span className="font-bold text-indigo-300">{t('sv.tip')}</span> {hint}
                                </div>
                            </div>
                        )}

                        <span className={`relative z-10 ${textSizeClass} font-bold leading-tight line-clamp-3 [hyphens:auto] [word-break:break-word] mt-0 sm:mt-1 ${foundSub?.ai_verdict === false ? 'text-red-400' : foundSub ? 'drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] text-white' : isBlocked ? 'text-red-400' : 'text-white'}`}>{labelByCategory[cat] ?? cat}</span>

                        <div className="absolute bottom-2 w-[90%] left-[5%] h-[25%] max-h-12 hidden sm:flex flex-row justify-center gap-2 z-10">
                            {!foundSub ? (
                                <button
                                    type="button"
                                    title={isBlocked ? t('sv.claimedByTeam') : t('sv.addSubmission')}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSubmit(cat);
                                    }}
                                    disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                    className={`w-full h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center ${isBlocked ? 'bg-red-900/50 text-red-500 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                >
                                    {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        title={t('sv.overwriteSubmission')}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSubmit(cat);
                                        }}
                                        disabled={submittingCategory === cat || !inStreetView}
                                        className={`flex-1 h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-amber-700/40 hover:bg-amber-600/40 text-white'}`}
                                    >
                                        {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                    </button>
                                    <button
                                        type="button"
                                        title={t('sv.viewSubmission')}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            jumpToLocation(foundSub);
                                        }}
                                        className="hidden sm:flex flex-1 h-full bg-slate-600/30 hover:bg-slate-500/30 text-white font-bold rounded-lg uppercase justify-center items-center"
                                    >
                                        <FaEye className="h-[60%] w-auto" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
