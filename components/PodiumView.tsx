'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface PodiumViewProps {
  gameId: string;
}

export default function PodiumView({ gameId }: PodiumViewProps) {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameMode, setGameMode] = useState<string>('list');

  useEffect(() => {
    const fetchResults = async () => {
      const { data: game } = await supabase.from('games').select('game_mode, grid_size, bingo_target').eq('id', gameId).single();
      const { data: players } = await supabase.from('players').select('id, name, bingo_board').eq('game_id', gameId);
      const { data: submissions } = await supabase.from('submissions').select('*').eq('game_id', gameId);

      const fetchedGameMode = game?.game_mode || 'list';
      setGameMode(fetchedGameMode);
      const gridSize = game?.grid_size || 3;
      const bingoTarget = game?.bingo_target || 3;

      if (players && submissions) {
        const playerStats = players.map(player => {
          const playerSubs = submissions.filter(s => s.player_id === player.id);
          
          let score = 0;
          let totalYes = 0;
          let totalNo = 0;

          // Track which categories are validated
          const validCategories: string[] = [];

          // Check every submission to calculate points and stats
          playerSubs.forEach(sub => {
            const votes = sub.votes || {};
            let subYes = 0;
            let subNo = 0;
            
            Object.values(votes).forEach(v => {
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
          if (fetchedGameMode === 'bingo' && player.bingo_board && player.bingo_board.length >= gridSize * gridSize) {
            const board = player.bingo_board;
            
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

            // Function to count consecutive true sequences of length >= bingoTarget
            const checkLines = () => {
              let bingosFound = 0;

              const checkDirection = (rStart: number, cStart: number, rDir: number, cDir: number) => {
                let r = rStart;
                let c = cStart;
                let count = 0;
                // Get the maximum length of this line within bounds
                while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
                  count++;
                  r += rDir;
                  c += cDir;
                }
                
                // If the total sequence is smaller than bingoTarget, return 0
                if (count < bingoTarget) return 0;

                let lines = 0;
                let currentStreak = 0;
                
                // We shouldn't double-count overlapping bingos on the exact same line,
                // usually users mean: streak of 5 with target 3 = 1 bingo.
                // Or maybe they prefer overlapping bingos?
                // Let's count completely distinct blocks, e.g., streak of 6 for target 3 = 2 bingos.
                for (let step = 0; step < count; step++) {
                  const curR = rStart + step * rDir;
                  const curC = cStart + step * cDir;
                  if (grid[curR][curC]) {
                    currentStreak++;
                    if (currentStreak === bingoTarget) {
                      lines++;
                      // Reset streak so that a streak of 6 gives exactly 2 bingos
                      currentStreak = 0; 
                    }
                  } else {
                    currentStreak = 0;
                  }
                }
                return lines;
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
            score += bingoCount * bingoTarget; // add extra points equal to bingo target for every bingo found
          }

          const totalCommunityVotes = totalYes + totalNo;
          const communityApproval = totalCommunityVotes > 0 
            ? Math.round((totalYes / totalCommunityVotes) * 100) 
            : 0;

          return {
            id: player.id,
            name: player.name,
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
  }, [gameId]);

  if (loading) return <div className="text-white text-center py-20 text-xl animate-pulse">Calculating Final Scores...</div>;

  const rank1 = stats.filter(s => s.rank === 1);
  const rank2 = stats.filter(s => s.rank === 2);
  const rank3 = stats.filter(s => s.rank === 3);

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col items-center text-white pb-20">
      
      {/* THE PODIUM */}
      <div className="flex items-end justify-center gap-4 md:gap-8 h-72 mb-16 mt-12 w-full">
        
        {/* 2nd Place */}
        {rank2.length > 0 && (
          <div className="flex flex-col items-center w-32 md:w-40 animate-[slideUp_1s_ease-out]">
            <div className="flex flex-col items-center mb-2 w-full">
              {rank2.map(p => (
                <span key={p.id} className="text-xl md:text-2xl font-bold truncate w-full text-center" title={p.name}>{p.name}</span>
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
                <span key={p.id} className="text-2xl md:text-3xl font-black text-yellow-400 truncate w-full text-center" title={p.name}>{p.name}</span>
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
                <span key={p.id} className="text-xl md:text-2xl font-bold truncate w-full text-center" title={p.name}>{p.name}</span>
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
          {stats.map((player, index) => (
            <div key={player.id} className="bg-slate-900 p-6 rounded-2xl border border-slate-700 flex flex-col gap-4">
              
              {/* Header: Rank & Name */}
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-black text-slate-600">#{player.rank}</span>
                  <span className="font-bold text-xl text-blue-400">{player.name}</span>
                </div>
                <span className="bg-blue-600 px-4 py-1 rounded-lg text-lg font-bold text-white shadow-lg">
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
  );
}