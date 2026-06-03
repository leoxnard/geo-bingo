'use client';

/*
================================================================================
CHECKLIST LIST
================================================================================
The list-mode (non-bingo) checklist of categories. Renders either the `compact`
layout (single row per category) or the `roomy` layout (stacked label + actions),
chosen by the parent based on available vertical space.
================================================================================
*/

import { FaInfoCircle } from 'react-icons/fa';

import { useT } from '@/lib/i18n/I18nProvider';

import { AiReasonLabel } from './AiReasonLabel';
import { COMPACT_GAP, COMPACT_MAX, COMPACT_MIN, ROOMY_GAP, ROOMY_MAX, ROOMY_MIN, getAiVerdictState, getHintForCategory, getStreetViewImageUrl } from './streetViewHelpers';
import { Submission } from '../utils/types';

interface ChecklistListProps {
    listLayout: 'roomy' | 'compact';
    setGridEl: (el: HTMLDivElement | null) => void;
    myBoard: string[];
    mySubmissions: Submission[];
    otherSubmissions: Submission[];
    exclusiveMode: boolean;
    allowHints: boolean;
    startingPoint: string;
    submittingCategory: string | null;
    inStreetView: boolean;
    verifyingIds: Set<string>;
    handleSubmit: (category: string) => void;
    jumpToLocation: (sub: Submission) => void;
    handleVerifyOne: (sub: Submission) => void;
}

