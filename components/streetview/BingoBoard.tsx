'use client';

/*
================================================================================
BINGO BOARD
================================================================================
The bingo-mode grid of category tiles. Each tile shows its category, an optional
hint and (on larger screens) action buttons to capture / overwrite / view /
verify a submission. Tapping a tile on mobile submits the category directly.
================================================================================
*/

import { FaCamera, FaCheck, FaEye, FaInfoCircle } from 'react-icons/fa';

import { getHintForCategory, getStreetViewImageUrl } from './streetViewHelpers';
import { Submission } from '../utils/types';

interface BingoBoardProps {
    gridSize: number;
    myBoard: string[];
    mySubmissions: Submission[];
    otherSubmissions: Submission[];
    exclusiveMode: boolean;
    allowHints: boolean;
    startingPoint: string;
    submittingCategory: string | null;
    inStreetView: boolean;
    verifyingIds: Set<string>;
    textSizeClass: string;
    handleSubmit: (category: string) => void;
    handleBingoTileClick: (category: string) => void;
    jumpToLocation: (sub: Submission) => void;
    handleVerifyOne: (sub: Submission) => void;
}

export default function BingoBoard({ gridSize, myBoard, mySubmissions, otherSubmissions, exclusiveMode, allowHints, startingPoint, submittingCategory, inStreetView, verifyingIds, textSizeClass, handleSubmit, handleBingoTileClick, jumpToLocation, handleVerifyOne }: BingoBoardProps) {
    return (
        <div className={`grid gap-2 flex-1 min-h-0 overflow-y-auto pr-1 auto-rows-fr bingo-grid-${gridSize}`}>
            {/* Bingo Mode Grid View */}
            {myBoard.map((cat) => {
                const foundSub = mySubmissions.find((s) => s.category === cat);
                const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                const hint = allowHints ? getHintForCategory(cat) : null;
                const streetViewImageUrl = foundSub ? getStreetViewImageUrl(foundSub, 400) : '';

                return (
                    <div
                        key={cat}
                        title={isBlocked ? 'Claimed by another team' : foundSub?.ai_verdict === false ? 'AI could not verify this category' : foundSub?.ai_verdict === true ? 'AI verified ✓' : undefined}
                        onClick={() => handleBingoTileClick(cat)}
                        className={`relative p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-center items-center text-center pb-2 sm:pb-12 ${foundSub ? 'text-white border-slate-600 shadow-md' : isBlocked ? 'bg-slate-900/80 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700'} ${foundSub?.ai_verdict === false ? '!border-red-500' : foundSub?.ai_verdict === true ? '!border-green-500' : ''}`}
                    >
                        {/* Background Layer */}
                        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                            {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                            {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                        </div>

                        {hint && (
                            <div className="absolute top-1 right-1 sm:top-2 sm:right-2 z-[60] group cursor-help" onClick={(e) => e.stopPropagation()}>
                                <FaInfoCircle className={`transition-colors text-[11px] sm:text-sm drop-shadow-md ${foundSub ? 'text-white/70 hover:text-white' : 'text-slate-400/70 hover:text-white'}`} />
                                <div className="absolute bottom-full right-0 sm:left-1/2 sm:-translate-x-1/2 mb-1 sm:mb-2 hidden group-hover:block w-max max-w-[150px] sm:max-w-[200px] bg-slate-800 text-white text-[10px] sm:text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-left sm:text-center cursor-default">
                                    <span className="font-bold text-indigo-300">Tipp:</span> {hint}
                                </div>
                            </div>
                        )}

                        <span className={`relative z-10 ${textSizeClass} font-bold leading-tight line-clamp-3 [hyphens:auto] [word-break:break-word] mt-0 sm:mt-1 ${foundSub?.ai_verdict === false ? 'text-red-400' : foundSub ? 'drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] text-white' : isBlocked ? 'text-red-400' : 'text-white'}`}>{cat}</span>

                        <div className="absolute bottom-2 w-[90%] left-[5%] h-[25%] max-h-12 hidden sm:flex flex-row justify-center gap-2 z-10">
                            {!foundSub ? (
                                <button
                                    type="button"
                                    title={isBlocked ? 'Claimed by another team' : 'Add submission'}
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
                                        title="Overwrite submission"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSubmit(cat);
                                        }}
                                        disabled={submittingCategory === cat || !inStreetView}
                                        className={`flex-1 h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-amber-700/40 hover:bg-amber-600/40 text-white'}`}
                                    >
                                        {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                    </button>
                                    {startingPoint === 'open-world' ? (
                                        <button
                                            type="button"
                                            title="View submission"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                jumpToLocation(foundSub);
                                            }}
                                            className="hidden sm:flex flex-1 h-full bg-slate-600/30 hover:bg-slate-500/30 text-white font-bold rounded-lg uppercase justify-center items-center"
                                        >
                                            <FaEye className="h-[60%] w-auto" />
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            title="Verify submission with AI"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleVerifyOne(foundSub);
                                            }}
                                            disabled={verifyingIds.has(foundSub.id)}
                                            className="flex flex-1 h-full bg-indigo-600/40 hover:bg-indigo-500/40 text-white font-bold rounded-lg uppercase justify-center items-center disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {verifyingIds.has(foundSub.id) ? '...' : <FaCheck className="h-[60%] w-auto" />}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
