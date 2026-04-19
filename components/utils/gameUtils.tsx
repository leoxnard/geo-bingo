/*
================================================================================
GAME UTILS MODULE
================================================================================
Game-specific utility functions for player and team management.
Handles visibility logic, team assignments, and game state calculations.
Provides core game mechanics and player interaction helpers.
================================================================================
*/

import { Player } from "./types";

export const getVisiblePlayerIds = (
  players: Player[],
  playerId: string,
  teamMode: "ffa" | "teams",
): string[] => {
  const myTeam = players.find((p) => p.id === playerId)?.team ?? -1;
  return teamMode === "teams"
    ? players.filter((p) => p.team === myTeam).map((p) => p.id)
    : [playerId];
};
