/*
================================================================================
HOST TOKEN
================================================================================
The host capability is a high-entropy secret kept only in the host's browser
(localStorage) and validated server-side by the host RPCs. Unlike host_id (the
host's public player id), this token is never exposed in any readable row or
realtime payload, so a player can't read it to act as host.
================================================================================
*/

const key = (gameId: string) => `geoBingoHostToken_${gameId}`;

export const getHostToken = (gameId: string): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key(gameId));
};

export const setHostToken = (gameId: string, token: string) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key(gameId), token);
};

export const clearHostToken = (gameId: string) => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key(gameId));
};

/** Generate + persist a fresh host token and return it. */
export const newHostToken = (gameId: string): string => {
    const token = crypto.randomUUID();
    setHostToken(gameId, token);
    return token;
};
