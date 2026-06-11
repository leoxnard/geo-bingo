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

import { useEffect, useState } from 'react';

import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';

import { ToggleButton, RangeSlider } from '../utils/Elements';

interface LobbySettingsProps {
    isHost: boolean;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    gridSize: number;
    timeLimit: number;
    endCondition: 'first_bingo' | 'timer';
    exclusiveMode: boolean;
    updateGameModeInfo: (updates: { game_mode?: string; team_mode?: string; time_limit?: number; grid_size?: number; end_condition?: 'first_bingo' | 'timer'; exclusive_mode?: boolean }) => void;
}

export default function LobbySettings({ isHost, gameMode, teamMode, timeLimit, endCondition, exclusiveMode, updateGameModeInfo }: LobbySettingsProps) {
    const { t } = useT();
    const [localTimeLimit, setLocalTimeLimit] = useState(timeLimit / 60);

    // Follow external time-limit changes (preset import, another host's realtime edit);
    // the prop doesn't change during local dragging, so this never fights the user.
    useEffect(() => {
        setLocalTimeLimit(timeLimit / 60);
    }, [timeLimit]);

    const handleCommit = () => {
        if (!isHost) return;
        updateGameModeInfo({
            time_limit: localTimeLimit * 60,
        });
    };

    return (
        <div className="bg-slate-800 p-4 sm:p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            {/* Team Mode Selection */}
            <ToggleButton title={t('settings.teamMode')} active={teamMode === 'ffa' ? 'left' : 'right'} onClick={(val: 'left' | 'right') => updateGameModeInfo({ team_mode: val === 'left' ? 'ffa' : 'teams' })} disabled={!isHost} isHost={isHost} labelLeft={t('settings.noTeams')} labelRight={t('settings.teams')} iconLeft="person" iconRight="person.2" position="top" />

            {/* Game Mode Selection */}
            {FEATURES.bingoMode && (
                <ToggleButton title={t('settings.gameMode')} active={gameMode === 'list' ? 'left' : 'right'} onClick={(val: 'left' | 'right') => updateGameModeInfo({ game_mode: val === 'left' ? 'list' : 'bingo' })} disabled={!isHost} isHost={isHost} labelLeft={t('settings.classicList')} labelRight={t('settings.bingoGrid')} iconLeft="rectangle.grid.1x3" iconRight="square.grid.3x3" description={gameMode === 'list' ? t('settings.gameModeDescList') : t('settings.gameModeDescBingo')} />
            )}

            {/* Select if Categories are exclusive or not */}
            {FEATURES.exclusiveCategories && (
                <ToggleButton
                    title={t('settings.categoryMode')}
                    active={exclusiveMode === false ? 'left' : 'right'}
                    labelLeft={t('settings.notExclusive')}
                    labelRight={t('settings.exclusive')}
                    iconLeft="rectangle.fill.badge.person.2.crop"
                    iconRight="rectangle.fill.badge.person.crop"
                    onClick={(val: 'left' | 'right') => updateGameModeInfo({ exclusive_mode: val === 'left' ? false : true })}
                    disabled={!isHost}
                    isHost={isHost}
                    position="middle"
                    description={exclusiveMode === false ? t('settings.categoryModeDescNotExclusive') : t('settings.categoryModeDescExclusive')}
                />
            )}

            {/* End Condition Selection */}
            {FEATURES.winCondition && gameMode === 'bingo' && (
                <>
                    <ToggleButton
                        title={t('settings.winCondition')}
                        active={endCondition === 'first_bingo' ? 'left' : 'right'}
                        labelLeft={t('settings.firstBingo')}
                        labelRight={t('settings.fullTime')}
                        iconLeft="square.grid.3x3.bingo"
                        iconRight="timer"
                        onClick={(val: 'left' | 'right') =>
                            updateGameModeInfo({
                                end_condition: val === 'left' ? 'first_bingo' : 'timer',
                            })
                        }
                        disabled={!isHost}
                        isHost={isHost}
                        description={endCondition === 'first_bingo' ? t('settings.winConditionDescFirst') : t('settings.winConditionDescTimer')}
                    />
                </>
            )}

            {/* Time Slider */}
            <RangeSlider title={t('settings.timeLimit')} min={1} max={60} step={1} value={localTimeLimit} displayValue={t('settings.minutes', { count: localTimeLimit })} onChange={setLocalTimeLimit} disabled={!isHost} onCommit={handleCommit} position="bottom" />
        </div>
    );
}
