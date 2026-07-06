'use client';

/*
================================================================================
SOUND PROVIDER
================================================================================
Central owner of every UI sound effect. Each sound is loaded once here via
`useSound` (Howler under the hood) at a base volume, then scaled by the master
`settings.volume` slider so muting/attenuation is respected everywhere for free.

Two ways sounds fire:

  1. Buttons — a single capture-phase `click` listener on the document plays the
     minimalist `click` blip for any <button> / [role="button"]. No per-button
     wiring needed. Opt out with `data-sound="none"`, or swap the effect with
     `data-sound="<name>"` on the button (or an ancestor).

  2. Special moments — components call `useSounds().play('verify-accept' | …)`
     directly (AI verdicts, podium reveal) where there's no click to hook.

Timer sounds (ticking / countdown) still live in StreetView on plain Audio; they
predate this and aren't button/moment driven, so they're intentionally left be.
================================================================================
*/

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

import useSound from 'use-sound';

import { useSettings } from '@/lib/settings/SettingsProvider';

// Each sound's file + its authored (base) loudness relative to the master volume.
// UI clicks sit well under celebratory cues so they never feel fatiguing.
// `interrupt` restarts an in-flight instance instead of overlapping — right for a
// single click, wrong for slider ticks (we WANT those to stack into a "brrrt").
const SOUNDS = {
    click: { src: '/sounds/click.wav', volume: 0.35, interrupt: true },
    denied: { src: '/sounds/denied.wav', volume: 0.5, interrupt: true },
    'slider-tick': { src: '/sounds/slider-tick.wav', volume: 0.3, interrupt: false },
    'verify-accept': { src: '/sounds/verify-accept.wav', volume: 0.55, interrupt: false },
    'verify-reject': { src: '/sounds/verify-reject.wav', volume: 0.5, interrupt: false },
    'categories-ready': { src: '/sounds/categories-ready.wav', volume: 0.55, interrupt: false },
    'podium-first': { src: '/sounds/podium-first.wav', volume: 0.65, interrupt: false },
} as const;

export type SoundName = keyof typeof SOUNDS;

type PlayFn = (name: SoundName) => void;

const SoundContext = createContext<PlayFn | null>(null);

export function SoundProvider({ children }: { children: React.ReactNode }) {
    const { settings } = useSettings();
    const master = settings.volume;

    // One useSound per effect (fixed set — safe to call unconditionally). Volume is
    // reactive, so dragging the master slider re-scales live.
    const [playClick] = useSound(SOUNDS.click.src, { volume: SOUNDS.click.volume * master, interrupt: SOUNDS.click.interrupt });
    const [playDenied] = useSound(SOUNDS.denied.src, { volume: SOUNDS.denied.volume * master, interrupt: SOUNDS.denied.interrupt });
    const [playTick] = useSound(SOUNDS['slider-tick'].src, { volume: SOUNDS['slider-tick'].volume * master, interrupt: SOUNDS['slider-tick'].interrupt });
    const [playAccept] = useSound(SOUNDS['verify-accept'].src, { volume: SOUNDS['verify-accept'].volume * master });
    const [playReject] = useSound(SOUNDS['verify-reject'].src, { volume: SOUNDS['verify-reject'].volume * master });
    const [playCategories] = useSound(SOUNDS['categories-ready'].src, { volume: SOUNDS['categories-ready'].volume * master });
    const [playPodium] = useSound(SOUNDS['podium-first'].src, { volume: SOUNDS['podium-first'].volume * master });

    const players = useMemo(
        () => ({
            click: playClick,
            denied: playDenied,
            'slider-tick': playTick,
            'verify-accept': playAccept,
            'verify-reject': playReject,
            'categories-ready': playCategories,
            'podium-first': playPodium,
        }),
        [playClick, playDenied, playTick, playAccept, playReject, playCategories, playPodium],
    );

    // The document listener + consumers read the latest players through a ref so a
    // volume change never re-registers the listener or hands out a stale closure.
    const playersRef = useRef(players);
    useEffect(() => {
        playersRef.current = players;
    }, [players]);

    const play = useCallback<PlayFn>(
        (name) => {
            if (master <= 0) return;
            playersRef.current[name]?.();
        },
        [master],
    );

    // Global button feedback: one capture listener covers the whole tree.
    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            const btn = target?.closest('button, [role="button"]') as HTMLElement | null;
            if (!btn) return;
            if (btn.getAttribute('aria-disabled') === 'true' || (btn as HTMLButtonElement).disabled) return;

            const override = btn.closest('[data-sound]')?.getAttribute('data-sound');
            if (override === 'none') return;
            const name = (override && override in SOUNDS ? override : 'click') as SoundName;
            play(name);
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [play]);

    // Global slider feedback: a tick per notch on any range input. `input` fires once
    // per value change, so each event is one notch — dragging stacks them satisfyingly.
    useEffect(() => {
        const onInput = (e: Event) => {
            const el = e.target as HTMLElement | null;
            if (!el || el.tagName !== 'INPUT' || (el as HTMLInputElement).type !== 'range') return;
            if (el.closest('[data-sound]')?.getAttribute('data-sound') === 'none') return;
            play('slider-tick');
        };
        document.addEventListener('input', onInput, true);
        return () => document.removeEventListener('input', onInput, true);
    }, [play]);

    return <SoundContext.Provider value={play}>{children}</SoundContext.Provider>;
}

// Returns a stable `play(name)` for the special, non-button moments. Falls back to
// a no-op outside the provider so a component can call it without a hard crash.
export function useSounds(): { play: PlayFn } {
    const play = useContext(SoundContext);
    return { play: play ?? (() => {}) };
}
