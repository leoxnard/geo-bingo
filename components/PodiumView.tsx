'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import Image from 'next/image';

interface PodiumViewProps {
    gameId: string;
    renderToast: () => React.ReactNode;
    isHost: boolean;
    teamMode: 'ffa' | 'teams';
}

interface PlayerStat {
    id: string;
    name: string;
    score: number;
    totalFound: number;
    bingos: number;
    communityApproval: number;
    totalYes: number;
    totalNo: number;
    rank: number;
}

export default function PodiumView({ 
    gameId, renderToast, isHost, teamMode
}: PodiumViewProps) {
    const [stats, setStats] = useState<PlayerStat[]>([]);
    const [loading, setLoading] = useState(true);
    const [gameMode, setGameMode] = useState<string>('list');

    useEffect(() => {
        const fetchResults = async () => {
            const { data: game } = await supabase.from('games').select('game_mode, grid_size').eq('id', gameId).single();
            const { data: players } = await supabase.from('players').select('id, name, bingo_board, team').eq('game_id', gameId);
            const { data: submissions } = await supabase.from('submissions').select('*').eq('game_id', gameId);

            const fetchedGameMode = game?.game_mode || 'list';
            setGameMode(fetchedGameMode);
            const gridSize = game?.grid_size || 3;

            if (players && submissions) {
                // Determine entities to score: if teamMode === 'teams', group by team (if team is assigned, e.g. team >= 0)
                // We'll create an array of "virtual players" which are either individuals or teams
                interface ScoreEntity {
                    id: string; // "team-0" or player id
                    name: string;
                    members: typeof players; // all players in this entity
                    bingo_board?: string[]; // board from first member
                }
                
                const entities: ScoreEntity[] = [];
                
                if (teamMode === 'teams') {
                    const teamsMap = new Map<number, ScoreEntity>();
                    players.forEach(p => {
                        const t = p.team ?? -1;
                        if (t >= 0) {
                            if (!teamsMap.has(t)) {
                                const teamNames = ['Blue Team', 'Red Team', 'Green Team', 'Yellow Team'];
                                teamsMap.set(t, {
                                    id: `team-${t}`,
                                    name: teamNames[t] || `Team ${t + 1}`,
                                    members: [p],
                                    bingo_board: p.bingo_board
                                });
                            } else {
                                const entity = teamsMap.get(t)!;
                                entity.members.push(p);
                                entity.name = entity.members.map(m => m.name).join(' & ');
                            }
                        } else {
                            entities.push({ id: p.id, name: p.name, members: [p], bingo_board: p.bingo_board });
                        }
                    });
                    entities.push(...Array.from(teamsMap.values()));
                } else {
                    players.forEach(p => {
                        entities.push({ id: p.id, name: p.name, members: [p], bingo_board: p.bingo_board });
                    });
                }

                const playerStats = entities.map(entity => {
                    const memberIds = entity.members.map(m => m.id);
                    const entitySubs = submissions.filter(s => memberIds.includes(s.player_id));
          
                    let score = 0;
                    let totalYes = 0;
                    let totalNo = 0;

                    // Track which categories are validated
                    const validCategories: string[] = [];

                    // Check every submission to calculate points and stats
                    entitySubs.forEach(sub => {
                        const votes = sub.votes || {};
                        let subYes = 0;
                        let subNo = 0;
            
                        Object.values(votes).forEach((v) => {
                            if (v === true) subYes++;
                            if (v === false) subNo++;
                        });

                        totalYes += subYes;
                        totalNo += subNo;

                        // A guess is accepted if absolute majority (>50%) votes yes
                        const totalCast = subYes + subNo;
                        if (totalCast > 0 && subYes > (totalCast / 2)) {
                            score += 1; // 1 point for each approved word from voting
                            validCategories.push(sub.category);
                        }
                    });

                    // Check for Bingos
                    let bingoCount = 0;
                    if (fetchedGameMode === 'bingo' && entity.bingo_board && entity.bingo_board.length >= gridSize * gridSize) {
                        const board = entity.bingo_board;
            
                        // Map flat array to 2D grid boolean array indicating validity
                        const grid: boolean[][] = [];
                        for (let r = 0; r < gridSize; r++) {
                            const row: boolean[] = [];
                            for (let c = 0; c < gridSize; c++) {
                                const cat = board[r * gridSize + c];
                                row.push(validCategories.includes(cat));
                            }
                            grid.push(row);
                        }

                        // Function to count FULL lines (rows, cols, diagonals)
                        const checkLines = () => {
                            let bingosFound = 0;

                            const checkDirection = (rStart: number, cStart: number, rDir: number, cDir: number) => {
                                let r = rStart;
                                let c = cStart;
                                let count = 0;
                                
                                while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
                                    if (!grid[r][c]) return 0; // If any cell in the line is false, it's not a full bingo
                                    count++;
                                    r += rDir;
                                    c += cDir;
                                }
                                
                                // Return 1 if the very end of the bounds was reached, effectively meaning it's a full edge-to-edge bingo
                                return count === gridSize ? 1 : 0;
                            };

                            // Check all Rows
                            for (let r = 0; r < gridSize; r++) {
                                bingosFound += checkDirection(r, 0, 0, 1);
                            }

                            // Check all Cols
                            for (let c = 0; c < gridSize; c++) {
                                bingosFound += checkDirection(0, c, 1, 0);
                            }

                            // Check ONLY the two Main Diagonals (Standard Bingo Rules)
                            bingosFound += checkDirection(0, 0, 1, 1); // Top-Left to Bottom-Right
                            bingosFound += checkDirection(0, gridSize - 1, 1, -1); // Top-Right to Bottom-Left

                            return bingosFound;
                        };

                        bingoCount = checkLines();
                        score += bingoCount * gridSize; // add extra points equal to full grid size for every bingo found
                    }

                    const totalCommunityVotes = totalYes + totalNo;
                    const communityApproval = totalCommunityVotes > 0 
                        ? Math.round((totalYes / totalCommunityVotes) * 100) 
                        : 0;

                    return {
                        id: entity.id,
                        name: entity.name,
                        score, 
                        totalFound: validCategories.length,
                        bingos: bingoCount,
                        communityApproval,
                        totalYes,
                        totalNo,
                        rank: 0
                    };
                });

                // Sort: Highest score wins. If tie, highest community approval wins!
                playerStats.sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    return b.communityApproval - a.communityApproval;
                });

                // Calculate Ranks (Dense Ranking to support ties)
                let currentRank = 1;
                playerStats.forEach((p, i) => {
                    if (i > 0) {
                        const prev = playerStats[i - 1];
                        if (p.score === prev.score && p.communityApproval === prev.communityApproval) {
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
            }
            setLoading(false);
        };

        fetchResults();
    }, [gameId, teamMode]);

    if (loading) return <div className="text-white text-center py-20 text-xl animate-pulse">Calculating Final Scores...</div>;

    const rank1 = stats.filter(s => s.rank === 1);
    const rank2 = stats.filter(s => s.rank === 2);
    const rank3 = stats.filter(s => s.rank === 3);

    return (
        <div className="min-h-screen flex flex-col items-center p-4 bg-slate-900 text-white">
            {renderToast()}
            <div className="w-full max-w-5xl flex justify-between items-center mb-4 mt-4">
                <div className="flex items-center gap-4">
                    <Image 
                        src="/mappin.and.ellipse.png"
                        alt="Geo Bingo Logo"
                        loading="eager"
                        width={50}
                        height={50}
                        className="w-auto h-auto drop-shadow-[0_0_10px_rgba(96,165,250,0.5)] transform-gpu hidden sm:block"
                    />
                    <h1 className="text-4xl font-black uppercase tracking-widest text-indigo-400">Final Results</h1>
                </div>
                {isHost ? (
                    <button 
                        onClick={async () => {
                            // Delete old submissions for the new round
                            await supabase.from('submissions').delete().eq('game_id', gameId);
                            // Status zurück auf Lobby setzen
                            const { error } = await supabase.from('games').update({ status: 'lobby', ready_players: [] }).eq('id', gameId);
                            if (error) console.error("Error returning to lobby:", error);
                        }}
                        className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg transition-all uppercase text-sm tracking-wide shadow-lg"
                    >
                        Back to Lobby
                    </button>
                ) : (
                    <div className="text-slate-400 italic font-medium bg-slate-800 px-6 py-3 rounded-lg border border-slate-700">
                        Waiting for Host...
                    </div>
                )}
            </div>
            <div className="w-full max-w-6xl mx-auto flex flex-col items-center text-white">
      
                {/* THE PODIUM */}
                <div className="flex items-end justify-center gap-4 md:gap-8 h-65 mb-5 mt-20 w-full">
            
                    {/* 2nd Place */}
                    {rank2.length > 0 && (
                        <div className="flex flex-col items-center w-32 md:w-40 animate-[slideUp_1s_ease-out]">
                            <div className="flex flex-col items-center mb-2 w-full">
                                {rank2.map(p => (
                                    <span key={p.id} className="text-xl md:text-2xl font-bold w-full text-center" title={p.name}>{p.name}</span>
                                ))}
                            </div>
                            <span className="text-slate-400 mb-4 font-bold bg-slate-800 px-4 py-1 rounded-full">{rank2[0].score} Pts</span>
                            <div className="w-full bg-slate-300 h-32 rounded-t-2xl flex justify-center items-start pt-6 shadow-[0_0_40px_rgba(203,213,225,0.2)]">
                                <span className="text-5xl font-black text-slate-500">2</span>
                            </div>
                        </div>
                    )}

                    {/* 1st Place */}
                    {rank1.length > 0 && (
                        <div className="flex flex-col items-center w-40 md:w-48 animate-[slideUp_0.8s_ease-out]">
                            <div className="flex flex-col items-center mb-2 w-full">
                                {rank1.map(p => (
                                    <span key={p.id} className="text-2xl md:text-3xl font-black text-yellow-400 w-full text-center" title={p.name}>{p.name}</span>
                                ))}
                            </div>
                            <span className="text-yellow-200 mb-4 font-bold bg-yellow-900/50 px-5 py-1 rounded-full">{rank1[0].score} Pts</span>
                            <div className="w-full bg-yellow-400 h-48 rounded-t-2xl flex justify-center items-start pt-6 shadow-[0_0_60px_rgba(250,204,21,0.4)] relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/20 to-transparent"></div>
                                <span className="text-6xl font-black text-yellow-600 relative z-10">1</span>
                            </div>
                        </div>
                    )}

                    {/* 3rd Place */}
                    {rank3.length > 0 && (
                        <div className="flex flex-col items-center w-32 md:w-40 animate-[slideUp_1.2s_ease-out]">
                            <div className="flex flex-col items-center mb-2 w-full">
                                {rank3.map(p => (
                                    <span key={p.id} className="text-xl md:text-2xl font-bold w-full text-center" title={p.name}>{p.name}</span>
                                ))}
                            </div>
                            <span className="text-amber-600 mb-4 font-bold bg-amber-900/30 px-4 py-1 rounded-full">{rank3[0].score} Pts</span>
                            <div className="w-full bg-amber-700 h-24 rounded-t-2xl flex justify-center items-start pt-6 shadow-[0_0_40px_rgba(180,83,9,0.2)]">
                                <span className="text-5xl font-black text-amber-900">3</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* DETAILED STATISTICS */}
                <div className="w-full bg-slate-800 rounded-3xl border border-slate-700 p-8 md:p-10 shadow-2xl">
                    <h3 className="text-2xl font-black text-white mb-8 uppercase tracking-widest border-b border-slate-700 pb-4 text-center">
                        Match Statistics
                    </h3>
            
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {stats.map((player) => (
                            <div key={player.id} className="bg-slate-900 p-6 rounded-2xl border border-slate-700 flex flex-col gap-4">
                
                                {/* Header: Rank & Name */}
                                <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl font-black text-slate-600">#{player.rank}</span>
                                        <span className="font-bold text-xl text-indigo-400">{player.name}</span>
                                    </div>
                                    <span className="bg-indigo-600 px-4 py-1 rounded-lg text-lg font-bold text-white shadow-lg">
                                        {player.score} Pts
                                    </span>
                                </div>

                                {/* Stats Grid */}
                                <div className={`grid ${gameMode === 'bingo' ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mt-2`}>
                    
                                    {/* Submitted Total */}
                                    <div className="bg-slate-800 p-3 rounded-xl flex flex-col items-center">
                                        <span className="text-[10px] text-slate-400 uppercase font-bold mb-1 text-center">Approved words</span>
                                        <span className="text-xl font-medium text-white">{player.totalFound}</span>
                                    </div>

                                    {/* Bingos */}
                                    {gameMode === 'bingo' && (
                                        <div className="bg-slate-800 p-3 rounded-xl flex flex-col items-center">
                                            <span className="text-[10px] text-slate-400 uppercase font-bold mb-1 text-center">Bingos</span>
                                            <span className="text-xl font-medium text-pink-400">{player.bingos || 0}</span>
                                        </div>
                                    )}

                                    {/* Community Approval */}
                                    <div className="bg-slate-800 p-3 rounded-xl flex flex-col items-center">
                                        <span className="text-[10px] text-slate-400 uppercase font-bold mb-1 text-center">Approve-Rate</span>
                                        <span className={`text-xl font-medium ${
                                            player.communityApproval >= 75 ? 'text-green-400' : 
                                                player.communityApproval >= 50 ? 'text-yellow-400' : 'text-red-400'
                                        }`}>
                                            {player.communityApproval}%
                                        </span>
                                    </div>
                    
                                    {/* Votes Detail (Full Width) */}
                                    <div className={`bg-slate-800 p-3 rounded-xl flex flex-col ${gameMode === 'bingo' ? 'col-span-3' : 'col-span-2'}`}>
                                        <span className="text-xs text-slate-400 uppercase font-bold mb-2">Total Votes Received</span>
                    
                                        <div className="flex items-center gap-4">
                                            <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden flex">
                                                <div className="bg-green-500 h-full" style={{ width: `${player.totalYes + player.totalNo > 0 ? (player.totalYes / (player.totalYes + player.totalNo)) * 100 : 0}%` }}></div>
                                                <div className="bg-red-500 h-full" style={{ width: `${player.totalYes + player.totalNo > 0 ? (player.totalNo / (player.totalYes + player.totalNo)) * 100 : 0}%` }}></div>
                                            </div>
                                            <div className="flex gap-3 text-sm font-bold">
                                                <span className="text-green-500">{player.totalYes} Yes</span>
                                                <span className="text-slate-500">|</span>
                                                <span className="text-red-500">{player.totalNo} No</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}