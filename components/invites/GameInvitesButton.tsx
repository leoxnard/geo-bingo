'use client';

/*
================================================================================
GAME INVITES BUTTON
================================================================================
The invitations button that sits next to the options gear (rendered inside
OptionsButton). It only appears while there are live "join my game" invitations —
so the invited player can still join after the toast is gone. Each row has a Join
button and a dismiss (×). State comes from GameInvitesProvider; expiry is handled
there, so an invite simply disappears from this list when its 2 minutes are up.
================================================================================
*/

import { useEffect, useRef, useState } from 'react';

import { FaEnvelope, FaGamepad, FaTimes } from 'react-icons/fa';

import { useGameInvites } from '@/components/invites/GameInvitesProvider';
import { useT } from '@/lib/i18n/I18nProvider';

export default function GameInvitesButton() {
    const { t } = useT();
    const { invites, join, dismiss } = useGameInvites();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    // No invitations → the button (and any open panel) is absent entirely.
    if (invites.length === 0) return null;

    return (
        <div ref={ref} className="relative">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} aria-label={t('invites.title')} className="relative rounded-lg p-2 text-indigo-300 transition-colors hover:bg-slate-800/70 hover:text-white">
                <FaEnvelope size={18} />
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold leading-none text-white">{invites.length > 9 ? '9+' : invites.length}</span>
            </button>

            <div role="dialog" aria-label={t('invites.title')} hidden={!open} className="glass-dark absolute right-0 mt-2 w-72 rounded-xl p-3">
                <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t('invites.title')}</p>
                <ul className="flex flex-col gap-2">
                    {invites.map((inv) => (
                        <li key={inv.id} className="glass-inset flex items-center gap-2 rounded-xl p-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300">
                                <FaGamepad size={13} />
                            </div>
                            <p className="min-w-0 flex-1 text-xs text-slate-300">
                                <span className="font-bold text-white">{inv.inviter_name}</span> {t('invites.invitedYouShort')}
                            </p>
                            <button type="button" onClick={() => join(inv)} className="press shrink-0 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1.5 text-xs font-bold uppercase text-white shadow-[0_8px_16px_-6px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]">
                                {t('invites.join')}
                            </button>
                            <button type="button" onClick={() => dismiss(inv.id)} aria-label={t('invites.dismiss')} className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-white">
                                <FaTimes size={12} />
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
