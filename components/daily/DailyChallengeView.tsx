'use client';

/*
================================================================================
DAILY CHALLENGE — PLAY VIEW
================================================================================
Single-category Street View hunt against an up-counting stopwatch, in ONE window
just like the regular playing view. A single Google Map owns the panorama:

  * Open-world (no admin-validated start) — the player sees the world map and
    drops the Pegman to enter Street View wherever they like. No forced spawn.
  * Pinned (admin-validated start) — the panorama opens immediately at that spot.

"I found it" reads the current panorama view and verifies it with the shared
verifySingleView() AI gate; it only counts on YES. "Give up" forfeits. Anonymous
players can play but are never recorded. Replay is an admin-only convenience.
================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GoogleMap, StreetViewPanorama, useJsApiLoader } from '@react-google-maps/api';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaFlag, FaSpinner } from 'react-icons/fa';

import { useUser } from '@/components/community/useUser';
import { initialWorldZoom, panoOptions, safeStartCenter } from '@/components/streetview/streetViewHelpers';
import { verifySingleView } from '@/components/utils/aiVerify';
import { ExitButton } from '@/components/utils/Elements';
import { GOOGLE_MAPS_LIBRARIES, isLocationAllowed, mapOptions } from '@/components/utils/mapUtils';
import type { DailyChallenge, DailyViewpoint } from '@/components/utils/types';
import { amIDailyAdmin, forfeitDailyAttempt, formatDuration, getDailyChallenge, resolveDailyCategory, revealDailyLocation, startDailyAttempt, submitDailyAttempt, todayUtc } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';
import { useSounds } from '@/lib/sound/SoundProvider';

import DailyFindFeed from './DailyFindFeed';
import DailyLeaderboard from './DailyLeaderboard';

type Phase = 'loading' | 'missing' | 'playing' | 'verifying' | 'done';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export default function DailyChallengeView({ date }: { date: string }) {
    const { t, locale } = useT();
    const { play } = useSounds();
    const { user, loading: userLoading } = useUser();
    const resolvedDate = useMemo(() => (date === 'today' ? todayUtc() : date), [date]);

    const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: MAPS_KEY, libraries: GOOGLE_MAPS_LIBRARIES });

    const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
    const [phase, setPhase] = useState<Phase>('loading');
    const [outcome, setOutcome] = useState<'found' | 'forfeit' | null>(null);
    const [finalMs, setFinalMs] = useState<number | null>(null);
    const [answer, setAnswer] = useState<DailyViewpoint | null>(null);
    const [lastReason, setLastReason] = useState<string | null>(null);
    const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
    const [tick, setTick] = useState(0);
    const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);
    const [runId, setRunId] = useState(0);
    const [isAdmin, setIsAdmin] = useState(false);
    const [inStreetView, setInStreetView] = useState(false);

    const mapRef = useRef<google.maps.Map | null>(null);
    const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const startPosRef = useRef<{ lat: number; lng: number } | null>(null); // pinned start, else null (open-world)
    const startRef = useRef<number>(0);

    // Admin gate for the replay button (resolves to false when logged out).
    useEffect(() => {
        let alive = true;
        amIDailyAdmin().then((v) => alive && setIsAdmin(v));
        return () => {
            alive = false;
        };
    }, [user]);

    // 1. Load the challenge (without answer coordinates).
    useEffect(() => {
        let alive = true;
        getDailyChallenge(resolvedDate)
            .then((c) => {
                if (!alive) return;
                if (!c) {
                    setPhase('missing');
                    return;
                }
                setChallenge(c);
            })
            .catch(() => alive && setPhase('missing'));
        return () => {
            alive = false;
        };
    }, [resolvedDate]);

    const loadReveal = useCallback(async () => {
        if (!challenge?.has_location) return;
        try {
            const r = await revealDailyLocation(resolvedDate);
            if (r.hasLocation && r.viewpoint) setAnswer(r.viewpoint);
        } catch {
            /* reveal is best-effort */
        }
    }, [challenge, resolvedDate]);

    // Begin a run. For authenticated users, registers started_at on the server
    // (crash recovery + anti-cheat). force=true resets a completed attempt (admin).
    // Open-world starts on the world map; pinned snaps to the nearest panorama.
    const beginPlaying = useCallback(
        async (force = false) => {
            if (!challenge || !isLoaded) return;

            if (user) {
                const res = await startDailyAttempt(resolvedDate, force).catch(() => null);
                if (res?.started_at && !startRef.current) {
                    // Seed the timer from server start so a resumed session shows the right elapsed time
                    startRef.current = new Date(res.started_at).getTime();
                }
            }

            const pinned = challenge.start_lat != null && challenge.start_lng != null;
            if (!pinned) {
                startPosRef.current = null;
                setLastReason(null);
                setRunId((n) => n + 1);
                setPhase('playing');
                return;
            }
            const rawStart = { lat: challenge.start_lat as number, lng: challenge.start_lng as number };
            const svc = new google.maps.StreetViewService();
            svc.getPanorama({ location: rawStart }, (data, status) => {
                startPosRef.current = status === google.maps.StreetViewStatus.OK && data?.location?.latLng ? { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() } : rawStart;
                setLastReason(null);
                setRunId((n) => n + 1);
                setPhase('playing');
            });
        },
        [challenge, isLoaded, resolvedDate, user],
    );

    // 2. Restore state from the server. Authenticated users get my_attempt back
    //    from getDailyChallenge, so there's no localStorage dependency and a crash
    //    mid-run is automatically recovered (in-progress → resume timer from started_at).
    useEffect(() => {
        if (!challenge || !isLoaded || userLoading) return;

        const my = challenge.my_attempt;
        if (my) {
            if (my.duration_ms != null) {
                setOutcome('found');
                setFinalMs(my.duration_ms);
                setPhase('done');
                loadReveal();
                return;
            }
            if (my.forfeited) {
                setOutcome('forfeit');
                setPhase('done');
                loadReveal();
                return;
            }
            // In-progress: seed the timer so it continues from where it left off
            if (my.started_at) {
                startRef.current = new Date(my.started_at).getTime();
            }
        }

        beginPlaying();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [challenge, isLoaded, userLoading, user]);

    // Replay (admin only): force-resets the server attempt and restarts the timer.
    const playAgain = () => {
        setOutcome(null);
        setFinalMs(null);
        setAnswer(null);
        setLastReason(null);
        startRef.current = 0;
        setPhase('loading');
        beginPlaying(true);
    };

    // 3. Stopwatch tick while playing.
    useEffect(() => {
        if (phase !== 'playing') return;
        const id = setInterval(() => setTick((n) => n + 1), 250);
        return () => clearInterval(id);
    }, [phase]);

    const elapsedMs = phase === 'playing' && startRef.current ? Date.now() - startRef.current : (finalMs ?? 0);

    const onMapLoad = (map: google.maps.Map) => {
        mapRef.current = map;
        // Only set start time if not already seeded from a server-side resumed session
        if (!startRef.current) startRef.current = Date.now();
    };

    const onPanoLoad = (pano: google.maps.StreetViewPanorama) => {
        panoRef.current = pano;
        pano.addListener('visible_changed', () => setInStreetView(pano.getVisible()));

        // Keep play inside the admin-drawn boundary (best-effort, like simulate
        // mode): once the player has a valid position, any move outside snaps back.
        const boundary = challenge?.boundary;
        if (boundary && boundary !== '[]') {
            let lastValid: google.maps.LatLng | null = null;
            pano.addListener('position_changed', () => {
                const pos = pano.getPosition();
                if (!pos) return;
                if (isLocationAllowed({ lat: pos.lat(), lng: pos.lng() }, boundary)) lastValid = pos;
                else if (lastValid) pano.setPosition(lastValid);
            });
        }

        if (startPosRef.current) {
            pano.setPosition(startPosRef.current);
            pano.setVisible(true);
        }
    };

    // Read the live panorama view — null when the player is still on the map (hasn't
    // dropped the Pegman into Street View yet).
    const readViewpoint = (): DailyViewpoint | null => {
        const pano = panoRef.current;
        if (!pano || !pano.getVisible()) return null;
        const pos = pano.getPosition();
        if (!pos) return null;
        const pov = pano.getPov();
        return { lat: pos.lat(), lng: pos.lng(), heading: pov.heading ?? 0, pitch: pov.pitch ?? 0, zoom: pano.getZoom() ?? 1 };
    };

    const onFound = async () => {
        if (!challenge) return;
        const vp = readViewpoint();
        if (!vp) {
            toast.error(t('daily.moveFirst'));
            return;
        }
        const elapsed = Date.now() - startRef.current;
        setPhase('verifying');
        setLastReason(null);
        try {
            const { passed, reason } = await verifySingleView({ category: challenge.category, ...vp }, MAPS_KEY);
            if (!passed) {
                setLastReason(reason);
                setPhase('playing');
                play('verify-reject');
                toast.error(t('daily.notAccepted'));
                return;
            }
            play('verify-accept');
            setFinalMs(elapsed);
            setOutcome('found');
            await submitDailyAttempt(resolvedDate, elapsed, vp, reason).catch(() => null);
            setPhase('done');
            setLeaderboardRefresh((n) => n + 1);
            await loadReveal();
        } catch {
            setPhase('playing');
            toast.error(t('daily.verifyError'));
        }
    };

    const onGiveUp = async () => {
        setConfirmingGiveUp(false);
        setOutcome('forfeit');
        await forfeitDailyAttempt(resolvedDate).catch(() => null);
        setPhase('done');
        await loadReveal();
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (phase === 'loading' || !isLoaded) {
        return (
            <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-slate-900 text-slate-300">
                <FaSpinner className="animate-spin text-indigo-400" size={28} />
                <p>{t('daily.loadingChallenge')}</p>
            </div>
        );
    }

    if (phase === 'missing' || !challenge) {
        return (
            <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-slate-900 px-6 text-center text-slate-300">
                <p className="text-lg font-medium">{t('daily.noChallenge')}</p>
                <Link href="/daily" className="rounded-xl bg-indigo-600 px-5 py-2.5 font-bold uppercase text-white hover:bg-indigo-500">
                    {t('daily.backToHub')}
                </Link>
            </div>
        );
    }

    if (phase === 'done') {
        return (
            <main className="min-h-dvh bg-slate-900 px-4 py-8 text-white">
                <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
                    <Link href="/daily" className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white">
                        <FaArrowLeft size={12} /> {t('daily.backToHub')}
                    </Link>

                    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center">
                        <p className="text-sm uppercase tracking-wide text-slate-400">{resolveDailyCategory(challenge, locale)}</p>
                        {outcome === 'found' ? (
                            <>
                                <h1 className="mt-2 text-2xl font-bold text-indigo-300">{t('daily.accepted')}</h1>
                                {finalMs != null && <p className="mt-1 font-mono text-4xl font-bold tabular-nums">{formatDuration(finalMs)}</p>}
                            </>
                        ) : (
                            <h1 className="mt-2 text-2xl font-bold text-slate-300">{t('daily.gaveUp')}</h1>
                        )}
                        {!user && <p className="mt-3 text-xs text-amber-300">{t('daily.anonNote')}</p>}
                        {(isAdmin || !user) && (
                            <button type="button" onClick={playAgain} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold uppercase text-white hover:bg-indigo-500">
                                admin: {t('daily.replay')}
                            </button>
                        )}
                    </div>

                    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
                        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{t('daily.leaderboard')}</h2>
                        <DailyLeaderboard date={resolvedDate} refreshKey={leaderboardRefresh} />
                    </div>

                    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
                        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{t('daily.finds')}</h2>
                        <DailyFindFeed date={resolvedDate} answer={answer} isLoaded={isLoaded} />
                    </div>
                </div>
            </main>
        );
    }

    // playing / verifying — one window: a single map that owns the panorama.
    return (
        <div className="relative h-dvh w-full overflow-hidden bg-slate-900">
            <GoogleMap key={runId} mapContainerClassName="absolute inset-0" center={startPosRef.current ?? safeStartCenter} zoom={startPosRef.current ? 14 : initialWorldZoom} options={mapOptions({ streetViewControl: true, gestureHandling: 'greedy' })} onLoad={onMapLoad}>
                <StreetViewPanorama options={panoOptions} onLoad={onPanoLoad} />
            </GoogleMap>

            {/* Top bar: exit (in Street View) + category on the left, stopwatch + give up on the right */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4">
                <div className={`pointer-events-auto ${!inStreetView && 'invisible'}`}>
                    <ExitButton onExit={() => panoRef.current?.setVisible(false)} />
                </div>
                <div className="text-center pointer-events-auto max-w-[55vw] rounded-2xl bg-slate-900/85 px-4 py-2.5 shadow-xl backdrop-blur">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('daily.find')}</p>
                    <p className="truncate text-base font-bold text-white sm:text-lg">{resolveDailyCategory(challenge, locale)}</p>
                </div>
                <div className="pointer-events-auto flex items-center gap-2">
                    <div className="rounded-2xl bg-slate-900/85 px-4 py-2.5 font-mono text-xl font-bold tabular-nums text-indigo-300 shadow-xl backdrop-blur" aria-live="off">
                        {/* tick forces re-render */}
                        <span className="sr-only">{tick}</span>
                        {formatDuration(elapsedMs)}
                    </div>
                    <button type="button" onClick={() => setConfirmingGiveUp(true)} className="h-full rounded-2xl bg-slate-900/85 px-4 py-4 text-slate-300 shadow-xl backdrop-blur hover:text-red-400" title={t('daily.giveUp')}>
                        <FaFlag />
                    </button>
                </div>
            </div>

            {!user && (
                <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-20 flex justify-center px-4 sm:top-20">
                    <span className="pointer-events-auto rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-slate-900 shadow">{t('daily.guestBanner')}</span>
                </div>
            )}

            {/* Bottom: I found it (click-through container so the map's Pegman stays reachable) */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 p-4 sm:p-6">
                {lastReason && <p className="max-w-md rounded-xl bg-red-900/80 px-3 py-2 text-center text-xs text-red-100 shadow">{t('daily.notAcceptedReason', { reason: lastReason })}</p>}
                <button type="button" onClick={onFound} disabled={phase === 'verifying'} className="pointer-events-auto flex items-center gap-2 rounded-full bg-indigo-600 px-8 py-3.5 text-base font-bold uppercase tracking-wide text-white shadow-2xl transition-all hover:bg-indigo-500 disabled:opacity-60">
                    {phase === 'verifying' ? (
                        <>
                            <FaSpinner className="animate-spin" /> {t('daily.verifying')}
                        </>
                    ) : (
                        t('daily.iFoundIt')
                    )}
                </button>
            </div>

            {/* Give-up confirm */}
            {confirmingGiveUp && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
                    <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center">
                        <p className="font-medium text-white">{t('daily.giveUpConfirm')}</p>
                        <div className="flex justify-center gap-2">
                            <button type="button" onClick={() => setConfirmingGiveUp(false)} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-slate-600">
                                {t('daily.keepPlaying')}
                            </button>
                            <button type="button" onClick={onGiveUp} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-red-500">
                                {t('daily.giveUp')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
