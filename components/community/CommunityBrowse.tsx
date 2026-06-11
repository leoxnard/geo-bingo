'use client';

/*
================================================================================
COMMUNITY BROWSE
================================================================================
The interactive community-presets list: sort tabs, optimistic device-id voting,
and links into the builder (/community/create). Authoring requires an account;
everything here works logged out. Signed-in users get a name chip (with an
account-wide rename) plus edit/delete on their own presets.
================================================================================
*/

import { useCallback, useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaPen, FaPlus, FaSignOutAlt, FaUserCircle } from 'react-icons/fa';

import type { CommunityPreset } from '@/components/utils/types';
import { getMyVotes, getPreset, listPresets, votePreset, deletePreset, renameAuthor, type PresetSort } from '@/lib/community';
import { useT } from '@/lib/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';

import AuthGate from './AuthGate';
import PresetCard from './PresetCard';
import { displayNameFor, useUser } from './useUser';

const SORTS: { key: PresetSort; labelKey: string }[] = [
    { key: 'top', labelKey: 'community.sortTop' },
    { key: 'new', labelKey: 'community.sortNew' },
];

export default function CommunityBrowse() {
    const { t } = useT();
    const { user, loading: userLoading } = useUser();

    // Share-link deep link: /community?preset=<id> pins that preset to the top
    // (fetching it if absent), highlights it and scrolls it into view once.
    const sharedId = useSearchParams().get('preset');
    const scrolledToSharedRef = useRef(false);

    const [presets, setPresets] = useState<CommunityPreset[]>([]);
    const [myVotes, setMyVotes] = useState<Record<string, number>>({});
    const [sort, setSort] = useState<PresetSort>('top');
    const [loading, setLoading] = useState(true);

    // Auth + account-name controls.
    const [showAuth, setShowAuth] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [savingName, setSavingName] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rows, votes] = await Promise.all([listPresets(sort), getMyVotes()]);
            let list = rows;
            if (sharedId) {
                const inList = rows.find((p) => p.id === sharedId);
                if (inList) {
                    // Pin the shared preset to the top so the recipient sees it first.
                    list = [inList, ...rows.filter((p) => p.id !== sharedId)];
                } else {
                    const shared = await getPreset(sharedId);
                    if (shared && shared.status === 'published') list = [shared, ...rows];
                }
            }
            setPresets(list);
            setMyVotes(votes);
        } catch {
            toast.error(t('community.loadError'));
        } finally {
            setLoading(false);
        }
    }, [sort, t, sharedId]);

    useEffect(() => {
        load();
    }, [load]);

    // Scroll the shared preset into view once it has rendered.
    useEffect(() => {
        if (loading || !sharedId || scrolledToSharedRef.current) return;
        const el = document.getElementById(`preset-${sharedId}`);
        if (el) {
            scrolledToSharedRef.current = true;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [loading, sharedId, presets]);

    const handleVote = async (preset: CommunityPreset, value: 1 | -1) => {
        try {
            const res = await votePreset(preset.id, value);
            if (!res.success) return;
            setMyVotes((prev) => ({ ...prev, [preset.id]: res.my_vote }));
            setPresets((prev) => prev.map((p) => (p.id === preset.id ? { ...p, upvotes: res.upvotes, downvotes: res.downvotes, score: res.upvotes - res.downvotes } : p)));
        } catch {
            toast.error(t('community.voteError'));
        }
    };

    const handleDelete = async (preset: CommunityPreset) => {
        if (!window.confirm(t('community.deleteConfirm'))) return;
        try {
            const res = await deletePreset(preset.id);
            if (res.success) {
                setPresets((prev) => prev.filter((p) => p.id !== preset.id));
                toast.success(t('community.deleted'));
            }
        } catch {
            toast.error(t('community.deleteError'));
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    const openRename = () => {
        setRenameValue(displayNameFor(user));
        setRenaming(true);
    };

    const saveRename = async () => {
        const next = renameValue.trim();
        if (!next) return;
        setSavingName(true);
        try {
            await renameAuthor(next);
            setRenaming(false);
            toast.success(t('community.nameUpdated'));
            // Re-pull so every card of theirs shows the new author name.
            load();
        } catch {
            toast.error(t('community.nameUpdateError'));
        } finally {
            setSavingName(false);
        }
    };

    return (
        <main className="min-h-dvh bg-slate-900 text-white">
            <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Link href="/" className="text-slate-400 hover:text-white" aria-label={t('landing.backHome')}>
                            <FaArrowLeft />
                        </Link>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-indigo-400">{t('community.title')}</h1>
                            <p className="text-sm text-slate-400">{t('community.subtitle')}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Auth control */}
                        {!userLoading &&
                            (user ? (
                                <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-xl pl-3 pr-1.5 py-1.5">
                                    <FaUserCircle className="text-slate-400 shrink-0" />
                                    <span className="text-sm text-slate-200 max-w-[9rem] truncate">{displayNameFor(user)}</span>
                                    <button type="button" onClick={openRename} aria-label={t('community.renameName')} className="text-slate-500 hover:text-indigo-400 p-1.5">
                                        <FaPen size={12} />
                                    </button>
                                    <button type="button" onClick={signOut} aria-label={t('community.signOut')} title={t('community.signOut')} className="text-slate-500 hover:text-red-400 p-1.5">
                                        <FaSignOutAlt size={14} />
                                    </button>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setShowAuth(true)} className="bg-slate-800 border border-slate-700 hover:border-slate-500 text-white font-bold py-2.5 px-5 rounded-xl uppercase text-sm transition-colors">
                                    {t('community.signIn')}
                                </button>
                            ))}

                        <Link href="/community/create" className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-xl uppercase transition-colors">
                            <FaPlus size={12} /> {t('community.createCta')}
                        </Link>
                    </div>
                </div>

                <div className="flex gap-2">
                    {SORTS.map((s) => (
                        <button key={s.key} type="button" onClick={() => setSort(s.key)} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${sort === s.key ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                            {t(s.labelKey as Parameters<typeof t>[0])}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t('common.loading')}>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="rounded-2xl border border-slate-700 bg-slate-800/60 overflow-hidden animate-pulse">
                                <div className="aspect-[2/1] bg-slate-700/40" />
                                <div className="p-4 flex flex-col gap-3">
                                    <div className="h-3 w-1/3 rounded bg-slate-700/60" />
                                    <div className="h-3 w-2/3 rounded bg-slate-700/40" />
                                    <div className="h-8 w-full rounded-lg bg-slate-700/30" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : presets.length === 0 ? (
                    <div className="py-16 text-center flex flex-col items-center gap-4">
                        <p className="text-slate-400">{t('community.empty')}</p>
                        <Link href="/community/create" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-xl uppercase transition-colors">
                            {t('community.createCta')}
                        </Link>
                    </div>
                ) : (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {presets.map((preset, index) => (
                            <PresetCard key={preset.id} preset={preset} myVote={myVotes[preset.id] ?? 0} isOwner={!!user && user.id === preset.author_id} onVote={(value) => handleVote(preset, value)} onDelete={() => handleDelete(preset)} onChanged={load} highlighted={preset.id === sharedId} style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }} />
                        ))}
                    </div>
                )}
            </div>

            {/* Sign-in modal */}
            {showAuth && (
                <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAuth(false)}>
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <AuthGate>
                            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 flex flex-col gap-3 max-w-md">
                                <p className="text-slate-200">{t('community.signedIn')}</p>
                                <button type="button" onClick={() => setShowAuth(false)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl uppercase transition-all">
                                    {t('community.done')}
                                </button>
                            </div>
                        </AuthGate>
                    </div>
                </div>
            )}

            {/* Account-wide rename modal */}
            {renaming && (
                <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={() => setRenaming(false)}>
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 w-full max-w-md flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                        <div>
                            <h3 className="font-bold text-white">{t('community.renameName')}</h3>
                            <p className="text-xs text-slate-400 mt-1">{t('community.renameNameHelp')}</p>
                        </div>
                        <input autoFocus type="text" value={renameValue} maxLength={40} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveRename()} className="w-full p-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-indigo-500 text-white outline-none" />
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setRenaming(false)} className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold uppercase text-sm">
                                {t('common.cancel')}
                            </button>
                            <button type="button" onClick={saveRename} disabled={!renameValue.trim() || savingName} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase text-sm disabled:opacity-50">
                                {savingName ? t('common.loading') : t('community.rename')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
