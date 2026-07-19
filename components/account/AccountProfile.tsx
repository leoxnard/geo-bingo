'use client';

/*
================================================================================
ACCOUNT / PROFILE
================================================================================
The player's personal profile. Signed out → a sign-in nudge (stats and friends
need an account). Signed in → lifetime multiplayer stats, Daily Challenge
counters, recent games, and the friends list.

Also the landing point for one-tap friend invites: /account?add=<accountId>.
When a signed-in visitor arrives with that param we add the friendship and strip
the param; a logged-out visitor sees a banner and the invite is applied the
moment they sign in.
================================================================================
*/

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaCheck, FaCrown, FaGamepad, FaMapMarkedAlt, FaPen, FaPercentage, FaSignOutAlt, FaTrophy, FaTwitch } from 'react-icons/fa';

import AuthGate from '@/components/community/AuthGate';
import TwitchButton from '@/components/community/TwitchButton';
import { useUser, displayNameFor } from '@/components/community/useUser';
import DailyStats from '@/components/daily/DailyStats';
import GlassAmbience from '@/components/utils/GlassAmbience';
import type { AccountStats, GameHistoryEntry } from '@/components/utils/types';
import { getMyAccountStats, getMyGameHistory } from '@/lib/account';
import { deleteAccount, renameAuthor } from '@/lib/community';
import { FEATURES } from '@/lib/featureFlags';
import { sendFriendRequest } from '@/lib/friends';
import { useT } from '@/lib/i18n/I18nProvider';
import OptionsButton from '@/lib/settings/OptionsButton';
import { supabase } from '@/lib/supabase';
import { getTwitchLogin, linkTwitch, unlinkTwitch } from '@/lib/twitch';

import FriendsList from './FriendsList';

