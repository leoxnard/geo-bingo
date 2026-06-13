/*
================================================================================
VOTE TALLYING HELPERS
================================================================================
A submission's `votes` map mixes several things, all keyed off the voter id:
  - yes/no votes:    votes[playerId]        = true | false
  - scale votes:     votes[playerId]        = 0..10  (rating mode; replaces yes/no)
  - hype votes:      votes[`hype:${id}`]    = true   (an optional "extra points"
                                                       cheer, worth half a point)
  - host_continued:  a sentinel the host writes to force the round forward
These helpers keep the counting consistent everywhere so a hype is never
mistaken for a yes vote, a scale rating never inflates the yes/no tally, and the
host sentinel never counts.
================================================================================
*/

export const HYPE_PREFIX = 'hype:';

export interface VoteTally {
    yes: number;
    no: number;
    hype: number;
}

export interface ScaleTally {
    sum: number;
    count: number;
    avg: number;
}

type VoteMap = Record<string, boolean | number> | null | undefined;

// Count real yes/no votes plus hype, ignoring the host_continued sentinel and any
// numeric scale-voting ratings (which live under the same voter-id keys).
export function tallyVotes(votes: VoteMap): VoteTally {
    let yes = 0;
    let no = 0;
    let hype = 0;
    if (votes) {
        for (const [key, value] of Object.entries(votes)) {
            if (key === 'host_continued') continue;
            if (key.startsWith(HYPE_PREFIX)) {
                if (value === true) hype++;
                continue;
            }
            if (value === true) yes++;
            else if (value === false) no++;
        }
    }
    return { yes, no, hype };
}

// Sum and average of scale-voting ratings (numeric values keyed off voter ids),
// ignoring hype keys and the host_continued sentinel.
export function tallyScale(votes: VoteMap): ScaleTally {
    let sum = 0;
    let count = 0;
    if (votes) {
        for (const [key, value] of Object.entries(votes)) {
            if (key === 'host_continued' || key.startsWith(HYPE_PREFIX)) continue;
            if (typeof value === 'number') {
                sum += value;
                count++;
            }
        }
    }
    return { sum, count, avg: count > 0 ? sum / count : 0 };
}

// A given player's existing scale rating for a submission, or null if not yet cast.
export function scaleVoteOf(votes: VoteMap, playerId: string): number | null {
    const v = votes?.[playerId];
    return typeof v === 'number' ? v : null;
}

// Whether a given player has hyped this submission.
export function hasHyped(votes: VoteMap, playerId: string): boolean {
    return votes?.[`${HYPE_PREFIX}${playerId}`] === true;
}
