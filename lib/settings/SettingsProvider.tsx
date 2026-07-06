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

Backed by useSyncExternalStore so it is hydration-safe: the server (and the first
client render) see DEFAULTS, then React reconciles to the persisted value on the
client without a mismatch — reading localStorage in a useState initializer would
otherwise render a different value on the client than the server sent.
================================================================================
*/

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

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

// ── External store (module-level, single source shared by all consumers) ──────

let cache: Settings | null = null; // lazily read from localStorage on first client snapshot
const listeners = new Set<() => void>();

function readStorage(): Settings {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
        return { ...DEFAULTS, ...parsed, volume: clamp01(Number(parsed.volume ?? DEFAULTS.volume)) };
    } catch {
        return DEFAULTS;
    }
}

// Must return a stable reference between changes, or useSyncExternalStore loops.
function getSnapshot(): Settings {
    if (cache === null) cache = readStorage();
    return cache;
}

function getServerSnapshot(): Settings {
    return DEFAULTS;
}

function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    // Keep other tabs in sync (the current tab notifies itself in writeSetting).
    const onStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
            cache = readStorage();
            listeners.forEach((l) => l());
        }
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onStorage);
    };
}

function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    cache = { ...(cache ?? readStorage()), [key]: value };
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
        /* private mode / storage disabled — keep it in memory for this session */
    }
    listeners.forEach((l) => l());
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => writeSetting(key, value), []);

    const value = useMemo(() => ({ settings, setSetting }), [settings, setSetting]);

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
    const ctx = useContext(SettingsContext);
    if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
    return ctx;
}
