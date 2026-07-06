'use client';

/*
================================================================================
AUTH GATE
================================================================================
Passwordless (email OTP) sign-in panel. Shown only when a logged-out user tries
to submit a community preset. When a user is present it simply renders its
children. Voting and browsing never mount this — they use the device id instead.
================================================================================
*/

import { useState } from 'react';

import { useT } from '@/lib/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';

import { useUser } from './useUser';

export default function AuthGate({ children }: { children: React.ReactNode }) {
    const { t } = useT();
    const { user, loading } = useUser();

    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [stage, setStage] = useState<'email' | 'code'>('email');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (loading) return <p className="text-slate-400 text-sm">{t('common.loading')}</p>;
    if (user) return <>{children}</>;

    const sendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
        setBusy(false);
        if (error) setError(t('community.signInError'));
        else setStage('code');
    };

    const verify = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
        setBusy(false);
        if (error) setError(t('community.signInError'));
        // On success the onAuthStateChange listener in useUser flips `user`,
        // which re-renders this component to show {children}.
    };

    return (
        <div className="glass rounded-2xl p-6 flex flex-col gap-4 max-w-md">
            <div>
                <h2 className="text-xl font-bold text-indigo-400">{t('community.signInTitle')}</h2>
                <p className="text-sm text-slate-400 mt-1">{t('community.signInDesc')}</p>
            </div>

            {stage === 'email' ? (
                <form onSubmit={sendCode} className="flex flex-col gap-3">
                    <input type="email" required placeholder={t('community.emailPlaceholder')} className="w-full p-3 rounded-xl glass-inset focus:!border-indigo-400 text-white outline-none" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <button type="submit" disabled={busy} className="btn-sheen press bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold py-3 rounded-xl transition-all uppercase disabled:opacity-50">
                        {busy ? t('common.loading') : t('community.sendCode')}
                    </button>
                </form>
            ) : (
                <form onSubmit={verify} className="flex flex-col gap-3">
                    <p className="text-xs text-slate-400">{t('community.codeSent', { email })}</p>
                    <input inputMode="numeric" required placeholder={t('community.codePlaceholder')} className="w-full p-3 rounded-xl glass-inset focus:!border-indigo-400 text-white outline-none tracking-widest text-center" value={code} onChange={(e) => setCode(e.target.value)} />
                    <button type="submit" disabled={busy} className="btn-sheen press bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold py-3 rounded-xl transition-all uppercase disabled:opacity-50">
                        {busy ? t('common.loading') : t('community.verify')}
                    </button>
                </form>
            )}

            {error && <p className="text-red-500 text-xs font-medium">{error}</p>}
        </div>
    );
}
