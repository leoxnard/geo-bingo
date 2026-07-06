'use client';

/*
================================================================================
DAILY LEADERBOARD
================================================================================
Global ranked times for one challenge day. Account holders only (anonymous plays
are never recorded). Fetched through the get_daily_leaderboard RPC.
================================================================================
*/

import { useEffect, useState } from 'react';

import type { DailyLeaderboardEntry } from '@/components/utils/types';
import { formatDuration, getDailyLeaderboard } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';

const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`);

export default function DailyLeaderboard({ date, refreshKey = 0 }: { date: string; refreshKey?: number }) {
    const { t } = useT();
    const [entries, setEntries] = useState<DailyLeaderboardEntry[] | null>(null);

    useEffect(() => {
        let alive = true;
        getDailyLeaderboard(date)
            .then((rows) => alive && setEntries(rows))
            .catch(() => alive && setEntries([]));
        return () => {
            alive = false;
        };
    }, [date, refreshKey]);

    if (entries === null) return <p className="text-slate-400 text-sm">{t('common.loading')}</p>;
    if (entries.length === 0) return <p className="text-slate-400 text-sm">{t('daily.noEntries')}</p>;

    return (
        <ol className="flex flex-col gap-1">
            {entries.map((e) => {
                const mine = e.mine;
                return (
                    <li key={`${e.rank}-${e.name}-${e.created_at}`} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${mine ? 'glass-inset ring-1 ring-indigo-400/50' : 'glass-inset'}`}>
                        <span className="w-7 text-center text-sm font-bold text-slate-300">{medal(e.rank)}</span>
                        <span className="flex-1 truncate font-medium text-white">{e.name}</span>
                        <span className="font-mono text-sm tabular-nums text-indigo-300">{formatDuration(e.duration_ms)}</span>
                    </li>
                );
            })}
        </ol>
    );
}
