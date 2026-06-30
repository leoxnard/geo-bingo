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

    const handleSaveName = () => {
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
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-6 sm:mb-8 hover">
                <GeoBingoLogo size={isNarrow ? 50 : 80} className="animate-pulse" />
                <h1 className="text-3xl sm:text-6xl font-bold text-indigo-400 tracking-tighter text-center sm:text-left">Geo BingBong</h1>
            </div>

            <div className="animate-fade-in-up bg-slate-800 p-4 md:p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md flex flex-col gap-3 md:gap-6">
                {/* PLAYER NAME INPUT */}
                <div>
                    <button type="button" className="text-sm text-slate-400 font-bold uppercase mb-2 block" onClick={() => setShowBadNames(!showBadNames)}>
                        {showBadNames ? t('home.yourBadassName') : t('home.yourName')}
                    </button>
                    <input type="text" placeholder={t('home.namePlaceholder')} className="w-full p-4 rounded-xl bg-slate-900 border border-slate-600 focus:outline-none focus:border-indigo-500 text-white font-medium text-lg" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
                </div>

                <div className="w-full h-px bg-slate-700 md:my-2"></div>

                <button type="button" onClick={createGame} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all tracking-wide uppercase">
                    {t('home.createGame')}
                </button>

                <div className="text-center text-slate-500 text-sm font-medium uppercase tracking-widest">{t('home.or')}</div>

                <form onSubmit={joinGame} className="flex flex-col gap-3">
                    <input type="text" placeholder={t('home.lobbyIdPlaceholder')} className="p-4 rounded-xl bg-slate-700 border border-slate-600 focus:outline-none focus:border-indigo-500 text-white font-medium" value={lobbyId} onChange={(e) => setLobbyId(e.target.value)} />
                    <button type="submit" className="w-full bg-slate-600 hover:bg-slate-500 text-white font-bold py-3 rounded-xl transition-all uppercase tracking-wide">
                        {t('home.joinGame')}
                    </button>
                </form>
            </div>

            {FEATURES.dailyChallenge && (
                <Link href="/daily" className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber-500 px-6 py-3 text-sm font-bold uppercase tracking-wide text-slate-900 shadow-lg transition-colors hover:bg-amber-400">
                    {t('daily.play')}
                </Link>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link href="/community" className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-indigo-500 hover:text-white">
                    {t('home.community')}
                </Link>
                <Link href="/how-to-play" className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-indigo-500 hover:text-white">
                    {t('home.howToPlay')}
                </Link>
            </div>
        </section>
    );
}
