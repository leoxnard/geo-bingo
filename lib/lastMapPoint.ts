/*
================================================================================
LAST MAP POINT
================================================================================
Client-only breadcrumb of the last valid Street View position, keyed by game +
player, so the "you are here" marker on the main map survives a page reload
instead of resetting to nothing. Purely cosmetic and local — no server write,
no RPC, no realtime.
================================================================================
*/

export type StoredMapPoint = { lat: number; lng: number };

const key = (gameId: string, playerId: string) => `geoBingoLastMapPoint_${gameId}_${playerId}`;

export const getLastMapPoint = (gameId: string, playerId: string): StoredMapPoint | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(key(gameId, playerId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') return parsed;
        return null;
    } catch {
        return null;
    }
};

export const setLastMapPoint = (gameId: string, playerId: string, point: StoredMapPoint) => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key(gameId, playerId), JSON.stringify(point));
    } catch {
        // best-effort only (private browsing / storage quota) — not critical to gameplay
    }
};

// Called when the round moves to voting: the round's marker is no longer relevant,
// so the next round's map starts with no "you are here" point rather than the
// previous round's last position.
export const clearLastMapPoint = (gameId: string, playerId: string) => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(key(gameId, playerId));
    } catch {
        // best-effort only
    }
};
