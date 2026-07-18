'use client';

/*
================================================================================
TWITCH GATE
================================================================================
Shown instead of the lobby when a host has enabled "Twitch required" and this
visitor has not linked a Twitch account. Offers a one-tap connect that returns
to this same game URL — on return the join proceeds automatically. A signed-in
visitor links Twitch to their existing account; a guest signs up with Twitch.
================================================================================
*/

import Link from 'next/link';
import { FaArrowLeft, FaTwitch } from 'react-icons/fa';

import TwitchButton from '@/components/community/TwitchButton';
import { useUser } from '@/components/community/useUser';
import GlassAmbience from '@/components/utils/GlassAmbience';
import { useT } from '@/lib/i18n/I18nProvider';
import { linkTwitch, signInWithTwitch } from '@/lib/twitch';

export default function TwitchGate() {
    const { t } = useT();
    const { user, loading } = useUser();

    const connect = () => {
        const redirectTo = typeof window !== 'undefined' ? window.location.href : undefined;
        return user ? linkTwitch(redirectTo) : signInWithTwitch(redirectTo);
    };

    return (
        <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-slate-950 px-4 text-white">
            <GlassAmbience />
            <div className="relative flex w-full max-w-md flex-col gap-5 rounded-3xl glass p-8">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9146ff]/20 text-2xl text-[#9146ff]">
                    <FaTwitch />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-white">{t('twitch.gateTitle')}</h1>
                    <p className="mt-1 text-sm text-slate-400">{t('twitch.gateDesc')}</p>
                </div>
                {!loading && <TwitchButton label={user ? t('twitch.connect') : t('twitch.continueWith')} onClick={connect} />}
                <Link href="/" className="glass press inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-300 hover:text-white">
                    <FaArrowLeft size={12} /> {t('twitch.gateBack')}
                </Link>
            </div>
        </main>
    );
}
