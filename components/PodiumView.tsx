'use client';

/*
================================================================================
PODIUM VIEW COMPONENT
================================================================================
Displays final game results and winner announcements.
Shows player rankings, scores, and voting statistics.
Supports both individual and team game modes with animated podium display.
================================================================================
*/

import { useState, useEffect, useRef } from 'react';

import { useRouter } from 'next/navigation';
import Confetti from 'react-confetti';

import { recordGameResult } from '@/lib/account';
import { buildPresetSeedFromGame } from '@/lib/community';
import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import { useSounds } from '@/lib/sound/SoundProvider';

import { getHostToken } from '../lib/hostToken';
import { supabase } from '../lib/supabase';
import { GeoBingoLogo } from './utils/Elements';
import GlassAmbience from './utils/GlassAmbience';
import { GameFind, ScoreEntity, PlayerStats, PodiumViewProps } from './utils/types';
import { tallyVotes, tallyScale } from './utils/votes';

// Each hype a submission receives is worth this many bonus points to its owner.
const HYPE_POINT_VALUE = 0.5;

export default function PodiumView({ gameId, isHost, teamMode, playerId }: PodiumViewProps) {
    const { t } = useT();
    const router = useRouter();
    const [stats, setStats] = useState<PlayerStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [gameMode, setGameMode] = useState<string>('list');
    const [endCondition, setEndCondition] = useState<string>('');
    const [scaleVoting, setScaleVoting] = useState(false);
    const [animPhase, setAnimPhase] = useState(0);
    const [windowDim, setWindowDim] = useState({ width: 0, height: 0 });
    // Records this player's result exactly once per mount; the RPC is also
    // idempotent per round, so a refresh/remount never double-counts.
    const recordedRef = useRef(false);
    const { play } = useSounds();
    // Fanfare on the winner reveal (animPhase 4, same beat as the confetti), once.
    const fanfarePlayedRef = useRef(false);

    useEffect(() => {
        setWindowDim({ width: window.innerWidth, height: window.innerHeight });
    }, []);

    useEffect(() => {
        if (fanfarePlayedRef.current) return;
        if (animPhase >= 4 && stats.some((s) => s.rank === 1)) {
            fanfarePlayedRef.current = true;
            play('podium-first');
        }
    }, [animPhase, stats, play]);

    useEffect(() => {
        if (!loading) {
            const t0 = setTimeout(() => setAnimPhase(1), 1000);
            const t1 = setTimeout(() => setAnimPhase(2), 1600);
            const t2 = setTimeout(() => setAnimPhase(3), 2400);
            const t3 = setTimeout(() => setAnimPhase(4), 3200);
            const t4 = setTimeout(() => setAnimPhase(5), 5000);

            return () => {
                clearTimeout(t0);
                clearTimeout(t1);
                clearTimeout(t2);
                clearTimeout(t3);
                clearTimeout(t4);
            };
        }
    }, [loading]);

    useEffect(() => {
        const fetchResults = async () => {
            const { data: game } = await supabase.from('games').select('game_mode, grid_size, end_condition, scale_voting').eq('id', gameId).single();
            const { data: players } = await supabase.from('players').select('id, name, bingo_board, team').eq('game_id', gameId);
            const { data: submissions } = await supabase.from('submissions').select('*').eq('game_id', gameId);

            const fetchedGameMode = game?.game_mode || 'list';
            setGameMode(fetchedGameMode);
            setEndCondition(game?.end_condition || '');
            // Scale voting is a list-mode-only mode; never treat a bingo game as scaled.
            const isScaleVoting = !!game?.scale_voting && fetchedGameMode === 'list';
            setScaleVoting(isScaleVoting);
            const gridSize = game?.grid_size || 3;

            if (players && submissions) {
                const entities: ScoreEntity[] = [];

                if (teamMode === 'teams') {
                    const teamsMap = new Map<number, ScoreEntity>();
                    players.forEach((p) => {
                        const t = p.team ?? -1;
                        if (t >= 0) {
                            if (!teamsMap.has(t)) {
                                teamsMap.set(t, {
                                    id: `team-${t}`,
                                    name: p.name,
                                    members: [p],
                                    bingo_board: p.bingo_board,
                                });
                            } else {
                                const entity = teamsMap.get(t)!;
                                entity.members.push(p);
                                entity.name = entity.members.map((m) => m.name).join(' & ');
                            }
                        } else {
                            entities.push({
                                id: p.id,
                                name: p.name,
                                members: [p],
                                bingo_board: p.bingo_board,
                            });
                        }
                    });
                    entities.push(...Array.from(teamsMap.values()));
                } else {
                    players.forEach((p) => {
                        entities.push({
                            id: p.id,
                            name: p.name,
                            members: [p],
                            bingo_board: p.bingo_board,
                        });
                    });
                }

                const playerStats = entities.map((entity) => {
                    const memberIds = entity.members.map((m) => m.id);
                    const entitySubs = submissions.filter((s) => memberIds.includes(s.player_id));

                    let score = 0;
                    let totalYes = 0;
                    let totalNo = 0;
                    let totalHype = 0;
                    let scaleTotal = 0;
                    let scaleCount = 0;
                    let ratedSubs = 0;
                    const validCategories: string[] = [];
                    const rejectedCategories: string[] = [];

                    // Scale voting: a player's score is the sum of every rating their
                    // submissions received. No yes/no threshold, hype, or bingo lines.
                    if (isScaleVoting) {
                        entitySubs.forEach((sub) => {
                            const { sum, count } = tallyScale(sub.votes);
                            scaleTotal += sum;
                            scaleCount += count;
                            if (count > 0) ratedSubs++;
                        });
                        score = scaleTotal;
                    }

                    entitySubs.forEach((sub) => {
                        const { yes: subYes, no: subNo, hype: subHype } = tallyVotes(sub.votes);

                        totalYes += subYes;
                        totalNo += subNo;

                        const totalCast = subYes + subNo;
                        if (totalCast > 0) {
                            if (subYes > totalCast / 2) {
                                score += 1;
                                validCategories.push(sub.category);
                                // Hype only counts on approved submissions — a rejected
                                // category earns no bonus even if some players cheered it.
                                totalHype += subHype;
                                score += subHype * HYPE_POINT_VALUE;
                            } else {
                                rejectedCategories.push(sub.category);
                            }
                        }
                    });

                    let bingoCount = 0;
                    const gridStatus: number[] = [];

                    if (fetchedGameMode === 'bingo' && entity.bingo_board && entity.bingo_board.length >= gridSize * gridSize) {
                        // Build a 2D grid representation of the bingo board with boolean values indicating if the category was found or not
                        const board = entity.bingo_board;
                        const grid: boolean[][] = [];
                        for (let r = 0; r < gridSize; r++) {
                            const row: boolean[] = [];
                            for (let c = 0; c < gridSize; c++) {
                                const cat = board[r * gridSize + c];
                                const isValid = validCategories.includes(cat);
                                row.push(isValid);

                                if (isValid) {
                                    gridStatus.push(1);
                                } else if (rejectedCategories.includes(cat)) {
                                    gridStatus.push(2);
                                } else {
                                    gridStatus.push(0);
                                }
                            }
                            grid.push(row);
                        }

                        // Check for completed lines and mark them in gridStatus
                        for (let r = 0; r < gridSize; r++) {
                            if (grid[r].every((val) => val === true)) {
                                for (let c = 0; c < gridSize; c++) gridStatus[r * gridSize + c] = 3;
                            }
                        }

                        for (let c = 0; c < gridSize; c++) {
                            let isColBingo = true;
                            for (let r = 0; r < gridSize; r++) {
                                if (!grid[r][c]) isColBingo = false;
                            }
                            if (isColBingo) {
                                for (let r = 0; r < gridSize; r++) gridStatus[r * gridSize + c] = 3;
                            }
                        }

                        let isDiag1 = true;
                        for (let i = 0; i < gridSize; i++) {
                            if (!grid[i][i]) isDiag1 = false;
                        }
                        if (isDiag1) {
                            for (let i = 0; i < gridSize; i++) gridStatus[i * gridSize + i] = 3;
                        }

                        let isDiag2 = true;
                        for (let i = 0; i < gridSize; i++) {
                            if (!grid[i][gridSize - 1 - i]) isDiag2 = false;
                        }
                        if (isDiag2) {
                            for (let i = 0; i < gridSize; i++) gridStatus[i * gridSize + (gridSize - 1 - i)] = 3;
                        }

                        const checkLines = () => {
                            let bingosFound = 0;
                            const checkDirection = (rStart: number, cStart: number, rDir: number, cDir: number) => {
                                let r = rStart;
                                let c = cStart;
                                let count = 0;
                                while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
                                    if (!grid[r][c]) return 0;
                                    count++;
                                    r += rDir;
                                    c += cDir;
                                }
                                return count === gridSize ? 1 : 0;
                            };

                            for (let r = 0; r < gridSize; r++) bingosFound += checkDirection(r, 0, 0, 1);
                            for (let c = 0; c < gridSize; c++) bingosFound += checkDirection(0, c, 1, 0);
                            bingosFound += checkDirection(0, 0, 1, 1);
                            bingosFound += checkDirection(0, gridSize - 1, 1, -1);

                            return bingosFound;
                        };

                        bingoCount = checkLines();
                        score += bingoCount * gridSize;
                    }

                    const totalCommunityVotes = totalYes + totalNo;
                    const communityApproval = totalCommunityVotes > 0 ? Math.round((totalYes / totalCommunityVotes) * 100) : 0;
                    const scaleAvg = scaleCount > 0 ? scaleTotal / scaleCount : 0;

                    return {
                        id: entity.id,
                        name: entity.name,
                        score,
                        totalFound: isScaleVoting ? ratedSubs : validCategories.length,
                        bingos: bingoCount,
                        communityApproval,
                        totalYes,
                        totalNo,
                        totalHype,
                        scaleTotal,
                        scaleCount,
                        scaleAvg,
                        rank: 0,
                        gridStatus,
                        gridSize,
                        bingoBoard: entity.bingo_board,
                    };
                });

                playerStats.sort((a, b) => {
                    if (game?.end_condition === 'first_bingo') {
                        if (b.bingos !== a.bingos) return b.bingos - a.bingos;
                    }
                    return b.score - a.score;
                });

                let currentRank = 1;
                playerStats.forEach((p, i) => {
                    if (i > 0) {
                        const prev = playerStats[i - 1];
                        const isBingoTie = game?.end_condition === 'first_bingo' ? p.bingos === prev.bingos : true;

                        if (isBingoTie && p.score === prev.score) {
                            p.rank = currentRank;
                        } else {
                            currentRank++;
                            p.rank = currentRank;
                        }
                    } else {
                        p.rank = 1;
                    }
                });
                setStats(playerStats);

                // Persist this game's outcome to the signed-in player's profile
                // (idempotent per round server-side). Guests, disabled-flag builds,
                // and non-members record nothing. Uses the player's OWN submissions
                // for categories-found and the find coordinates (future heatmap).
                if (FEATURES.playerProfiles && playerId && !recordedRef.current) {
                    const me = players.find((p) => p.id === playerId);
                    if (me) {
                        const myTeam = me.team ?? -1;
                        const entityId = teamMode === 'teams' && myTeam >= 0 ? `team-${myTeam}` : playerId;
                        const myStat = playerStats.find((s) => s.id === entityId);

                        const finds: GameFind[] = [];
                        let categoriesFound = 0;
                        submissions
                            .filter((s) => s.player_id === playerId)
                            .forEach((sub) => {
                                const approved = isScaleVoting
                                    ? tallyScale(sub.votes).count > 0
                                    : (() => {
                                        const { yes, no } = tallyVotes(sub.votes);
                                        return yes + no > 0 && yes > (yes + no) / 2;
                                    })();
                                if (!approved) return;
                                categoriesFound += 1;
                                if (typeof sub.lat === 'number' && typeof sub.lng === 'number') {
                                    finds.push({ lat: sub.lat, lng: sub.lng, category: sub.category });
                                }
                            });

                        recordedRef.current = true;
                        recordGameResult({
                            gameId,
                            playerId,
                            gameMode: fetchedGameMode,
                            teamMode,
                            placement: myStat?.rank ?? playerStats.length,
                            playerCount: players.length,
                            score: myStat?.score ?? 0,
                            categoriesFound,
                            // Solo rooms are trivially "1st"; only count a real win.
                            won: myStat?.rank === 1 && players.length >= 2,
                            finds,
                        }).catch(() => {
                            recordedRef.current = false; // let a later attempt retry
                        });
                    }
                }
            }
            setLoading(false);
        };

        fetchResults();
    }, [gameId, teamMode, playerId]);

    if (loading)
        return (
            <div className="relative min-h-screen flex flex-col items-center p-4 bg-slate-950 text-white overflow-hidden">
                <GlassAmbience />
                <div className="w-full max-w-6xl mx-auto flex flex-col items-center text-white relative z-10">
                    <div className="w-full flex md:mb-4">
                        <div className="flex items-center gap-4">
                            <GeoBingoLogo size={50} className="hidden sm:block" />
                            <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-4xl font-black uppercase tracking-widest text-transparent">{t('podium.results')}</h1>
                        </div>
                    </div>
                </div>
            </div>
        );

    const rank1 = stats.filter((s) => s.rank === 1);
    const rank2 = stats.filter((s) => s.rank === 2);
    const rank3 = stats.filter((s) => s.rank === 3);

    const renderScoreBadge = (p: PlayerStats) => {
        if (endCondition === 'first_bingo' && p.bingos > 0) {
            return t('podium.bingo');
        }
        return t('podium.points', { score: p.score });
    };

    const getWinningMessage = () => {
        if (rank1.length === 0) return null;
        if (rank1.length > 1) return t('podium.tie');

        const winner = rank1[0];

        if (endCondition === 'first_bingo' && winner.bingos > 0) {
            return t('podium.winnerFirstBingo');
        }

        return t('podium.winnerMostPoints');
    };

    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return (
        <div className="relative min-h-screen flex flex-col items-center p-4 bg-slate-950 text-white overflow-hidden">
            <GlassAmbience />
            {animPhase >= 4 && !prefersReducedMotion && (
                <div className="absolute inset-0 pointer-events-none z-[100] overflow-hidden">
                    <Confetti width={windowDim.width} height={windowDim.height} recycle={false} numberOfPieces={500} gravity={0.15} />
                </div>
            )}
            <style>{`
                @keyframes bounceIn {
                    0% { opacity: 0; transform: scale(0.1) translateY(50px); }
                    60% { opacity: 1; transform: scale(1.2) translateY(-10px); }
                    80% { transform: scale(0.95) translateY(5px); }
                    100% { opacity: 1; transform: scale(1) translateY(0); }
                }
                .animate-bounce-in {
                    animation: bounceIn 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
                }
                
                @keyframes growUp {
                    0% { transform: scaleY(0); opacity: 0; }
                    100% { transform: scaleY(1); opacity: 1; }
                }
                .animate-grow-up {
                    animation: growUp 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.1) both;
                }

                /* NEU: Der Fade-In für die Statistiken */
                @keyframes fadeIn {
                    0% { opacity: 0; transform: translateY(20px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in {
                    animation: fadeIn 1.5s ease-in-out both;
                }
            `}</style>
            <div className="w-full max-w-6xl mx-auto flex flex-col items-center text-white relative z-10">
                {/* HEADER / TOP BAR */}
                <div className="w-full flex md:mb-4">
                    <div className="flex items-center gap-4">
                        <GeoBingoLogo size={50} className="hidden sm:block" />
                        <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-4xl font-black uppercase tracking-widest text-transparent">{t('podium.results')}</h1>
                    </div>
                </div>

                {/* THE PODIUM */}
                <div className="flex items-end justify-center gap-4 md:gap-8 mt-4 w-full">
                    {/* 2nd Place */}
                    {rank2.length > 0 && (
                        <div className={`relative flex flex-col items-center w-32 md:w-40 origin-bottom ${animPhase >= 1 ? 'animate-grow-up' : 'scale-y-0 opacity-0'}`}>
                            <div className="relative w-full min-h-[5rem] md:min-h-[6.5rem]">
                                {animPhase >= 3 && (
                                    <div className="animate-bounce-in absolute bottom-0 left-1/2 mb-2 flex w-max max-w-[min(18rem,90vw)] -translate-x-1/2 flex-col items-center gap-1 text-center">
                                        <div className="flex w-full flex-col items-center gap-1 text-center">
                                            {rank2.map((p) => (
                                                <span key={p.id} className="block max-w-full whitespace-nowrap text-center text-xl font-bold leading-tight md:text-2xl" title={p.name}>
                                                    {p.name}
                                                </span>
                                            ))}
                                        </div>
                                        <span className="glass text-slate-300 mb-4 font-bold px-4 py-1 rounded-full">{renderScoreBadge(rank2[0])}</span>
                                    </div>
                                )}
                            </div>
                            <div className="w-full bg-slate-300 h-24 md:h-32 rounded-t-2xl flex justify-center items-start pt-6 shadow-[0_0_40px_rgba(203,213,225,0.2)]">
                                <span className="text-5xl font-black text-slate-500">2</span>
                            </div>
                        </div>
                    )}

                    {/* 1st Place */}
                    {rank1.length > 0 && (
                        <div className={`relative flex flex-col items-center w-40 md:w-48 origin-bottom ${animPhase >= 1 ? 'animate-grow-up' : 'scale-y-0 opacity-0'}`} style={{ animationDelay: '0.1s' }}>
                            <div className="relative w-full min-h-[6rem] md:min-h-[7.5rem]">
                                {animPhase >= 4 && (
                                    <div className="animate-bounce-in absolute bottom-0 left-1/2 mb-2 flex w-max max-w-[min(20rem,90vw)] -translate-x-1/2 flex-col items-center gap-1 text-center">
                                        <div className="flex w-full flex-col items-center gap-1 text-center">
                                            {rank1.map((p) => (
                                                <span key={p.id} className="block max-w-full whitespace-nowrap text-center text-2xl font-black leading-tight text-yellow-400 md:text-3xl" title={p.name}>
                                                    {p.name}
                                                </span>
                                            ))}
                                        </div>
                                        <span className="text-yellow-200 mb-4 font-bold bg-yellow-900/50 px-5 py-1 rounded-full">{renderScoreBadge(rank1[0])}</span>
                                    </div>
                                )}
                            </div>
                            <div className="w-full bg-yellow-400 h-36 md:h-48 rounded-t-2xl flex justify-center items-start pt-6 shadow-[0_0_60px_rgba(250,204,21,0.4)] relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/20 to-transparent"></div>
                                <span className="text-6xl font-black text-yellow-600 relative z-10">1</span>
                            </div>
                        </div>
                    )}

                    {/* 3rd Place */}
                    {rank3.length > 0 && (
                        <div className={`relative flex flex-col items-center w-32 md:w-40 origin-bottom ${animPhase >= 1 ? 'animate-grow-up' : 'scale-y-0 opacity-0'}`} style={{ animationDelay: '0.2s' }}>
                            <div className="relative w-full min-h-[5rem] md:min-h-[6.5rem]">
                                {animPhase >= 2 && (
                                    <div className="animate-bounce-in absolute bottom-0 left-1/2 mb-2 flex w-max max-w-[min(18rem,90vw)] -translate-x-1/2 flex-col items-center gap-1 text-center">
                                        <div className="flex w-full flex-col items-center gap-1 text-center">
                                            {rank3.map((p) => (
                                                <span key={p.id} className="block max-w-full whitespace-nowrap text-center text-xl font-bold leading-tight md:text-2xl" title={p.name}>
                                                    {p.name}
                                                </span>
                                            ))}
                                        </div>
                                        <span className="text-amber-600 mb-4 font-bold bg-amber-900/30 px-4 py-1 rounded-full">{renderScoreBadge(rank3[0])}</span>
                                    </div>
                                )}
                            </div>
                            <div className="w-full bg-amber-700 h-18 md:h-24 rounded-t-2xl flex justify-center items-start pt-6 shadow-[0_0_40px_rgba(180,83,9,0.2)]">
                                <span className="text-5xl font-black text-amber-900">3</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* WINNING MESSAGE & STATS */}
                {animPhase >= 5 && (
                    <div className="w-full animate-fade-in">
                        <div className="my-3 md:my-6 w-full flex justify-center">
                            <span className="glass text-slate-200 px-6 py-2 rounded-full text-sm font-bold uppercase tracking-wide text-center">{getWinningMessage()}</span>
                        </div>

                        {/* DETAILED STATISTICS */}
                        <div className="glass w-full rounded-3xl p-3 md:p-6">
                            <h3 className="text-2xl font-black text-white mb-4 md:mb-8 uppercase tracking-widest border-b border-white/10 pb-2 md:pb-4 text-center">{t('podium.matchStatistics')}</h3>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-6">
                                {stats.map((player) => (
                                    <div key={player.id} className="glass-inset p-3 md:p-6 rounded-2xl flex flex-col gap-4">
                                        {/* Header: Rank & Name */}
                                        <div className="flex justify-between items-center border-b border-white/10 pb-2 md:pb-4">
                                            <div className="flex items-center gap-3">
                                                <span className="text-2xl font-black text-slate-600">#{player.rank}</span>
                                                <span className="font-bold text-xl text-indigo-300">{player.name}</span>
                                            </div>
                                            <span className="bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-1 rounded-lg text-lg font-bold text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]">{t('podium.points', { score: player.score })}</span>
                                        </div>

                                        {/* Stats Grid */}
                                        {scaleVoting ? (
                                            <div className="grid grid-cols-3 gap-3">
                                                {/* Total rating (= score) */}
                                                <div className="bg-white/5 p-3 rounded-xl flex flex-col items-center h-full">
                                                    <span className="text-[10px] text-slate-400 uppercase font-bold text-center leading-tight shrink-0">{t('podium.totalRating')}</span>
                                                    <div className="flex-1 flex items-center justify-center w-full">
                                                        <span className="text-xl font-medium text-indigo-400 leading-none">{player.scaleTotal || 0}</span>
                                                    </div>
                                                </div>
                                                {/* Average rating */}
                                                <div className="bg-white/5 p-3 rounded-xl flex flex-col items-center h-full">
                                                    <span className="text-[10px] text-slate-400 uppercase font-bold text-center leading-tight shrink-0">{t('podium.avgRating')}</span>
                                                    <div className="flex-1 flex items-center justify-center w-full">
                                                        <span className={`text-xl font-medium leading-none ${player.scaleAvg >= 7 ? 'text-green-400' : player.scaleAvg >= 4 ? 'text-yellow-400' : 'text-red-400'}`}>{player.scaleAvg.toFixed(1)}</span>
                                                    </div>
                                                </div>
                                                {/* Ratings received */}
                                                <div className="bg-white/5 p-3 rounded-xl flex flex-col items-center h-full">
                                                    <span className="text-[10px] text-slate-400 uppercase font-bold text-center leading-tight shrink-0">{t('podium.ratingsReceived')}</span>
                                                    <div className="flex-1 flex items-center justify-center w-full">
                                                        <span className="text-xl font-medium leading-none">{player.scaleCount || 0}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className={`grid ${gameMode === 'bingo' ? 'grid-cols-4' : 'grid-cols-3'} gap-3`}>
                                                {/* Bingos */}
                                                {gameMode === 'bingo' && (
                                                    <div className="bg-white/5 p-3 rounded-xl flex flex-col items-center h-full">
                                                        <span className="text-[10px] text-slate-400 uppercase font-bold text-center leading-tight shrink-0">{t('podium.bingos')}</span>
                                                        <div className="flex-1 flex items-center justify-center w-full">
                                                            <span className="text-xl font-medium text-yellow-400 leading-none">{player.bingos || 0}</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Approved Words */}
                                                <div className="bg-white/5 p-3 rounded-xl flex flex-col items-center h-full">
                                                    <span className="text-[10px] text-slate-400 uppercase font-bold text-center leading-tight shrink-0">{t('podium.approvedWords')}</span>
                                                    <div className="flex-1 flex items-center justify-center w-full">
                                                        <span className="text-xl font-medium leading-none">{player.totalFound || 0}</span>
                                                    </div>
                                                </div>
                                                {/* Mini Bingo Board */}
                                                {gameMode === 'bingo' ? (
                                                    <div className="relative group bg-white/5 p-3 rounded-xl flex flex-col items-center justify-center">
                                                        <span className="text-[10px] text-slate-400 uppercase font-bold mb-2 text-center">{t('podium.bingoBoard')}</span>
                                                        <div
                                                            className="grid gap-1"
                                                            style={{
                                                                gridTemplateColumns: `repeat(${player.gridSize || 3}, minmax(0, 1fr))`,
                                                            }}
                                                        >
                                                            {player.gridStatus?.map((status: number, idx: number) => (
                                                                <div key={idx} className={`w-2 h-2 rounded-sm ${status === 3 ? 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)] z-10' : status === 1 ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : status === 2 ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]' : 'bg-slate-700'}`} />
                                                            ))}
                                                        </div>

                                                        {/* --- HOVER OVERLAY --- */}
                                                        <div className="glass-dark absolute bottom-full mb-3 left-1/2 -translate-x-1/2 hidden group-hover:flex z-50 w-[280px] h-[280px] sm:w-[400px] sm:h-[400px] p-3 !border-indigo-400/50 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] pointer-events-none flex-col">
                                                            <div
                                                                className="grid gap-1.5 flex-1"
                                                                style={{
                                                                    gridTemplateColumns: `repeat(${player.gridSize || 3}, 1fr)`,
                                                                    gridTemplateRows: `repeat(${player.gridSize || 3}, 1fr)`,
                                                                }}
                                                            >
                                                                {player.bingoBoard?.map((word: string, idx: number) => {
                                                                    const status = player.gridStatus[idx];
                                                                    let styleClass = 'bg-slate-800 text-slate-400 border-slate-700';

                                                                    if (status === 3) styleClass = 'bg-yellow-900/40 text-yellow-400 border-yellow-500/50 shadow-[0_0_10px_rgba(250,204,21,0.2)] font-bold';
                                                                    else if (status === 1) styleClass = 'bg-green-900/30 text-green-400 border-green-500/40';
                                                                    else if (status === 2) styleClass = 'bg-red-900/20 text-red-500 border-red-500/30 opacity-60';

                                                                    return (
                                                                        <div key={idx} className={`text-[9px] sm:text-[11px] flex items-center justify-center text-center p-1.5 rounded-lg border overflow-hidden hyphens-auto break-all leading-tight h-full w-full ${styleClass}`}>
                                                                            <span className="line-clamp-4">{word}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            {/* Pfeil-Icon unten */}
                                                            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-900 border-b border-r border-indigo-500/50 rotate-45"></div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="bg-white/5 p-3 rounded-xl flex flex-col items-center h-full">
                                                        <span className="text-[10px] text-slate-400 uppercase font-bold mb-1 text-center">{t('podium.approveRate')}</span>
                                                        <span className={`text-xl font-medium ${player.communityApproval >= 75 ? 'text-green-400' : player.communityApproval >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{player.communityApproval}%</span>
                                                    </div>
                                                )}

                                                {/* Hype */}
                                                <div className="bg-white/5 p-3 rounded-xl flex flex-col items-center h-full">
                                                    <span className="text-[10px] text-slate-400 uppercase font-bold text-center leading-tight shrink-0">{t('podium.hype')}</span>
                                                    <div className="flex-1 flex items-center justify-center w-full">
                                                        <span className="text-xl font-medium text-amber-400 leading-none">{player.totalHype || 0}</span>
                                                    </div>
                                                </div>

                                                <div className={`bg-white/5 p-3 rounded-xl flex flex-col ${gameMode === 'bingo' ? 'col-span-4' : 'col-span-3'}`}>
                                                    <span className="text-xs text-slate-400 uppercase font-bold mb-2">{t('podium.totalVotesReceived')}</span>
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden flex">
                                                            <div
                                                                className="bg-green-500 h-full"
                                                                style={{
                                                                    width: `${player.totalYes + player.totalNo > 0 ? (player.totalYes / (player.totalYes + player.totalNo)) * 100 : 0}%`,
                                                                }}
                                                            ></div>
                                                            <div
                                                                className="bg-red-500 h-full"
                                                                style={{
                                                                    width: `${player.totalYes + player.totalNo > 0 ? (player.totalNo / (player.totalYes + player.totalNo)) * 100 : 0}%`,
                                                                }}
                                                            ></div>
                                                        </div>
                                                        <div className="flex gap-3 text-sm font-bold">
                                                            <span className="text-green-500">{t('podium.yesCount', { count: player.totalYes })}</span>
                                                            <span className="text-slate-500">|</span>
                                                            <span className="text-red-500">{t('podium.noCount', { count: player.totalNo })}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ACTIONS — at the bottom, fade in with the stats */}
                {animPhase >= 5 && (
                    <div className="w-full flex flex-wrap justify-center gap-3 mt-6 md:mt-8 animate-fade-in">
                        {/* Any player can turn the just-played game into a community preset. */}
                        <button
                            type="button"
                            onClick={() => {
                                // Open the tab synchronously inside the click gesture, or the popup
                                // blocker kills it once the async seed build below runs.
                                const win = window.open('about:blank', '_blank');
                                // Submissions are cleared on "Back to Lobby", so harvest them now.
                                buildPresetSeedFromGame(supabase, gameId).then((seed) => {
                                    if (!seed) {
                                        win?.close();
                                        return;
                                    }
                                    localStorage.setItem('geoBingoPresetSeed', JSON.stringify(seed));
                                    if (win) win.location.href = '/community/create';
                                    else window.location.href = '/community/create'; // blocked anyway → same tab
                                });
                            }}
                            className="glass press text-white font-bold py-3 px-8 rounded-lg uppercase text-sm tracking-wide"
                        >
                            {t('community.createFromGame')}
                        </button>

                        {isHost && (
                            <button
                                type="button"
                                onClick={async () => {
                                    const hostToken = getHostToken(gameId);
                                    await supabase.rpc('clear_submissions_for_game', { p_game_id: gameId, p_host_id: hostToken });
                                    await supabase.rpc('update_game_settings', { p_game_id: gameId, p_host_id: hostToken, p_patch: { ready_players: [] } });
                                    const { data, error } = await supabase.rpc('set_game_status', { p_game_id: gameId, p_host_id: hostToken, p_status: 'lobby' });
                                    if (error || (data && data.success === false)) console.error('Error returning to lobby:', error || data?.error);
                                }}
                                className="btn-sheen press bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white font-bold py-3 px-8 rounded-lg uppercase text-sm tracking-wide shadow-[0_14px_28px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]"
                            >
                                {t('podium.backToLobby')}
                            </button>
                        )}

                        {/* Non-hosts can't restart the lobby, so give them a way out instead. */}
                        {!isHost && (
                            <button type="button" onClick={() => router.push('/')} className="glass press text-white font-bold py-3 px-8 rounded-lg uppercase text-sm tracking-wide">
                                {t('sidebar.leaveLobby')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
