'use client';

/*
================================================================================
GAME PHASE CONTEXT
================================================================================
Tracks which phase the active game room is in so chrome mounted in the root
layout (e.g. the LanguageSwitcher) can react to it. `phase` is null whenever the
user is NOT inside a game room (home, login, legal pages) — i.e. "before lobby".
The GameRoom reports its status here; consumers decide what to show per phase.
================================================================================
*/

import { createContext, useContext, useMemo, useState } from 'react';

export type GamePhase = 'lobby' | 'playing' | 'voting' | 'finished' | null;

interface GamePhaseContextValue {
    phase: GamePhase;
    setPhase: (phase: GamePhase) => void;
}

const GamePhaseContext = createContext<GamePhaseContextValue | null>(null);

export function GamePhaseProvider({ children }: { children: React.ReactNode }) {
    const [phase, setPhase] = useState<GamePhase>(null);
    const value = useMemo(() => ({ phase, setPhase }), [phase]);
    return <GamePhaseContext.Provider value={value}>{children}</GamePhaseContext.Provider>;
}

export function useGamePhase(): GamePhaseContextValue {
    const ctx = useContext(GamePhaseContext);
    if (!ctx) throw new Error('useGamePhase must be used within a GamePhaseProvider');
    return ctx;
}
