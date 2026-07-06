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
import { FaArrowLeft, FaPlus } from 'react-icons/fa';

import GlassAmbience from '@/components/utils/GlassAmbience';
import type { CommunityPreset } from '@/components/utils/types';
import { getMyVotes, getPreset, listPresets, votePreset, deletePreset, type PresetSort } from '@/lib/community';
import { useT } from '@/lib/i18n/I18nProvider';
import OptionsButton from '@/lib/settings/OptionsButton';

import PresetCard from './PresetCard';
import { useUser } from './useUser';

const SORTS: { key: PresetSort; labelKey: string }[] = [
    { key: 'top', labelKey: 'community.sortTop' },
    { key: 'new', labelKey: 'community.sortNew' },
];

export default function CommunityBrowse() {
    const { t } = useT();
    const { user } = useUser();

    // Share-link deep link: /community?preset=<id> pins that preset to the top
    // (fetching it if absent), highlights it and scrolls it into view once.
    const sharedId = useSearchParams().get('preset');
    const scrolledToSharedRef = useRef(false);

    const [presets, setPresets] = useState<CommunityPreset[]>([]);
    const [myVotes, setMyVotes] = useState<Record<string, number>>({});
    const [sort, setSort] = useState<PresetSort>('top');
    const [loading, setLoading] = useState(true);

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

    return (
        <main className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
            <GlassAmbience />
            <OptionsButton onRenamed={load} />
            <div className="relative max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-4 pr-12">
                    <div className="flex items-center gap-3">
                        <Link href="/" className="glass press flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:text-white" aria-label={t('landing.backHome')}>
                            <FaArrowLeft />
                        </Link>
                        <div>
                            <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-2xl sm:text-3xl font-extrabold tracking-tight text-transparent">{t('community.title')}</h1>
                            <p className="text-sm text-slate-400">{t('community.subtitle')}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link href="/community/create" className="btn-sheen press flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 py-2.5 px-5 font-bold uppercase text-white shadow-[0_14px_28px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]">
                            <FaPlus size={12} /> {t('community.createCta')}
                        </Link>
                    </div>
                </div>

                <div className="flex gap-2">
                    {SORTS.map((s) => (
                        <button key={s.key} type="button" onClick={() => setSort(s.key)} className={`press px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${sort === s.key ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]' : 'glass text-slate-300 hover:text-white'}`}>
                            {t(s.labelKey as Parameters<typeof t>[0])}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t('common.loading')}>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="glass rounded-2xl overflow-hidden animate-pulse">
                                <div className="aspect-[2/1] bg-white/5" />
                                <div className="p-4 flex flex-col gap-3">
                                    <div className="h-3 w-1/3 rounded bg-white/10" />
                                    <div className="h-3 w-2/3 rounded bg-white/5" />
                                    <div className="h-8 w-full rounded-lg bg-white/5" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : presets.length === 0 ? (
                    <div className="py-16 text-center flex flex-col items-center gap-4">
                        <p className="text-slate-400">{t('community.empty')}</p>
                        <Link href="/community/create" className="btn-sheen press rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 py-2.5 px-5 font-bold uppercase text-white shadow-[0_14px_28px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]">
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
        </main>
    );
}
