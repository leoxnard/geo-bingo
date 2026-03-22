'use client';

import React from 'react';

interface LobbySettingsProps {
    isHost: boolean;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    gridSize: number;
    bingoBoardMode: 'shared' | 'individual';
    timeLimit: number;
    updateGameModeInfo: (updates: { 
        game_mode?: string; 
        team_mode?: string; 
        grid_size?: number; 
        bingo_board_mode?: 'shared' | 'individual' 
    }) => void;
    updateTimeLimit: (minutes: number) => void;
}

export default function LobbySettings({
    isHost,
    gameMode,
    teamMode,
    gridSize,
    bingoBoardMode,
    timeLimit,
    updateGameModeInfo,
    updateTimeLimit
}: LobbySettingsProps) {
    return (
        <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            <h2 className="text-xl font-semibold mb-4 text-slate-300">Settings</h2>

            {/* Game Mode Selection */}
            <div className="mb-2 flex bg-slate-900 rounded-lg p-1">
                <button type="button"
                    onClick={() => updateGameModeInfo({ game_mode: 'list' })}
                    disabled={!isHost}
                    className={`flex-1 py-2 rounded-md font-bold transition-all ${
                        gameMode === 'list'
                            ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow'
                            : 'text-slate-400 hover:text-white'
                    }`}
                >
                    List
                </button>
                <button type="button"
                    onClick={() => updateGameModeInfo({ game_mode: 'bingo' })}
                    disabled={!isHost}
                    className={`flex-1 py-2 rounded-md font-bold transition-all ${
                        gameMode === 'bingo'
                            ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow'
                            : 'text-slate-400 hover:text-white'
                    }`}
                >
                    Bingo Grid
                </button>
            </div>

            {/* Team Mode Selection */}
            <div className="mb-2 flex bg-slate-900 rounded-lg p-1">
                <button type="button"
                    onClick={() => updateGameModeInfo({ team_mode: 'ffa' })}
                    disabled={!isHost}
                    className={`flex-1 py-2 rounded-md font-bold transition-all text-sm ${
                        teamMode === 'ffa'
                            ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow'
                            : 'text-slate-400 hover:text-white'
                    }`}
                >
                    All against all
                </button>
                <button type="button"
                    onClick={() => updateGameModeInfo({ team_mode: 'teams' })}
                    disabled={!isHost}
                    className={`flex-1 py-2 rounded-md font-bold transition-all text-sm ${
                        teamMode === 'teams'
                            ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow'
                            : 'text-slate-400 hover:text-white'
                    }`}
                >
                    Teams
                </button>
            </div>

            {gameMode === 'list' ? (
                <p className="mb-6 p-2 pt-0 rounded-lg text-sm text-slate-400">
                    In List mode, players will see a simple list of categories. The game ends when the timer runs out or all players vote to end. Great for quick sessions and smaller groups!
                </p>
            ) : (
                <p className="mb-6 p-2 pt-0 rounded-lg text-sm text-slate-400">
                    In Bingo Grid mode, players receive a grid of categories. Players receive extra points for completing rows or columns of a length defined by the host. The game ends when the timer runs out or all players vote to end. Perfect for longer sessions and adds a fun strategic layer!
                </p>
            )}

            {gameMode === 'bingo' && (
                <div className="mb-6 p-4 bg-slate-900 rounded-lg flex flex-col gap-4">
                    <div>
                        <label htmlFor="grid-size-range" className="flex justify-between font-bold mb-2 text-sm cursor-pointer">
                            <span>Grid Size ({gridSize}x{gridSize})</span>
                        </label>
                        <input
                            id="grid-size-range"
                            title="Adjust the grid size"
                            type="range"
                            min="2"
                            max="5"
                            step="1"
                            value={gridSize}
                            disabled={!isHost}
                            onChange={(e) => updateGameModeInfo({ grid_size: parseInt(e.target.value) })}
                            className="w-full accent-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="flex justify-between font-bold mb-2 text-sm">
                            <span>Bingo Board Mode</span>
                        </label>
                        <div className="flex bg-slate-900 rounded-lg p-1">
                            <button type="button"
                                onClick={() => updateGameModeInfo({ bingo_board_mode: 'shared' })}
                                disabled={!isHost}
                                className={`flex-1 py-2 text-sm rounded-md font-bold transition-all ${
                                    bingoBoardMode === 'shared' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                Shared
                            </button>
                            <button type="button"
                                onClick={() => updateGameModeInfo({ bingo_board_mode: 'individual' })}
                                disabled={!isHost}
                                className={`flex-1 py-2 text-sm rounded-md font-bold transition-all ${
                                    bingoBoardMode === 'individual' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                Individual
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-400 text-center min-h-[16px]">
                            {bingoBoardMode === 'shared' && 'Same board for all players.'}
                            {bingoBoardMode === 'individual' && 'Different words and positions for each player.'}
                        </p>
                    </div>
                </div>
            )}

            {/* Time Slider */}
            <div className="mb-8 p-4 bg-slate-900 rounded-lg">
                <label htmlFor="time-limit-range" className="flex justify-between font-bold mb-2 cursor-pointer">
                    <span>Time Limit</span>
                    <span className="text-indigo-400">{timeLimit / 60} Minutes</span>
                </label>
                <input
                    id="time-limit-range"
                    type="range"
                    min="1"
                    max="15"
                    step="1"
                    value={timeLimit / 60}
                    disabled={!isHost}
                    onChange={(e) => updateTimeLimit(parseInt(e.target.value))}
                    className="w-full cursor-pointer accent-indigo-500"
                    title="Adjust the game time limit in minutes"
                />
                {!isHost && <p className="text-xs text-slate-500 mt-2 italic">Only the host can adjust the time limit.</p>}
            </div>
        </div>
    );
}