export default function AccountProfile() {
    const { t } = useT();
    const { user, loading } = useUser();
    const router = useRouter();
    const params = useSearchParams();
    // The invite param should be a bare account UUID, but a share sheet can append
    // the invite text to the URL (…?add=<uuid> Add me on…). Pull out just the UUID
    // so a mangled link still resolves instead of 400-ing on the uuid cast.
    const addFriendId = params.get('add')?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;

    const [stats, setStats] = useState<AccountStats | null>(null);
    const [history, setHistory] = useState<GameHistoryEntry[] | null>(null);
    const [friendsRefresh, setFriendsRefresh] = useState(0);
    const [twitchLogin, setTwitchLogin] = useState<string | null>(null);
    const [twitchBusy, setTwitchBusy] = useState(false);
    const processedAddRef = useRef<string | null>(null);
    const syncedTwitchNameRef = useRef<string | null>(null);

    // Account management (merged from the former options-menu profile overlay).
    const [renaming, setRenaming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [busy, setBusy] = useState(false);

    const openRename = () => {
        setNameInput(displayNameFor(user));
        setRenaming(true);
    };

    const saveRename = async () => {
        const next = nameInput.trim();
        if (!next) return;
        setBusy(true);
        try {
            await renameAuthor(next);
            setRenaming(false);
            toast.success(t('community.nameUpdated'));
        } catch (e) {
            const code = e instanceof Error ? e.message : '';
            if (code === 'TAKEN') toast.error(t('account.usernameTaken'));
            else if (code === 'INVALID') toast.error(t('account.usernameInvalid'));
            else toast.error(t('community.nameUpdateError'));
        } finally {
            setBusy(false);
        }
    };

    const disconnectTwitch = async () => {
        setTwitchBusy(true);
        try {
            const { error } = await unlinkTwitch();
            if (error === 'NEEDS_OTHER_IDENTITY') {
                toast.error(t('twitch.needOtherLogin'));
                return;
            }
            if (error) {
                toast.error(t('twitch.disconnectError'));
                return;
            }
            setTwitchLogin(null);
            syncedTwitchNameRef.current = null;
            toast.success(t('twitch.disconnected'));
        } finally {
            setTwitchBusy(false);
        }
    };

    const signOut = () => supabase.auth.signOut();

    const confirmDelete = async () => {
        setBusy(true);
        try {
            await deleteAccount();
            setDeleting(false);
            toast.success(t('community.accountDeleted'));
        } catch {
            toast.error(t('community.deleteAccountError'));
        } finally {
            setBusy(false);
        }
    };

    // Load stats + history once signed in. (No reset when signed out — the
    // signed-out view is rendered off `user`, so stale stats are never shown.)
    useEffect(() => {
        if (!user) return;
        let alive = true;
        getMyAccountStats()
            .then((s) => alive && setStats(s))
            .catch(() => alive && setStats(null));
        getMyGameHistory()
            .then((h) => alive && setHistory(h))
            .catch(() => alive && setHistory([]));
        if (FEATURES.twitchAuth) {
            getTwitchLogin()
                .then((l) => alive && setTwitchLogin(l))
                .catch(() => alive && setTwitchLogin(null));
        }
        return () => {
            alive = false;
        };
    }, [user]);

    // Apply an incoming friend invite (?add=<id>) as soon as we have a user.
    useEffect(() => {
        if (!addFriendId || !user) return;
        if (processedAddRef.current === addFriendId) return;
        processedAddRef.current = addFriendId;

        const clearParam = () => router.replace('/account');
        if (addFriendId === user.id) {
            toast(t('friends.ownInvite'));
            clearParam(); // their own invite link — nothing to add
            return;
        }
        // Opening someone's invite link sends THEM a request to accept/decline.
        sendFriendRequest(addFriendId)
            .then((res) => {
                if (res.success && res.status === 'accepted') {
                    toast.success(t('friends.accepted', { name: res.name ?? '' }));
                } else if (res.success) {
                    toast.success(t('friends.requestSent', { name: res.name ?? '' }));
                } else if (res.error === 'ALREADY_FRIENDS') {
                    toast(t('friends.alreadyFriends'));
                } else {
                    toast.error(t('friends.addError'));
                }
                if (res.success) setFriendsRefresh((k) => k + 1);
            })
            .catch(() => toast.error(t('friends.addError')))
            .finally(clearParam);
    }, [addFriendId, user, router, t]);

    // Surface OAuth link failures that redirect back here. The common one is trying
    // to link a Twitch account already attached to a different geobingo account —
    // Supabase enforces one identity per account, we just translate the message.
    useEffect(() => {
        const desc = params.get('error_description') || params.get('error');
        if (!desc) return;
        toast.error(/already|linked|exist/i.test(desc) ? t('twitch.alreadyLinkedOther') : desc);
        router.replace('/account');
    }, [params, router, t]);

    // Keep the account-wide display name in sync with a linked Twitch handle so a
    // Twitch user's name is their Twitch login everywhere (presets, leaderboard),
    // not a stale email-derived name. Best-effort: a name collision (TAKEN) just
    // leaves the old name; the ref stops us re-attempting the same handle.
    useEffect(() => {
        if (!user || !twitchLogin) return;
        if (displayNameFor(user) === twitchLogin) return;
        if (syncedTwitchNameRef.current === twitchLogin) return;
        syncedTwitchNameRef.current = twitchLogin;
        renameAuthor(twitchLogin).catch(() => {});
    }, [user, twitchLogin]);

    const winRate = stats && stats.multiplayer_played > 0 ? `${Math.round((stats.multiplayer_won / stats.multiplayer_played) * 100)}%` : '—';

    return (
        <main className="relative min-h-dvh overflow-hidden bg-slate-950 px-4 py-8 text-white">
            <GlassAmbience />
            <OptionsButton />
            <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-6">
                <Link href="/" className="glass press inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-300 hover:text-white">
                    <FaArrowLeft size={12} /> {t('account.backHome')}
                </Link>

                {loading ? (
                    <div className="h-40 animate-pulse rounded-3xl glass" />
                ) : !user ? (
                    <div className="rounded-3xl glass p-6">
                        <h1 className="text-2xl font-black text-indigo-300">{t('account.signInTitle')}</h1>
                        <p className="mb-4 mt-1 text-sm text-slate-400">{t('account.signInPrompt')}</p>
                        {addFriendId && <p className="mb-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm font-medium text-indigo-200">{t('friends.pendingInvite')}</p>}
                        <AuthGate>
                            <p className="text-sm text-emerald-300">{t('community.signedIn')}</p>
                        </AuthGate>
                    </div>
                ) : (
                    <>
                        {/* Identity + account management (name edit, sign out, delete) */}
                        <header className="flex flex-col gap-4 glass rounded-3xl p-6">
                            <div className="flex items-center gap-4">
                                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-500/25 text-2xl font-black uppercase text-indigo-200">{displayNameFor(user).charAt(0)}</div>
                                <div className="min-w-0 flex-1">
                                    <h1 className="truncate text-2xl font-black text-white">{displayNameFor(user)}</h1>
                                    {user.email && <p className="truncate text-sm text-slate-400">{user.email}</p>}
                                </div>
                            </div>

                            {renaming ? (
                                <div className="flex flex-col gap-2">
                                    <p className="text-xs text-slate-400">{t('account.usernameHelp')}</p>
                                    <input autoFocus type="text" maxLength={40} value={nameInput} onChange={(e) => setNameInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveRename()} className="w-full rounded-xl glass-inset p-3 text-white outline-none focus:!border-indigo-400" />
                                    <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => setRenaming(false)} disabled={busy} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-slate-600 disabled:opacity-50">
                                            {t('common.cancel')}
                                        </button>
                                        <button type="button" onClick={saveRename} disabled={!nameInput.trim() || busy} className="press rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-indigo-500 disabled:opacity-50">
                                            {busy ? t('common.loading') : t('community.rename')}
                                        </button>
                                    </div>
                                </div>
                            ) : deleting ? (
                                <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                                    <h2 className="font-bold text-red-400">{t('community.deleteAccountTitle')}</h2>
                                    <p className="text-sm text-slate-400">{t('community.deleteAccountWarning')}</p>
                                    <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => setDeleting(false)} disabled={busy} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-slate-600 disabled:opacity-50">
                                            {t('common.cancel')}
                                        </button>
                                        <button type="button" onClick={confirmDelete} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-red-500 disabled:opacity-50">
                                            {busy ? t('common.loading') : t('community.deleteAccountCta')}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                    {!twitchLogin && (
                                        <button type="button" onClick={openRename} className="inline-flex items-center gap-2 rounded-xl glass px-4 py-2 text-sm font-bold text-white transition-colors hover:border-indigo-500">
                                            <FaPen size={12} /> {t('account.changeUsername')}
                                        </button>
                                    )}
                                    <button type="button" onClick={signOut} className="inline-flex items-center gap-2 rounded-xl glass px-4 py-2 text-sm font-bold text-white transition-colors hover:border-slate-400">
                                        <FaSignOutAlt size={12} /> {t('community.signOut')}
                                    </button>
                                    <button type="button" onClick={() => setDeleting(true)} className="ml-auto text-xs font-medium text-red-400/80 transition-colors hover:text-red-300">
                                        {t('community.deleteAccount')}
                                    </button>
                                </div>
                            )}

                            {/* Twitch connection */}
                            {FEATURES.twitchAuth && !renaming && !deleting && (
                                <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
                                    {twitchLogin ? (
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-wrap items-center gap-2.5 text-sm">
                                                <FaTwitch className="text-[#9146ff]" size={16} />
                                                <span className="font-bold text-white">{twitchLogin}</span>
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-300">
                                                    <FaCheck size={9} /> {t('twitch.connected')}
                                                </span>
                                                <button type="button" onClick={disconnectTwitch} disabled={twitchBusy} className="ml-auto text-xs font-medium text-red-400/80 transition-colors hover:text-red-300 disabled:opacity-50">
                                                    {twitchBusy ? t('common.loading') : t('twitch.disconnect')}
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-400">{t('twitch.nameManaged')}</p>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="text-xs text-slate-400">{t('twitch.connectHelp')}</p>
                                            <TwitchButton label={t('twitch.connect')} onClick={() => linkTwitch(`${window.location.origin}/account`)} />
                                        </>
                                    )}
                                </div>
                            )}
                        </header>

                        {/* Lifetime stat cards */}
                        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatCard icon={<FaGamepad />} value={stats ? stats.games_played : '—'} label={t('account.gamesPlayed')} tone="indigo" />
                            <StatCard icon={<FaCrown />} value={stats ? stats.games_won : '—'} label={t('account.wins')} tone="amber" />
                            <StatCard icon={<FaPercentage />} value={winRate} label={t('account.winRate')} tone="emerald" />
                            <StatCard icon={<FaMapMarkedAlt />} value={stats ? stats.categories_found : '—'} label={t('account.categoriesFound')} tone="sky" />
                        </section>

                        {/* Daily Challenge counters (reused) */}
                        {FEATURES.dailyChallenge && (
                            <section className="flex flex-col gap-3">
                                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">{t('account.dailyChallenge')}</h2>
                                <DailyStats />
                            </section>
                        )}

                        {/* Recent games */}
                        <section className="flex flex-col gap-3">
                            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-400">
                                <FaTrophy className="text-amber-400" size={13} /> {t('account.recentGames')}
                            </h2>
                            {history === null ? (
                                <div className="h-20 animate-pulse rounded-2xl glass" />
                            ) : history.length === 0 ? (
                                <p className="rounded-2xl glass-inset p-4 text-sm text-slate-400">{t('account.noGames')}</p>
                            ) : (
                                <ul className="flex flex-col gap-2">
                                    {history.map((g) => (
                                        <GameRow key={g.id} g={g} />
                                    ))}
                                </ul>
                            )}
                        </section>

                        {/* Friends */}
                        <FriendsList accountId={user.id} refreshKey={friendsRefresh} />
                    </>
                )}
            </div>
        </main>
    );
}

