'use client';

/*
================================================================================
DAILY CHALLENGE — HUB
================================================================================
The landing screen behind the home "Play Daily Challenge" button. Built around a
single interactive unit: a spotlight for the selected day (today by default), a
calendar week strip to jump between the last 7 days, and that day's global
leaderboard. Signed-in players get a streak flame + lifetime stats; logged-out
players get a sign-in nudge (they can still play, just not rank).
================================================================================
*/

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';
import { FaArrowLeft, FaCheck, FaCrown, FaEye, FaFire, FaFlag, FaMapMarkedAlt, FaPlay, FaRedo, FaTrophy } from 'react-icons/fa';

import AuthGate from '@/components/community/AuthGate';
import { useUser } from '@/components/community/useUser';
import GlassAmbience from '@/components/utils/GlassAmbience';
import type { DailyRecentChallenge } from '@/components/utils/types';
import { formatDuration, getRecentDailyChallenges, resolveDailyCategory, todayUtc } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';
import OptionsButton from '@/lib/settings/OptionsButton';

import DailyLeaderboard from './DailyLeaderboard';
import DailyStats from './DailyStats';

const atUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);

const weekdayShort = (iso: string) => atUtc(iso).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const monthDay = (iso: string) => atUtc(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Played status for a recent day, used for tile colour + spotlight badge.
type DayStatus = 'won' | 'done' | 'forfeit' | 'open';
const statusOf = (r: DailyRecentChallenge): DayStatus => {
    if (r.my_time != null) return r.top_time != null && r.my_time <= r.top_time ? 'won' : 'done';
    if (r.my_forfeited) return 'forfeit';
    return 'open';
};

// Current streak: consecutive most-recent days completed. An unplayed *today*
// doesn't break it (you can still play); any earlier gap does.
const streakOf = (rows: DailyRecentChallenge[], todayStr: string) => {
    const desc = [...rows].sort((a, b) => (a.challenge_date < b.challenge_date ? 1 : -1));
    let streak = 0;
    for (let i = 0; i < desc.length; i++) {
        const played = desc[i].my_time != null;
        if (i === 0 && desc[i].challenge_date === todayStr && !played) continue;
        if (played) streak++;
        else break;
    }
    return streak;
};

export default function DailyHub() {
    const { t } = useT();
    const { user } = useUser();
    const todayStr = useMemo(() => todayUtc(), []);
    const [recent, setRecent] = useState<DailyRecentChallenge[] | null>(null);
    const [selected, setSelected] = useState<string>(todayStr);

    useEffect(() => {
        let alive = true;
        getRecentDailyChallenges()
            .then((rows) => alive && setRecent(rows))
            .catch(() => alive && setRecent([]));
        return () => {
            alive = false;
        };
    }, [user]);

    const week = useMemo(() => (recent ? [...recent].sort((a, b) => (a.challenge_date < b.challenge_date ? -1 : 1)) : []), [recent]);
    const day = recent?.find((r) => r.challenge_date === selected) ?? null;
    const isToday = selected === todayStr;
    const streak = recent && user ? streakOf(recent, todayStr) : 0;

    return (
        <main className="relative min-h-dvh overflow-hidden bg-slate-950 px-4 py-8 text-white">
            <GlassAmbience />
            <OptionsButton />
            <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-5">
                <div className="flex items-center justify-between gap-3">
                    <Link href="/" className="glass press inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-300 hover:text-white">
                        <FaArrowLeft size={12} /> {t('daily.backHome')}
                    </Link>
                </div>

                {/* Spotlight — the selected day (today by default) */}
                {recent === null ? <div className="glass h-52 animate-pulse rounded-3xl" /> : <Spotlight day={day} isToday={isToday} selected={selected} streak={streak} />}

                {/* Calendar week strip */}
                {week.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {week.map((r) => (
                            <DayTile key={r.id} r={r} todayStr={todayStr} selected={selected} onSelect={setSelected} />
                        ))}
                    </div>
                )}

                {/* Leaderboard for the selected day */}
                <div className="glass rounded-2xl p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-400">
                            <FaTrophy className="text-amber-400" size={13} /> {t('daily.leaderboard')}
                        </h2>
                        <span className="text-xs font-medium text-slate-500">{isToday ? t('daily.today') : monthDay(selected)}</span>
                    </div>
                    <DailyLeaderboard date={selected} />
                </div>

                {/* Stats or sign-in nudge */}
                {user ? (
                    <div className="flex flex-col gap-3">
                        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">{t('daily.yourStats')}</h2>
                        <DailyStats refreshKey={recent ? 1 : 0} />
                    </div>
                ) : (
                    <div className="glass rounded-2xl p-5">
                        <h2 className="text-lg font-bold text-indigo-300">{t('daily.signInToRank')}</h2>
                        <p className="mb-4 mt-1 text-sm text-slate-400">{t('daily.signInPrompt')}</p>
                        <AuthGate>
                            <p className="text-sm text-emerald-300">{t('community.signedIn')}</p>
                        </AuthGate>
                    </div>
                )}
            </div>
        </main>
    );
}

