'use client';

/*
================================================================================
FRIENDS LIST
================================================================================
The friends section of the profile: incoming friend requests (accept/decline),
two ways to add a friend (copy an invite link, or send a request by username),
and the signed-in player's friends with their lifetime stats. Adding never links
instantly — it always creates a request the other player confirms. `refreshKey`
bumps to re-fetch after the profile applies an invite from a link.
================================================================================
*/

import { useEffect, useState } from 'react';

import toast from 'react-hot-toast';
import { FaCheck, FaGamepad, FaLink, FaTimes, FaTrophy, FaUserPlus, FaUserSlash } from 'react-icons/fa';

import type { FriendRequest, FriendWithStats } from '@/components/utils/types';
import { acceptFriendRequest, declineFriendRequest, friendInviteLink, getFriendsWithStats, getIncomingRequests, removeFriend, sendFriendRequestByUsername } from '@/lib/friends';
import { useT } from '@/lib/i18n/I18nProvider';

export default function FriendsList({ accountId, refreshKey = 0 }: { accountId: string; refreshKey?: number }) {
    const { t } = useT();
    const [friends, setFriends] = useState<FriendWithStats[] | null>(null);
    const [requests, setRequests] = useState<FriendRequest[]>([]);
    const [username, setUsername] = useState('');
    const [sending, setSending] = useState(false);
    const [tick, setTick] = useState(0); // local re-fetch trigger

    useEffect(() => {
        let alive = true;
        getFriendsWithStats()
            .then((f) => alive && setFriends(f))
            .catch(() => alive && setFriends([]));
        getIncomingRequests()
            .then((r) => alive && setRequests(r))
            .catch(() => alive && setRequests([]));
        return () => {
            alive = false;
        };
    }, [refreshKey, tick]);

    const inviteLink = friendInviteLink(accountId);

    // Copy the bare link (not navigator.share, which can glue the invite text onto
    // the URL and corrupt the ?add= param for the recipient).
    const copyInvite = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink);
            toast.success(t('friends.linkCopied'));
        } catch {
            toast.error(t('friends.copyError'));
        }
    };

    const sendByUsername = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = username.trim();
        if (!name || sending) return;
        setSending(true);
        try {
            const res = await sendFriendRequestByUsername(name);
            if (res.success && res.status === 'accepted') {
                toast.success(t('friends.accepted', { name: res.name ?? name }));
                setUsername('');
                setTick((k) => k + 1);
            } else if (res.success) {
                toast.success(t('friends.requestSent', { name: res.name ?? name }));
                setUsername('');
            } else if (res.error === 'USER_NOT_FOUND') {
                toast.error(t('friends.userNotFound'));
            } else if (res.error === 'ALREADY_FRIENDS') {
                toast(t('friends.alreadyFriends'));
            } else if (res.error === 'INVALID') {
                toast.error(t('friends.cantAddSelf'));
            } else {
                toast.error(t('friends.addError'));
            }
        } catch {
            toast.error(t('friends.addError'));
        } finally {
            setSending(false);
        }
    };

    const accept = async (r: FriendRequest) => {
        try {
            const res = await acceptFriendRequest(r.id);
            if (res.success) {
                toast.success(t('friends.accepted', { name: res.name ?? r.name }));
                setTick((k) => k + 1);
            } else {
                toast.error(t('friends.addError'));
            }
        } catch {
            toast.error(t('friends.addError'));
        }
    };

    const decline = async (r: FriendRequest) => {
        setRequests((prev) => prev.filter((x) => x.id !== r.id));
        try {
            await declineFriendRequest(r.id);
        } catch {
            toast.error(t('friends.addError'));
            setTick((k) => k + 1); // restore the real state on failure
        }
    };

    const onRemove = async (friend: FriendWithStats) => {
        if (!window.confirm(t('friends.removeConfirm', { name: friend.name }))) return;
        try {
            await removeFriend(friend.id);
            setFriends((prev) => (prev ? prev.filter((f) => f.id !== friend.id) : prev));
        } catch {
            toast.error(t('friends.removeError'));
        }
    };

    return (
        <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-400">
                <FaUserPlus size={13} /> {t('friends.title')}
            </h2>

            {/* Incoming requests */}
            {requests.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('friends.requests')}</p>
                    {requests.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-bold uppercase text-indigo-300">{r.name.charAt(0)}</div>
                            <p className="min-w-0 flex-1 truncate font-bold text-white">{r.name}</p>
                            <button type="button" onClick={() => accept(r)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold uppercase text-white transition-colors hover:bg-emerald-500">
                                <FaCheck size={11} /> {t('friends.accept')}
                            </button>
                            <button type="button" onClick={() => decline(r)} aria-label={t('friends.decline')} className="rounded-lg bg-slate-700 p-2 text-slate-300 transition-colors hover:bg-slate-600 hover:text-white">
                                <FaTimes size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add a friend — copy the invite link, or request by username */}
            <div className="flex flex-col gap-3 rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-600/15 to-slate-800 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-white">{t('friends.invite')}</p>
                        <p className="text-xs text-slate-400">{t('friends.inviteHint')}</p>
                    </div>
                    <button type="button" onClick={copyInvite} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-indigo-500">
                        <FaLink size={12} /> {t('friends.copyLink')}
                    </button>
                </div>

                <form onSubmit={sendByUsername} className="flex gap-2 border-t border-white/10 pt-3">
                    <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={30} placeholder={t('friends.usernamePlaceholder')} className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
                    <button type="submit" disabled={!username.trim() || sending} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-indigo-500 disabled:opacity-50">
                        <FaUserPlus size={12} /> {sending ? t('common.loading') : t('friends.sendRequest')}
                    </button>
                </form>
            </div>

            {/* Friend list */}
            {friends === null ? (
                <div className="h-16 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/60" />
            ) : friends.length === 0 ? (
                <p className="rounded-2xl border border-slate-800 bg-slate-800/40 p-4 text-sm text-slate-400">{t('friends.none')}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {friends.map((f) => (
                        <li key={f.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-800/50 p-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-bold uppercase text-indigo-300">{f.name.charAt(0)}</div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-bold text-white">{f.name}</p>
                                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                                    <span className="inline-flex items-center gap-1">
                                        <FaGamepad size={10} /> {t('friends.gamesShort', { count: f.games_played })}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <FaTrophy className="text-amber-400" size={10} /> {t('friends.winsShort', { count: f.games_won })}
                                    </span>
                                    {f.daily_completed > 0 && <span className="text-slate-500">{t('friends.dailyShort', { count: f.daily_completed })}</span>}
                                </div>
                            </div>
                            <button type="button" onClick={() => onRemove(f)} aria-label={t('friends.remove')} className="shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-red-400">
                                <FaUserSlash size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
