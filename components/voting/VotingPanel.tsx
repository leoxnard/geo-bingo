'use client';

/*
================================================================================
VOTING PANEL COMPONENT
================================================================================
Bottom-of-screen voting card shown for the currently active submission.
Three visual states:
  - voting is closed (everyone eligible has cast) -> tally summary
  - this submission belongs to the viewer or the viewer's team -> read-only tally
  - otherwise -> YES/NO vote buttons + live counts
================================================================================
*/

import type { Player, Submission } from '../utils/types';

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
    players: Player[];
    playerId: string;
    teamMode: 'ffa' | 'teams';
    onVote: (sub: Submission, voteIsYes: boolean) => void;
}

export function VotingPanel({ displaySub, activeSubLatest, votingStats, yesVotes, noVotes, players, playerId, teamMode, onVote }: VotingPanelProps) {
    const statusLine = votingStats.eligibleCount === 0 && activeSubLatest ? 'Single Player Vote - No votes needed' : votingStats.isComplete ? 'Voting Complete - Continuing...' : `Awaiting Votes... (${votingStats.cast}/${votingStats.eligibleCount})`;

    const subPlayerTeam = players.find((p) => p.id === activeSubLatest?.player_id)?.team;
    const myTeam = players.find((p) => p.id === playerId)?.team;
    const isMySubmission = playerId === activeSubLatest?.player_id;
    const isMyTeamSubmission = teamMode === 'teams' && subPlayerTeam !== undefined && subPlayerTeam === myTeam;

    return (
        <div className="max-w-xl mx-auto">
            <h3 className="text-2xl font-black text-white mb-1 text-center truncate">{displaySub.category}</h3>
            <p className="text-sm text-indigo-300 mb-4 text-center uppercase tracking-widest font-semibold">{statusLine}</p>

            <div className="flex gap-4">
                {votingStats.isComplete ? (
                    <div className="flex-1 py-4 text-center text-green-400 font-bold uppercase border border-green-700 rounded-xl bg-green-900/30">
                        Voting Complete <br />
                        <span className="text-sm text-green-300/80 normal-case mt-1 inline-block">
                            ({yesVotes} Y / {noVotes} N)
                        </span>
                    </div>
                ) : isMySubmission || isMyTeamSubmission ? (
                    <div className="flex-1 py-4 text-center text-slate-400 font-bold uppercase border border-slate-700 rounded-xl bg-slate-900/50">
                        {isMySubmission ? 'Your Submission' : 'Team Submission'} <br />
                        <span className="text-sm text-slate-500 normal-case mt-1 inline-block">
                            Y: {yesVotes} | N: {noVotes}
                        </span>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 flex flex-col gap-2">
                            <button type="button" onClick={() => activeSubLatest && onVote(activeSubLatest, true)} className={`w-full py-4 rounded-xl font-black uppercase text-lg border transition-all ${activeSubLatest?.votes?.[playerId] === true ? 'bg-green-600 border-green-400 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-green-500 hover:text-green-500 hover:bg-green-900/30'}`}>
                                Yes
                            </button>
                            <div className="text-center text-green-400 font-bold text-sm tracking-wide">{yesVotes} Votes</div>
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                            <button type="button" onClick={() => activeSubLatest && onVote(activeSubLatest, false)} className={`w-full py-4 rounded-xl font-black uppercase text-lg border transition-all ${activeSubLatest?.votes?.[playerId] === false ? 'bg-red-600 border-red-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-red-500 hover:text-red-500 hover:bg-red-900/30'}`}>
                                No
                            </button>
                            <div className="text-center text-red-400 font-bold text-sm tracking-wide">{noVotes} Votes</div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
