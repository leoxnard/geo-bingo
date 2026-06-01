'use client';

/*
================================================================================
LOBBY SETTINGS COMPONENT
================================================================================
Game configuration controls for mode and settings management.
Handles grid size, team mode, and other game parameters.
Provides toggle switches and range sliders for game customization.
================================================================================
*/

import { useState } from 'react';

import { ToggleButton, RangeSlider } from '../utils/Elements';

interface LobbySettingsProps {
    isHost: boolean;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    gridSize: number;
    timeLimit: number;
    endCondition: 'first_bingo' | 'timer';
    exclusiveMode: boolean;
    updateGameModeInfo: (updates: { game_mode?: string; team_mode?: string; time_limit?: number; grid_size?: number; bingo_board_mode?: 'shared' | 'individual'; end_condition?: 'first_bingo' | 'timer'; exclusive_mode?: boolean }) => void;
}

export default function LobbySettings({ isHost, gameMode, teamMode, timeLimit, endCondition, exclusiveMode, updateGameModeInfo }: LobbySettingsProps) {
    const [localTimeLimit, setLocalTimeLimit] = useState(timeLimit / 60);

    const handleCommit = () => {
        if (!isHost) return;
        updateGameModeInfo({
            time_limit: localTimeLimit * 60,
        });
    };

    return (
        <div className="bg-slate-800 p-4 sm:p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            {/* <h2 className="text-xl font-semibold mb-4 text-slate-300">Settings</h2> */}

            {/* Team Mode Selection */}
            <ToggleButton title="Team Mode" active={teamMode === 'ffa' ? 'left' : 'right'} onClick={(val: 'left' | 'right') => updateGameModeInfo({ team_mode: val === 'left' ? 'ffa' : 'teams' })} disabled={!isHost} isHost={isHost} labelLeft="No Teams" labelRight="Teams" position="top" />

            {/* Game Mode Selection */}
            <ToggleButton title="Game Mode" active={gameMode === 'list' ? 'left' : 'right'} onClick={(val: 'left' | 'right') => updateGameModeInfo({ game_mode: val === 'left' ? 'list' : 'bingo' })} disabled={!isHost} isHost={isHost} labelLeft="Classic List" labelRight="Bingo Grid" description={`${gameMode === 'list' ? 'In Classic List mode, players will see a simple list of categories.' : 'In Bingo Grid mode, players receive a grid of categories.'}`} />

            {/* Select if Categories are exclusive or not */}
            <ToggleButton
                title="Category Mode"
                active={exclusiveMode === false ? 'left' : 'right'}
                labelLeft="Not Exclusive"
                labelRight="Exclusive"
                onClick={(val: 'left' | 'right') => updateGameModeInfo({ exclusive_mode: val === 'left' ? false : true })}
                disabled={!isHost}
                isHost={isHost}
                position="middle"
                description={
                    exclusiveMode === false
                        ? 'Categories can be submitted by every player.'
                        : 'Each category can only be submitted by the first player submitting it. \
                        A player will not be able to overwrite his own submission!'
                }
            />

            {/* End Condition Selection */}
            {gameMode === 'bingo' && (
                <>
                    <ToggleButton
                        title="Win Condition"
                        active={endCondition === 'first_bingo' ? 'left' : 'right'}
                        labelLeft="First Bingo"
                        labelRight="Full Time"
                        onClick={(val: 'left' | 'right') =>
                            updateGameModeInfo({
                                end_condition: val === 'left' ? 'first_bingo' : 'timer',
                            })
                        }
                        disabled={!isHost}
                        isHost={isHost}
                        description={endCondition === 'first_bingo' ? 'Game ends instantly when someone gets a Bingo. The Bingo gets verified by AI.' : 'Game continues until the timer runs out, extra points for each Bingo.'}
                    />
                </>
            )}

            {/* Time Slider */}
            <RangeSlider title="Time Limit" min={1} max={30} step={1} value={localTimeLimit} displayValue={`${localTimeLimit} Minutes`} onChange={setLocalTimeLimit} disabled={!isHost} onCommit={handleCommit} position="bottom" />
        </div>
    );
}
