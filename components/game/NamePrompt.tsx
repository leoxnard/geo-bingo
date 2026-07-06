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
import GlassAmbience from '@/components/utils/GlassAmbience';
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
        <section className="relative min-h-dvh flex flex-col items-center justify-center overflow-hidden bg-slate-950 px-4 py-8">
            <GlassAmbience />
            <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-6 sm:mb-8">
                <GeoBingoLogo size={50} className="animate-pulse" />
                <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text pb-[0.12em] text-3xl sm:text-5xl font-extrabold tracking-tighter text-transparent text-center sm:text-left">Geo BingBong</h1>
            </div>

            <form onSubmit={submit} className="glass animate-fade-in-up p-6 md:p-8 rounded-3xl w-full max-w-md flex flex-col gap-4">
                <div>
                    <button type="button" className="text-sm text-slate-300 font-bold uppercase mb-2 block transition-colors hover:text-fuchsia-300" onClick={() => setShowBadNames(!showBadNames)}>
                        {showBadNames ? t('home.yourBadassName') : t('home.yourName')}
                    </button>
                    <input type="text" autoFocus placeholder={t('home.namePlaceholder')} className="glass-inset w-full p-4 rounded-xl text-white font-medium text-lg placeholder:text-slate-500 transition-shadow focus:shadow-[inset_0_2px_6px_rgba(2,6,23,0.45),0_0_0_2px_rgba(129,140,248,0.7)] focus:outline-none" value={name} onChange={(e) => setName(e.target.value)} />
                    <p className="mt-2 text-sm text-slate-500">{t('game.namePromptHint')}</p>
                </div>

                <button type="submit" className="btn-sheen press w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white font-bold py-4 rounded-xl tracking-wide uppercase shadow-[0_16px_32px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]">
                    {t('home.joinGame')}
                </button>
            </form>
        </section>
    );
}
