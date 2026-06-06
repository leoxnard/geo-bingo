'use client';

/*
================================================================================
COMMUNITY BROWSE
================================================================================
The interactive community-presets list: sort tabs, optimistic device-id voting,
and links into the builder (/community/create). Authoring requires an account;
everything here works logged out.
================================================================================
*/

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaPlus } from 'react-icons/fa';

import type { CommunityPreset } from '@/components/utils/types';
import { getMyVotes, listPresets, votePreset, deletePreset, type PresetSort } from '@/lib/community';
import { useT } from '@/lib/i18n/I18nProvider';

import PresetCard from './PresetCard';
import { useUser } from './useUser';

const SORTS: { key: PresetSort; labelKey: string }[] = [
    { key: 'top', labelKey: 'community.sortTop' },
    { key: 'new', labelKey: 'community.sortNew' },
    { key: 'categories', labelKey: 'community.sortMost' },
];

export default function CommunityBrowse() {
    const { t } = useT();
    const { user } = useUser();

    const [presets, setPresets] = useState<CommunityPreset[]>([]);
    const [myVotes, setMyVotes] = useState<Record<string, number>>({});
    const [sort, setSort] = useState<PresetSort>('top');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rows, votes] = await Promise.all([listPresets(sort), getMyVotes()]);
            setPresets(rows);
            setMyVotes(votes);
        } catch {
            toast.error(t('community.loadError'));
        } finally {
            setLoading(false);
        }
    }, [sort, t]);

    useEffect(() => {
        load();
    }, [load]);

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
                    <Link href="/community/create" className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-xl uppercase transition-colors">
                        <FaPlus size={12} /> {t('community.createCta')}
                    </Link>
                </div>

                <div className="flex gap-2">
                    {SORTS.map((s) => (
                        <button key={s.key} type="button" onClick={() => setSort(s.key)} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${sort === s.key ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                            {t(s.labelKey as Parameters<typeof t>[0])}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <p className="text-slate-400 py-16 text-center">{t('common.loading')}</p>
                ) : presets.length === 0 ? (
                    <div className="py-16 text-center flex flex-col items-center gap-4">
                        <p className="text-slate-400">{t('community.empty')}</p>
                        <Link href="/community/create" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-5 rounded-xl uppercase transition-colors">
                            {t('community.createCta')}
                        </Link>
                    </div>
                ) : (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {presets.map((preset) => (
                            <PresetCard key={preset.id} preset={preset} myVote={myVotes[preset.id] ?? 0} isOwner={!!user && user.id === preset.author_id} onVote={(value) => handleVote(preset, value)} onDelete={() => handleDelete(preset)} />
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