function Spotlight({ day, isToday, selected, streak }: { day: DailyRecentChallenge | null; isToday: boolean; selected: string; streak: number }) {
    const { t, locale } = useT();
    const eyebrow = isToday ? t('daily.today') : `${weekdayShort(selected)}, ${monthDay(selected)}`;

    return (
        <section className="glass relative overflow-hidden rounded-3xl p-6">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/20 via-transparent to-fuchsia-500/10" />
            <FaMapMarkedAlt className="pointer-events-none absolute -right-6 -top-6 text-indigo-500/10" size={170} />

            <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-300/80">
                        {t('daily.title')} · {eyebrow}
                    </p>
                    {streak >= 2 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-xs font-bold text-orange-300 ring-1 ring-orange-500/30">
                            <FaFire size={11} /> {t('daily.streak', { count: streak })}
                        </span>
                    )}
                </div>

                {day ? (
                    <>
                        <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('daily.find')}</p>
                            <h1 className="mt-1 text-3xl font-black leading-tight text-white sm:text-4xl">{resolveDailyCategory(day, locale)}</h1>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <MetaChip>{t('daily.players', { count: day.players })}</MetaChip>
                            {day.top_time != null && (
                                <MetaChip>
                                    <FaTrophy className="text-amber-400" size={10} /> {t('daily.best')} {formatDuration(day.top_time)}
                                </MetaChip>
                            )}
                            <YourBadge day={day} />
                        </div>

                        <CtaButton day={day} isToday={isToday} />
                    </>
                ) : (
                    <>
                        <h1 className="text-2xl font-black text-white sm:text-3xl">{t('daily.subtitle')}</h1>
                        <p className="text-sm text-slate-400">{t('daily.noChallenge')}</p>
                    </>
                )}
            </div>
        </section>
    );
}

function CtaButton({ day, isToday }: { day: DailyRecentChallenge; isToday: boolean }) {
    const { t } = useT();
    const status = statusOf(day);
    const href = isToday ? '/daily/today' : `/daily/${day.challenge_date}`;
    const [Icon, label] = status === 'won' || status === 'done' ? [FaEye, t('daily.viewResult')] : status === 'forfeit' ? [FaRedo, t('daily.replay')] : [FaPlay, t('daily.play')];

    return (
        <Link href={href} className="btn-sheen press inline-flex w-fit items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-6 py-3 font-bold uppercase tracking-wide text-white shadow-[0_14px_28px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]">
            <Icon size={13} /> {label}
        </Link>
    );
}

function YourBadge({ day }: { day: DailyRecentChallenge }) {
    const { t } = useT();
    const status = statusOf(day);
    if (status === 'won') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300 ring-1 ring-amber-500/30">
                <FaCrown size={10} /> {t('daily.you')} {formatDuration(day.my_time!)}
            </span>
        );
    }
    if (status === 'done') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                <FaCheck size={10} /> {t('daily.you')} {formatDuration(day.my_time!)}
            </span>
        );
    }
    if (status === 'forfeit') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/60 px-3 py-1 text-xs font-bold text-slate-300">
                <FaFlag size={10} /> {t('daily.gaveUp')}
            </span>
        );
    }
    return null;
}

function MetaChip({ children }: { children: React.ReactNode }) {
    return <span className="glass-inset inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-slate-300">{children}</span>;
}

function DayTile({ r, todayStr, selected, onSelect }: { r: DailyRecentChallenge; todayStr: string; selected: string; onSelect: (d: string) => void }) {
    const isToday = r.challenge_date === todayStr;
    const isSel = selected === r.challenge_date;
    const status = statusOf(r);

    const ring = isSel ? 'glass ring-2 ring-indigo-400/60' : isToday ? 'glass ring-1 ring-indigo-400/40' : 'glass opacity-70 hover:opacity-100';

    return (
        <button type="button" onClick={() => onSelect(r.challenge_date)} className={`press flex min-w-[64px] flex-1 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 transition-all ${ring}`}>
            <span className={`text-[10px] font-bold uppercase tracking-wide ${isToday ? 'text-indigo-300' : 'text-slate-500'}`}>{weekdayShort(r.challenge_date)}</span>
            <span className="text-lg font-bold leading-none text-white">{atUtc(r.challenge_date).getUTCDate()}</span>
            <StatusDot status={status} isToday={isToday} />
        </button>
    );
}

function StatusDot({ status, isToday }: { status: DayStatus; isToday: boolean }) {
    if (status === 'won') return <FaCrown className="text-amber-400" size={12} />;
    if (status === 'done') return <FaCheck className="text-emerald-400" size={11} />;
    if (status === 'forfeit') return <FaFlag className="text-slate-500" size={10} />;
    return <span className={`h-1.5 w-1.5 rounded-full ${isToday ? 'animate-pulse bg-indigo-400' : 'bg-slate-600'}`} />;
}