const TONE: Record<string, string> = {
    indigo: 'text-indigo-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    sky: 'text-sky-300',
};

function StatCard({ icon, value, label, tone }: { icon: React.ReactNode; value: number | string; label: string; tone: keyof typeof TONE }) {
    return (
        <div className="flex flex-col items-center gap-1 rounded-2xl glass p-4 text-center">
            <span className={`text-lg ${TONE[tone]}`}>{icon}</span>
            <span className="text-2xl font-black text-white">{value}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
        </div>
    );
}

function GameRow({ g }: { g: GameHistoryEntry }) {
    const { t } = useT();
    const modeLabel = g.game_mode === 'bingo' ? t('settings.bingoGrid') : t('settings.classicList');
    const date = new Date(g.finished_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const solo = (g.player_count ?? 1) < 2;

    return (
        <li className="flex items-center gap-3 rounded-2xl glass-inset p-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${g.won ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700/60 text-slate-300'}`}>{g.won ? <FaCrown size={13} /> : `#${g.placement ?? '?'}`}</div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">
                    {modeLabel}
                    {g.team_mode === 'teams' && <span className="ml-2 text-xs font-medium text-slate-400">{t('account.teams')}</span>}
                </p>
                <p className="text-xs text-slate-400">
                    {date} · {solo ? t('account.solo') : t('account.placeOf', { place: g.placement ?? '?', count: g.player_count ?? '?' })}
                </p>
            </div>
            <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-indigo-300">{t('account.pointsShort', { score: g.score ?? 0 })}</p>
                <p className="text-xs text-slate-500">{t('account.foundShort', { count: g.categories_found ?? 0 })}</p>
            </div>
        </li>
    );
}