export default function ChecklistList({ listLayout, setGridEl, myBoard, mySubmissions, otherSubmissions, exclusiveMode, allowHints, startingPoint, submittingCategory, inStreetView, verifyingIds, handleSubmit, jumpToLocation, handleVerifyOne }: ChecklistListProps) {
    const { t } = useT();
    return (
        <div ref={setGridEl} className="flex flex-1 min-h-0 flex-col overflow-hidden">
            {listLayout === 'compact' ? (
                // Compact List View
                <ul className="flex flex-col flex-1 min-h-0 overflow-y-auto p-2 sm:p-0" style={{ gap: COMPACT_GAP }}>
                    {myBoard.map((cat) => {
                        const foundSub = mySubmissions.find((s) => s.category === cat);
                        const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                        const hint = allowHints ? getHintForCategory(cat) : null;
                        const streetViewImageUrl = foundSub ? getStreetViewImageUrl(foundSub) : '';

                        return (
                            <li key={cat} style={{ minHeight: COMPACT_MIN, maxHeight: COMPACT_MAX }} className={`relative p-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 flex-1 w-full ${foundSub ? 'shadow-md border-slate-600' : isBlocked ? 'bg-slate-900 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/30'} ${foundSub?.ai_verdict === false ? '!border-red-500' : foundSub?.ai_verdict === true ? '!border-green-500' : ''}`}>
                                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                    {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                                    {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                                </div>

                                <div className="relative z-10 flex items-center justify-between w-full h-full gap-1.5 min-w-0">
                                    <div className="flex items-center flex-1 min-w-0 gap-1 h-full">
                                        <span className={`text-xs leading-tight truncate font-medium px-1 ${foundSub ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-400' : 'text-white'}`}>{cat}</span>
                                        {hint && (
                                            <div className="relative group flex-shrink-0 cursor-help" onClick={(e) => e.stopPropagation()}>
                                                <FaInfoCircle className={`transition-colors ${foundSub ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-white'}`} size={12} />
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max max-w-[200px] bg-slate-800 text-white text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-center cursor-default">
                                                    <span className="font-bold text-indigo-300">{t('sv.tip')}</span> {hint}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1 h-full">
                                        {!foundSub ? (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSubmit(cat);
                                                }}
                                                disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                                className={`h-full px-4 py-1 text-[8px] font-bold rounded-lg shadow uppercase transition-all whitespace-nowrap ${isBlocked ? 'bg-red-900/50 text-red-300 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                            >
                                                {submittingCategory === cat ? t('sv.saving') : isBlocked ? t('sv.claimed') : !inStreetView ? t('sv.enterStreetview') : t('sv.save')}
                                            </button>
                                        ) : (
                                            <>
                                                {!exclusiveMode && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSubmit(cat);
                                                        }}
                                                        disabled={submittingCategory === cat || !inStreetView}
                                                        className={`px-2 py-1 text-[7px] font-bold rounded-lg shadow uppercase transition-all whitespace-nowrap ${!inStreetView ? 'bg-slate-600/30 text-slate-300 cursor-not-allowed' : 'bg-amber-700/40 hover:bg-amber-600/40 text-white'}`}
                                                    >
                                                        {submittingCategory === cat ? '...' : !inStreetView ? t('sv.enterStreetview') : t('sv.overwrite')}
                                                    </button>
                                                )}
                                                {startingPoint === 'open-world' ? (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            jumpToLocation(foundSub);
                                                        }}
                                                        className={`${exclusiveMode ? 'flex-1' : 'flex-[0.5]'} bg-slate-700/40 hover:bg-slate-500/30 px-2 py-1 text-[7px] text-white font-bold rounded-lg shadow uppercase transition-all whitespace-nowrap`}
                                                    >
                                                        {t('sv.view')}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleVerifyOne(foundSub);
                                                        }}
                                                        disabled={verifyingIds.has(foundSub.id)}
                                                        className={`${exclusiveMode ? 'flex-1' : 'flex-[0.5]'} bg-indigo-600/40 hover:bg-indigo-500/40 px-2 py-1 text-[7px] text-white font-bold rounded-lg shadow uppercase transition-all whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed`}
                                                    >
                                                        {verifyingIds.has(foundSub.id) ? '...' : t('sv.verify')}
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                // Regular View
                <ul className="flex flex-col flex-1 min-h-0 overflow-y-auto p-2 sm:p-0" style={{ gap: ROOMY_GAP }}>
                    {myBoard.map((cat) => {
                        const foundSub = mySubmissions.find((s) => s.category === cat);
                        const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                        const hint = allowHints ? getHintForCategory(cat) : null;
                        const streetViewImageUrl = foundSub ? getStreetViewImageUrl(foundSub) : '';

                        return (
                            <li key={cat} style={{ minHeight: ROOMY_MIN, maxHeight: ROOMY_MAX }} className={`relative p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-between flex-1 w-full ${foundSub ? 'shadow-md border-slate-600' : isBlocked ? 'bg-slate-900 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/30'} ${foundSub?.ai_verdict === false ? '!border-red-500' : foundSub?.ai_verdict === true ? '!border-green-500' : ''}`}>
                                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                    {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                                    {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                                </div>

                                {/* TOP PART */}
                                <div className="relative z-10 flex flex-col w-full">
                                    <div className="flex justify-between items-start w-full gap-1">
                                        <div className="flex items-center flex-1 min-w-0">
                                            <span className={`text-sm truncate font-medium pb-1 ${getAiVerdictState(foundSub) === 'rejected' ? 'text-red-400' : foundSub ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-400' : 'text-white'}`}>{cat}</span>
                                            {hint && (
                                                <div className="ml-1.5 relative group flex-shrink-0 cursor-help" onClick={(e) => e.stopPropagation()}>
                                                    <FaInfoCircle className={`transition-colors ${foundSub ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-white'}`} size={12} />
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max max-w-[200px] bg-slate-800 text-white text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-center cursor-default">
                                                        <span className="font-bold text-indigo-300">{t('sv.tip')}</span> {hint}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        {foundSub?.ai_verdict === false && foundSub?.ai_reason ? (
                                            <AiReasonLabel reason={foundSub.ai_reason} />
                                        ) : (
                                            <span className={`text-[10px] font-bold uppercase whitespace-nowrap flex-shrink-0 ${foundSub?.ai_verdict === false ? 'text-red-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : foundSub?.ai_verdict === true ? 'text-green-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-500' : 'text-slate-500'}`}>
                                                {foundSub?.ai_verdict === false ? t('sv.aiVerifyFailed') : foundSub?.ai_verdict === true ? t('sv.aiVerified') : foundSub ? t('sv.unverified') : isBlocked ? t('sv.locked') : t('sv.pending')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="relative z-10 flex justify-between items-center gap-1 mt-auto w-full">
                                    {!foundSub ? (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleSubmit(cat);
                                            }}
                                            disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                            className={`flex-1 text-[10px] px-2 py-1.5 font-bold rounded-lg shadow uppercase transition-all ${isBlocked ? 'bg-red-900/50 text-red-300 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                        >
                                            {submittingCategory === cat ? 'Saving...' : isBlocked ? 'Claimed' : !inStreetView ? 'Enter Streetview' : 'Save'}
                                        </button>
                                    ) : (
                                        <>
                                            {!exclusiveMode && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSubmit(cat);
                                                    }}
                                                    disabled={submittingCategory === cat || !inStreetView}
                                                    className={`flex-1 text-[9px] px-2 py-1.5 font-bold rounded-lg shadow uppercase transition-all ${!inStreetView ? 'bg-slate-600/30 text-slate-300 cursor-not-allowed' : 'bg-amber-700/40 hover:bg-amber-600/40 text-white'}`}
                                                >
                                                    {submittingCategory === cat ? '...' : !inStreetView ? 'Enter Streetview' : 'Overwrite'}
                                                </button>
                                            )}
                                            {startingPoint === 'open-world' ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        jumpToLocation(foundSub);
                                                    }}
                                                    className={`${exclusiveMode ? 'flex-1' : 'flex-[0.5]'} bg-slate-700/40 hover:bg-slate-500/30 text-[9px] px-2 py-1.5 text-white font-bold rounded-lg shadow uppercase transition-all`}
                                                >
                                                    {t('sv.view')}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleVerifyOne(foundSub);
                                                    }}
                                                    disabled={verifyingIds.has(foundSub.id)}
                                                    className={`${exclusiveMode ? 'flex-1' : 'flex-[0.5]'} bg-indigo-600/40 hover:bg-indigo-500/40 text-[9px] px-2 py-1.5 text-white font-bold rounded-lg shadow uppercase transition-all disabled:opacity-60 disabled:cursor-not-allowed`}
                                                >
                                                    {verifyingIds.has(foundSub.id) ? '...' : 'Verify'}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
