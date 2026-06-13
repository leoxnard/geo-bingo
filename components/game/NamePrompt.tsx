'use client';

/*
================================================================================
NAME PROMPT
================================================================================
Shown when a player opens a game link (/game/<id>) without a saved username —
i.e. they never passed through the home screen where the name is normally set.
Lets them type a name before joining; leaving it blank generates a random one
(matching the home screen's behaviour). The resolved name is handed back via
onSubmit, which gates the rest of the game-room initialization.
================================================================================
*/

import { useState } from 'react';

import { GeoBingoLogo } from '@/components/utils/Elements';
import { useT } from '@/lib/i18n/I18nProvider';

import { adjectives, badAdjectives, animals } from '../../lib/names';

const randomName = (bad: boolean) => {
    const pool = bad ? badAdjectives : adjectives;
    return `${pool[Math.floor(Math.random() * pool.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
};

export default function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
    const { t } = useT();
    const [name, setName] = useState('');
    const [showBadNames, setShowBadNames] = useState(false);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(name.trim() || randomName(showBadNames));
    };

    return (
        <section className="min-h-dvh flex flex-col items-center justify-center bg-slate-900 px-4 py-8">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-6 sm:mb-8">
                <GeoBingoLogo size={50} className="animate-pulse" />
                <h1 className="text-3xl sm:text-5xl font-bold text-indigo-400 tracking-tighter text-center sm:text-left">Geo BingBong</h1>
            </div>

            <form onSubmit={submit} className="animate-fade-in-up bg-slate-800 p-6 md:p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md flex flex-col gap-4">
                <div>
                    <button type="button" className="text-sm text-slate-400 font-bold uppercase mb-2 block" onClick={() => setShowBadNames(!showBadNames)}>
                        {showBadNames ? t('home.yourBadassName') : t('home.yourName')}
                    </button>
                    <input type="text" autoFocus placeholder={t('home.namePlaceholder')} className="w-full p-4 rounded-xl bg-slate-900 border border-slate-600 focus:outline-none focus:border-indigo-500 text-white font-medium text-lg" value={name} onChange={(e) => setName(e.target.value)} />
                    <p className="mt-2 text-sm text-slate-500">{t('game.namePromptHint')}</p>
                </div>

                <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all tracking-wide uppercase">
                    {t('home.joinGame')}
                </button>
            </form>
        </section>
    );
}
