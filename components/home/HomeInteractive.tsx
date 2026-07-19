'use client';

/*
================================================================================
HOME — INTERACTIVE HERO
================================================================================
The interactive top of the landing page: name input, create/join game, options
menu (account, language, audio), animated logo and a link to the how-to-play page. Split out of
app/page.tsx so the page itself can stay a server component. The full how-to-play
/ features content lives on its own server-rendered route at /how-to-play.
================================================================================
*/

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAccountName } from '@/components/community/useAccountName';
import { GeoBingoLogo } from '@/components/utils/Elements';
import { useViewport } from '@/components/utils/useViewport';
import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import OptionsButton from '@/lib/settings/OptionsButton';

import { adjectives, badAdjectives, animals } from '../../lib/names';

export default function HomeInteractive() {
    const { t } = useT();
    const [lobbyId, setLobbyId] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('geoBingoLastLobbyId') || '';
        }
        return '';
    });
    const [showBadNames, setShowBadNames] = useState(false);
    const router = useRouter();
    const [playerName, setPlayerName] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('geoBingoPlayerName') || '';
        }
        return '';
    });
    const { isNarrow } = useViewport();

    // When signed in, the account username is authoritative: it fills the field,
    // the field can't be edited here (rename lives in account settings), and a
    // linked Twitch account locks it entirely. Guests keep the free-text name.
    const account = useAccountName();
    const nameLocked = account.name !== null;
    // When locked, the field shows the account name (derived, not stored in the
    // free-text state) so it always reflects the current account / Twitch handle.
    const nameValue = nameLocked ? account.name! : playerName;

    const handleSaveName = () => {
        if (nameLocked) {
            localStorage.setItem('geoBingoPlayerName', account.name!);
            return;
        }
        const finalName = playerName.trim() || `${showBadNames ? badAdjectives[Math.floor(Math.random() * badAdjectives.length)] : adjectives[Math.floor(Math.random() * adjectives.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
        localStorage.setItem('geoBingoPlayerName', finalName);
    };

    const createGame = () => {
        handleSaveName();
        const id = Math.random().toString(36).substring(2, 8);
        router.push(`/game/${id}`);
    };

    const joinGame = (e: React.FormEvent) => {
        e.preventDefault();
        const normalized = lobbyId.trim().toLowerCase();
        if (normalized !== '') {
            handleSaveName();
            router.push(`/game/${normalized}`);
        }
    };

    return (
        <section id="play" className="relative flex flex-1 flex-col items-center justify-start sm:justify-center px-4 py-8 sm:px-8 sm:py-10 lg:px-24">
            <OptionsButton />

            {/* Floating glass bingo chips — the playful signature. Desktop only. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 hidden select-none lg:block">
                <div className="glass animate-chip-float absolute top-[16%] left-[12%] flex h-16 w-16 items-center justify-center rounded-2xl text-2xl [--chip-tilt:-8deg]" style={{ animationDelay: '-1s' }}>
                    🗼
                </div>
                <div className="animate-chip-float absolute top-[30%] left-[19%] flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500/80 to-indigo-600/80 text-xl shadow-[0_16px_32px_-8px_rgba(217,70,239,0.5),inset_0_1px_0_rgba(255,255,255,0.35)] [--chip-tilt:6deg]" style={{ animationDelay: '-3.5s' }}>
                    ✓
                </div>
                <div className="glass animate-chip-float absolute top-[58%] left-[10%] flex h-14 w-14 items-center justify-center rounded-2xl text-xl [--chip-tilt:5deg]" style={{ animationDelay: '-5s' }}>
                    🐕
                </div>
                <div className="glass animate-chip-float absolute top-[20%] right-[13%] flex h-14 w-14 items-center justify-center rounded-2xl text-xl [--chip-tilt:7deg]" style={{ animationDelay: '-2s' }}>
                    🚲
                </div>
                <div className="animate-chip-float absolute top-[38%] right-[9%] flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/80 to-indigo-500/80 text-2xl shadow-[0_16px_32px_-8px_rgba(34,211,238,0.5),inset_0_1px_0_rgba(255,255,255,0.35)] [--chip-tilt:-6deg]" style={{ animationDelay: '-4.5s' }}>
                    ✓
                </div>
                <div className="glass animate-chip-float absolute top-[62%] right-[15%] flex h-14 w-14 items-center justify-center rounded-2xl text-xl [--chip-tilt:-4deg]" style={{ animationDelay: '-6s' }}>
                    ⛲
                </div>
            </div>

            <div className="animate-fade-in-up mb-6 flex flex-col items-center justify-center gap-4 sm:mb-8 sm:flex-row sm:gap-6">
                <GeoBingoLogo size={isNarrow ? 50 : 80} className="animate-pulse" />
                <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text pb-[0.12em] text-center text-4xl font-extrabold tracking-tighter text-transparent sm:text-left sm:text-6xl">Geo BingBong</h1>
            </div>

            <div className="glass animate-fade-in-up flex w-full max-w-md flex-col gap-3 rounded-3xl p-4 md:gap-6 md:p-8" style={{ animationDelay: '0.08s' }}>
                {/* PLAYER NAME INPUT */}
                <div>
                    {nameLocked ? (
                        <span className="mb-2 block text-sm font-bold tracking-wide text-slate-300 uppercase">{t('home.yourName')}</span>
                    ) : (
                        <button type="button" className="mb-2 block text-sm font-bold tracking-wide text-slate-300 uppercase transition-colors hover:text-fuchsia-300" onClick={() => setShowBadNames(!showBadNames)}>
                            {showBadNames ? t('home.yourBadassName') : t('home.yourName')}
                        </button>
                    )}
                    <input type="text" readOnly={nameLocked} placeholder={t('home.namePlaceholder')} className={`glass-inset w-full rounded-xl p-4 text-lg font-medium text-white placeholder:text-slate-500 transition-shadow focus:shadow-[inset_0_2px_6px_rgba(2,6,23,0.45),0_0_0_2px_rgba(129,140,248,0.7)] focus:outline-none ${nameLocked ? 'cursor-not-allowed opacity-80' : ''}`} value={nameValue} onChange={(e) => setPlayerName(e.target.value)} />
                    {nameLocked && (
                        <p className="mt-2 text-xs text-slate-400">
                            {account.twitchLocked ? t('home.nameManagedTwitch') : t('home.nameManagedAccount')}{' '}
                            <Link href="/account" className="font-medium text-indigo-300 underline-offset-2 hover:underline">
                                {t('home.manageInAccount')}
                            </Link>
                        </p>
                    )}
                </div>

                <div className="h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent md:my-2"></div>

                <button type="button" onClick={createGame} className="btn-sheen press w-full rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 py-4 font-bold tracking-wide text-white uppercase shadow-[0_16px_32px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]">
                    {t('home.createGame')}
                </button>

                <div className="text-center text-sm font-medium tracking-widest text-slate-400 uppercase">{t('home.or')}</div>

                <form onSubmit={joinGame} className="flex flex-col gap-3">
                    <input type="text" placeholder={t('home.lobbyIdPlaceholder')} className="glass-inset rounded-xl p-4 font-medium text-white placeholder:text-slate-500 transition-shadow focus:shadow-[inset_0_2px_6px_rgba(2,6,23,0.45),0_0_0_2px_rgba(34,211,238,0.6)] focus:outline-none" value={lobbyId} onChange={(e) => setLobbyId(e.target.value)} />
                    <button type="submit" className="glass btn-sheen press w-full rounded-xl py-3 font-bold tracking-wide text-white uppercase">
                        {t('home.joinGame')}
                    </button>
                </form>
            </div>

            {FEATURES.dailyChallenge && (
                <Link href="/daily" className="btn-sheen press mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 px-6 py-3 text-sm font-bold tracking-wide text-slate-900 uppercase shadow-[0_14px_28px_-10px_rgba(251,191,36,0.6),inset_0_1px_0_rgba(255,255,255,0.45)]">
                    {t('daily.play')}
                </Link>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link href="/community" className="glass press inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:text-white">
                    {t('home.community')}
                </Link>
                <Link href="/how-to-play" className="glass press inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:text-white">
                    {t('home.howToPlay')}
                </Link>
            </div>
        </section>
    );
}
