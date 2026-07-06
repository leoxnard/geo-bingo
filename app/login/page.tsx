'use client';

/*
================================================================================
LOGIN PAGE
================================================================================
User authentication interface for the Geo Bingo application.
Provides username/password input and authentication handling.
Features error display and form validation functionality.
================================================================================
*/

import { useState } from 'react';

import GlassAmbience from '@/components/utils/GlassAmbience';
import { useT } from '@/lib/i18n/I18nProvider';

import { authenticate } from './actions';

export default function LoginPage() {
    const { t } = useT();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(false);

        const success = await authenticate(username, password);

        if (success) {
            window.location.href = '/';
        } else {
            setError(true);
            setIsLoading(false);
        }
    };

    return (
        <main className="relative flex min-h-screen flex-col items-center justify-start sm:justify-center overflow-hidden px-4 py-10 sm:px-8 sm:py-16 lg:p-24 bg-slate-950 text-white">
            <GlassAmbience />
            <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-8 sm:mb-12">
                <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text pb-[0.12em] text-3xl sm:text-6xl font-extrabold text-transparent tracking-tighter uppercase text-center sm:text-left">{t('login.title')}</h1>
            </div>

            <div className="glass p-6 sm:p-8 rounded-3xl w-full max-w-md flex flex-col gap-4">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        <label className="text-xs text-slate-300 font-bold uppercase mb-1 block">{t('login.username')}</label>
                        <input type="text" placeholder={t('login.username')} className="glass-inset w-full p-3 rounded-xl text-white placeholder:text-slate-500 outline-none transition-shadow focus:shadow-[inset_0_2px_6px_rgba(2,6,23,0.45),0_0_0_2px_rgba(129,140,248,0.7)]" value={username} onChange={(e) => setUsername(e.target.value)} />
                    </div>

                    <div>
                        <label className="text-xs text-slate-300 font-bold uppercase mb-1 block">{t('login.password')}</label>
                        <input type="password" placeholder={t('login.password')} className={`glass-inset w-full p-3 rounded-xl text-white placeholder:text-slate-500 outline-none transition-shadow focus:shadow-[inset_0_2px_6px_rgba(2,6,23,0.45),0_0_0_2px_rgba(129,140,248,0.7)] ${error ? '!border-red-500' : ''}`} value={password} onChange={(e) => setPassword(e.target.value)} />
                    </div>

                    {error && <p className="text-red-500 text-xs font-medium text-center">{t('login.failed')}</p>}

                    <button type="submit" disabled={isLoading} className="btn-sheen press w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white font-bold py-4 rounded-xl uppercase mt-2 shadow-[0_16px_32px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)] disabled:opacity-50">
                        {isLoading ? t('login.checking') : t('login.unlock')}
                    </button>
                </form>
            </div>
        </main>
    );
}
