'use client';

/*
================================================================================
INVITE FRIENDS BUTTON
================================================================================
Sits next to the lobby's "Invite Friends" heading. Opens a small picker of the
signed-in player's friends; tapping one sends them a game invitation for THIS
lobby (send_game_invitation). The friend receives it in realtime — a toast with a
Join button plus the invitations button next to the options gear — anywhere in the
app. Signed out → a nudge to /account; no friends yet → a hint.
================================================================================
*/

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import toast from 'react-hot-toast';
import { FaUserFriends } from 'react-icons/fa';

import { useUser } from '@/components/community/useUser';
import type { FriendWithStats } from '@/components/utils/types';
import { getFriendsWithStats } from '@/lib/friends';
import { useT } from '@/lib/i18n/I18nProvider';
import { sendGameInvitation } from '@/lib/invites';
import { supabase } from '@/lib/supabase';

export default function InviteFriendsButton({ gameId }: { gameId: string }) {
    const { t } = useT();
    const { user } = useUser();
    const [open, setOpen] = useState(false);
    const [friends, setFriends] = useState<FriendWithStats[] | null>(null);
    const [invited, setInvited] = useState<Set<string>>(new Set());
    const [inLobby, setInLobby] = useState<Set<string>>(new Set());
    const [busyId, setBusyId] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    // On open (signed in): load the friend list once, and refresh who's already
    // in the lobby so those friends can't be re-invited.
    useEffect(() => {
        if (!open || !user) return;
        let alive = true;
        if (friends === null) {
            getFriendsWithStats()
                .then((f) => alive && setFriends(f))
                .catch(() => alive && setFriends([]));
        }
        supabase
            .from('players')
            .select('account_id')
            .eq('game_id', gameId)
            .then(({ data }) => {
                if (alive) setInLobby(new Set((data ?? []).map((r) => r.account_id as string | null).filter((id): id is string => !!id)));
            });
        return () => {
            alive = false;
        };
    }, [open, user, friends, gameId]);

    const invite = async (friend: FriendWithStats) => {
        if (busyId || invited.has(friend.id)) return;
        setBusyId(friend.id);
        try {
            const res = await sendGameInvitation(gameId, friend.id);
            if (res.success) {
                setInvited((prev) => new Set(prev).add(friend.id));
                toast.success(t('invites.sent', { name: res.name ?? friend.name }));
            } else if (res.error === 'NOT_FRIENDS') {
                toast.error(t('invites.notFriends'));
            } else {
                toast.error(t('invites.sendError'));
            }
        } catch {
            toast.error(t('invites.sendError'));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div ref={ref} className="relative">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} title={t('invites.inviteFriendTitle')} className="glass press rounded-md p-2 text-slate-400 hover:text-slate-200">
                <FaUserFriends />
            </button>

            <div role="dialog" aria-label={t('invites.pickFriend')} hidden={!open} className="glass-dark absolute right-0 z-20 mt-2 w-64 rounded-xl p-3 text-left">
                <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t('invites.pickFriend')}</p>
                {!user ? (
                    <Link href="/account" className="block glass-inset rounded-lg px-3 py-2 text-center text-xs font-medium text-indigo-300 transition-colors hover:text-indigo-200">
                        {t('invites.signInToInvite')}
                    </Link>
                ) : friends === null ? (
                    <div className="h-10 animate-pulse rounded-lg bg-slate-700/50" />
                ) : friends.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-400">{t('invites.noFriends')}</p>
                ) : (
                    <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                        {friends.map((f) => {
                            const here = inLobby.has(f.id);
                            const done = invited.has(f.id);
                            return (
                                <li key={f.id} className="flex items-center gap-2 glass-inset rounded-lg p-1.5">
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold uppercase text-indigo-300">{f.name.charAt(0)}</div>
                                    <span className="min-w-0 flex-1 truncate text-sm text-white">{f.name}</span>
                                    <button type="button" onClick={() => invite(f)} disabled={here || done || busyId === f.id} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold uppercase transition-colors ${here ? 'bg-white/10 text-slate-400' : done ? 'bg-emerald-600/20 text-emerald-400' : 'press bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_8px_16px_-6px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] disabled:opacity-50'}`}>
                                        {here ? t('invites.inLobby') : done ? t('invites.invited') : busyId === f.id ? '…' : t('invites.invite')}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
