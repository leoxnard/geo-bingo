'use client';

/*
================================================================================
ADMIN HUB
================================================================================
Landing page for all admin tools. Gated to allow-listed admins (am_i_daily_admin,
the same email allow-list the individual admin windows check). Lists every admin
subpage whose feature flag is on and links straight into it — a single entry
point instead of remembering each /admin/* route. The subpages enforce their own
access gate again, so this hub is only a convenience shell, not the security
boundary.
================================================================================
*/

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { FaBook, FaCalendarDay, FaChevronRight, FaDrawPolygon } from 'react-icons/fa';

import AccountButton from '@/components/account/AccountButton';
import AuthGate from '@/components/community/AuthGate';
import { useUser } from '@/components/community/useUser';
import { amIDailyAdmin } from '@/lib/daily';
import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import type { MessageKey } from '@/lib/i18n/messages';

type Tool = {
    href: string;
    icon: React.ReactNode;
    titleKey: MessageKey;
    descKey: MessageKey;
    enabled: boolean;
};

export default function AdminHub() {
    const { t } = useT();
    const { user, loading: userLoading } = useUser();
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

    useEffect(() => {
        if (!user) return;
        let alive = true;
        amIDailyAdmin().then((v) => alive && setIsAdmin(v));
        return () => {
            alive = false;
        };
    }, [user]);

    if (userLoading) return <Centered>{t('common.loading')}</Centered>;
    if (!user)
        return (
            <Centered>
                <div className="w-full max-w-md">
                    <AuthGate>
                        <p className="text-sm text-emerald-300">{t('community.signedIn')}</p>
                    </AuthGate>
                </div>
            </Centered>
        );
    if (isAdmin === null) return <Centered>{t('common.loading')}</Centered>;
    if (!isAdmin)
        return (
            <Centered>
                <div className="flex flex-col items-center gap-4">
                    <p>{t('daily.admin.notAdmin')}</p>
                    <AccountButton />
                </div>
            </Centered>
        );

    const tools: Tool[] = [
        { href: '/admin/daily', icon: <FaCalendarDay />, titleKey: 'admin.daily.title', descKey: 'admin.daily.desc', enabled: FEATURES.dailyChallenge },
        { href: '/admin/words', icon: <FaBook />, titleKey: 'admin.words.title', descKey: 'admin.words.desc', enabled: FEATURES.exploreWords },
        { href: '/admin/presets', icon: <FaDrawPolygon />, titleKey: 'admin.presets.title', descKey: 'admin.presets.desc', enabled: FEATURES.presetExport },
    ];
    const active = tools.filter((tool) => tool.enabled);

    return (
        <main className="min-h-dvh bg-slate-900 px-4 py-8 text-white">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-indigo-300">{t('admin.title')}</h1>
                        <p className="mt-1 text-sm text-slate-400">{t('admin.subtitle')}</p>
                    </div>
                    <AccountButton />
                </div>

                {active.length === 0 ? (
                    <p className="text-sm text-slate-400">{t('admin.noTools')}</p>
                ) : (
                    <ul className="flex flex-col gap-3">
                        {active.map((tool) => (
                            <li key={tool.href}>
                                <Link href={tool.href} className="flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-800 p-4 transition-colors hover:border-indigo-500 hover:bg-slate-700">
                                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-lg text-indigo-300">{tool.icon}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-white">{t(tool.titleKey)}</p>
                                        <p className="text-sm text-slate-400">{t(tool.descKey)}</p>
                                    </div>
                                    <FaChevronRight className="flex-shrink-0 text-slate-500" size={14} />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </main>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <main className="flex min-h-dvh items-center justify-center bg-slate-900 px-4 text-center text-slate-300">{children}</main>;
}
