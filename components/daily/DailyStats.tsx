'use client';

/*
================================================================================
DAILY STATS
================================================================================
The signed-in player's lifetime Daily Challenge counters (completed / won),
fetched through get_my_daily_stats (auth.uid()). Renders nothing for guests.
================================================================================
*/

import { useEffect, useState } from 'react';

import type { DailyStats as Stats } from '@/components/utils/types';
import { getMyDailyStats } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';

export default function DailyStats({ refreshKey = 0 }: { refreshKey?: number }) {
    const { t } = useT();
    const [stats, setStats] = useState<Stats | null>(null);

    useEffect(() => {
        let alive = true;
        getMyDailyStats()
            .then((s) => alive && setStats(s))
            .catch(() => alive && setStats(null));
        return () => {
            alive = false;
        };
    }, [refreshKey]);

    if (!stats) return null;

    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="glass rounded-xl p-4 text-center">
                <div className="text-3xl font-bold text-indigo-300">{stats.completed}</div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('daily.completed')}</div>
            </div>
            <div className="glass rounded-xl p-4 text-center">
                <div className="text-3xl font-bold text-amber-300">{stats.won}</div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('daily.won')}</div>
            </div>
        </div>
    );
}
