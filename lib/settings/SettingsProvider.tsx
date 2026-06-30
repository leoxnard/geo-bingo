'use client';

/*
================================================================================
SETTINGS PROVIDER
================================================================================
Holds this user's client-side preferences (the ones that aren't the UI language,
which lives in I18nProvider because it needs a server-readable cookie). Right now
that's just the master audio volume, but the shape is deliberately a single
`settings` object persisted as one JSON blob in localStorage so new options can
be added by extending `Settings` + `DEFAULTS` — nothing else has to change.

Consumed by OptionsButton (the gear menu on the pre-game surfaces) and by any
component that plays audio (see StreetView's timer sounds).
================================================================================
*/

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'geoBingoSettings';

export interface Settings {
    /** Master audio volume, 0 (muted) – 1 (full / as authored). */
    volume: number;
}

const DEFAULTS: Settings = { volume: 1 };

interface SettingsContextValue {
    settings: Settings;
    setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULTS.volume);

function readInitial(): Settings {
    if (typeof window === 'undefined') return DEFAULTS;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
        return { ...DEFAULTS, ...parsed, volume: clamp01(Number(parsed.volume ?? DEFAULTS.volume)) };
    } catch {
        return DEFAULTS;
    }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<Settings>(readInitial);

    const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        setSettings((prev) => {
            const next = { ...prev, [key]: value };
            try {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                /* private mode / storage disabled — keep it in memory for this session */
            }
            return next;
        });
    }, []);

    const value = useMemo(() => ({ settings, setSetting }), [settings, setSetting]);

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
    const ctx = useContext(SettingsContext);
    if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
    return ctx;
}
