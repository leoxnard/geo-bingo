import { Player } from './types';

export const getVisiblePlayerIds = (
    players: Player[], 
    playerId: string, 
    teamMode: 'ffa' | 'teams'
): string[] => {
    const myTeam = players.find(p => p.id === playerId)?.team ?? -1;
    return teamMode === 'teams' 
        ? players.filter(p => p.team === myTeam).map(p => p.id) 
        : [playerId];
};
