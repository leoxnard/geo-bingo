'use client';

/*
================================================================================
VOTING PANEL COMPONENT
================================================================================
Bottom-of-screen voting card shown for the currently active submission.
Three visual states:
  - voting is closed (everyone eligible has cast) -> tally summary
  - this submission belongs to the viewer or the viewer's team -> read-only tally
  - otherwise -> the active voting control:
      * yes/no mode  -> YES/NO buttons + Hype, with live counts
      * scale mode   -> a 0–10 slider + Submit (no hype)

Keyboard:
  - yes/no mode: Enter = yes, Backspace = no
  - scale mode:  A / S / ← decrease, D / W / → increase, Enter = submit
================================================================================
*/

import { useState, useEffect, useRef } from 'react';

import { useT } from '@/lib/i18n/I18nProvider';

import type { Player, Submission } from '../utils/types';
import { scaleVoteOf, tallyScale } from '../utils/votes';

interface VotingStats {
    isComplete: boolean;
    cast: number;
    eligibleCount: number;
}

interface VotingPanelProps {
    displaySub: Submission;
    activeSubLatest: Submission | null;
    votingStats: VotingStats;
    yesVotes: number;
    noVotes: number;
    hypeVotes: number;
    hasHyped: boolean;
    players: Player[];
    playerId: string;
    teamMode: 'ffa' | 'teams';
    scaleVoting: boolean;
    onVote: (sub: Submission, voteIsYes: boolean) => void;
    onHype: (sub: Submission) => void;
    onScaleVote: (sub: Submission, value: number) => void;
}

const SCALE_MIN = 0;
const SCALE_MAX = 10;

export function VotingPanel({ displaySub, activeSubLatest, votingStats, yesVotes, noVotes, hypeVotes, hasHyped, players, playerId, teamMode, scaleVoting, onVote, onHype, onScaleVote }: VotingPanelProps) {
    const { t } = useT();
    const statusLine = votingStats.eligibleCount === 0 && activeSubLatest ? t('votingPanel.singlePlayer') : votingStats.isComplete ? t('votingPanel.continuing') : t('votingPanel.awaiting', { cast: votingStats.cast, eligible: votingStats.eligibleCount });

    const subPlayerTeam = players.find((p) => p.id === activeSubLatest?.player_id)?.team;
    const myTeam = players.find((p) => p.id === playerId)?.team;
    const isMySubmission = playerId === activeSubLatest?.player_id;
    const isMyTeamSubmission = teamMode === 'teams' && subPlayerTeam !== undefined && subPlayerTeam === myTeam;

    // The viewer is voting (not their own/team's submission, voting still open).
    const canVote = !!activeSubLatest && !votingStats.isComplete && !isMySubmission && !isMyTeamSubmission;

    // Scale slider state — default 0 each time a new submission surfaces, or the
    // viewer's already-cast rating so they can adjust it before voting closes.
    const existingScale = scaleVoteOf(activeSubLatest?.votes, playerId);
    const [sliderValue, setSliderValue] = useState(existingScale ?? SCALE_MIN);
    // Mirror the live value so the keyboard handler can read it without re-binding
    // the window listener on every tick.
    const sliderValueRef = useRef(sliderValue);
    sliderValueRef.current = sliderValue;
    useEffect(() => {
        setSliderValue(scaleVoteOf(activeSubLatest?.votes, playerId) ?? SCALE_MIN);
        // Re-seed only when the active submission changes (not on every vote tick).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSubLatest?.id]);

    const scaleTally = tallyScale(activeSubLatest?.votes);

    // Keyboard control for whichever voting mode is active.
    useEffect(() => {
        if (!canVote || !activeSubLatest) return;

        const handler = (e: KeyboardEvent) => {
            // Ignore while typing into a text field (the range slider is intentionally
            // NOT excluded — we drive it ourselves and preventDefault below so a
            // focused slider never double-steps on the arrow keys).
            const target = e.target as HTMLElement | null;
            const isTextField = !!target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') || target.isContentEditable);
            if (isTextField) return;

            const key = e.key.toLowerCase();

            if (scaleVoting) {
                if (key === 'a' || key === 's' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setSliderValue((v) => Math.max(SCALE_MIN, v - 1));
                } else if (key === 'd' || key === 'w' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    setSliderValue((v) => Math.min(SCALE_MAX, v + 1));
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    onScaleVote(activeSubLatest, sliderValueRef.current);
                }
            } else {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onVote(activeSubLatest, true);
                } else if (e.key === 'Backspace') {
                    e.preventDefault();
                    onVote(activeSubLatest, false);
                }
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [canVote, activeSubLatest, scaleVoting, onScaleVote, onVote]);

    return (
        <div className="max-w-xl mx-auto">
            <h3 className="text-2xl font-black text-white mb-1 text-center truncate">{displaySub.category}</h3>
            <p className="text-sm text-indigo-300 mb-4 text-center uppercase tracking-widest font-semibold">{statusLine}</p>

            <div className="flex gap-4">
                {votingStats.isComplete ? (
                    <div className="flex-1 py-4 text-center text-green-400 font-bold uppercase border border-green-700 rounded-xl bg-green-900/30">
                        {t('votingPanel.complete')} <br />
                        <span className="text-sm text-green-300/80 normal-case mt-1 inline-block">{scaleVoting ? `(Ø ${scaleTally.avg.toFixed(1)} · ${t('votingPanel.scaleSum', { sum: scaleTally.sum })})` : `(${yesVotes} Y / ${noVotes} N${hypeVotes > 0 ? ` / ${hypeVotes} H` : ''})`}</span>
                    </div>
                ) : isMySubmission || isMyTeamSubmission ? (
                    <div className="flex-1 py-4 text-center text-slate-400 font-bold uppercase border border-slate-700 rounded-xl bg-slate-900/50">
                        {isMySubmission ? t('votingPanel.yourSubmission') : t('votingPanel.teamSubmission')} <br />
                        <span className="text-sm text-slate-500 normal-case mt-1 inline-block">{scaleVoting ? `Ø ${scaleTally.avg.toFixed(1)} · ${t('votingPanel.scaleSum', { sum: scaleTally.sum })}` : `Y: ${yesVotes} | N: ${noVotes}${hypeVotes > 0 ? ` | H: ${hypeVotes}` : ''}`}</span>
                    </div>
                ) : scaleVoting ? (
                    <div className="flex-1 flex flex-col gap-4">
                        <div className="flex items-center justify-center">
                            <span className="text-5xl font-black text-indigo-400 tabular-nums drop-shadow-[0_0_12px_rgba(79,70,229,0.5)]">{sliderValue}</span>
                        </div>
                        <input
                            type="range"
                            min={SCALE_MIN}
                            max={SCALE_MAX}
                            step={1}
                            value={sliderValue}
                            onChange={(e) => setSliderValue(Number(e.target.value))}
                            className="w-full h-3 rounded-full appearance-none cursor-pointer bg-slate-700 accent-indigo-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(79,70,229,0.7)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-500 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
                            style={{ background: `linear-gradient(to right, #4f46e5 0%, #4f46e5 ${(sliderValue / SCALE_MAX) * 100}%, #334155 ${(sliderValue / SCALE_MAX) * 100}%, #334155 100%)` }}
                        />
                        <div className="flex justify-between text-xs font-bold text-slate-500 px-1">
                            <span>{SCALE_MIN}</span>
                            <span>{SCALE_MAX}</span>
                        </div>
                        <button type="button" onClick={() => activeSubLatest && onScaleVote(activeSubLatest, sliderValue)} className="w-full py-4 rounded-xl font-black uppercase text-lg border bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-500 transition-all shadow-[0_0_15px_rgba(79,70,229,0.4)]">
                            {existingScale !== null ? t('votingPanel.updateRating') : t('votingPanel.submitRating')}
                        </button>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col gap-3">
                        <div className="flex gap-4">
                            <div className="flex-1 flex flex-col gap-2">
                                <button type="button" onClick={() => activeSubLatest && onVote(activeSubLatest, true)} className={`w-full py-4 rounded-xl font-black uppercase text-lg border transition-all ${activeSubLatest?.votes?.[playerId] === true ? 'bg-green-600 border-green-400 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-green-500 hover:text-green-500 hover:bg-green-900/30'}`}>
                                    {t('common.yes')}
                                </button>
                                <div className="text-center text-green-400 font-bold text-sm tracking-wide">{t('votingPanel.votes', { count: yesVotes })}</div>
                            </div>
                            <div className="flex-1 flex flex-col gap-2">
                                <button type="button" onClick={() => activeSubLatest && onVote(activeSubLatest, false)} className={`w-full py-4 rounded-xl font-black uppercase text-lg border transition-all ${activeSubLatest?.votes?.[playerId] === false ? 'bg-red-600 border-red-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-red-500 hover:text-red-500 hover:bg-red-900/30'}`}>
                                    {t('common.no')}
                                </button>
                                <div className="text-center text-red-400 font-bold text-sm tracking-wide">{t('votingPanel.votes', { count: noVotes })}</div>
                            </div>
                        </div>
                        <div className="flex items-center justify-center gap-3">
                            <button type="button" onClick={() => activeSubLatest && onHype(activeSubLatest)} className={`px-5 py-2 rounded-lg font-bold uppercase text-sm border transition-all ${hasHyped ? 'bg-amber-500 border-amber-300 text-white shadow-[0_0_12px_rgba(245,158,11,0.5)]' : 'bg-slate-800 border-slate-600 text-amber-400 hover:border-amber-500 hover:bg-amber-900/30'}`}>
                                {t('votingPanel.hype')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
