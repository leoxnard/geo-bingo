'use client';

/*
================================================================================
PRESET CARD
================================================================================
One community preset in the browse grid: Street View thumbnails of its saved
categories, vote controls (device-id based, optimistic), an Import button
(fork-on-import into a fresh lobby), and a Delete button for the author.
================================================================================
*/

import { useRouter } from 'next/navigation';
import { FaRegTrashAlt, FaThumbsDown, FaThumbsUp } from 'react-icons/fa';

import { getStreetViewImageUrl } from '@/components/streetview/streetViewHelpers';
import type { CommunityPreset } from '@/components/utils/types';
import { useT } from '@/lib/i18n/I18nProvider';

interface PresetCardProps {
    preset: CommunityPreset;
    myVote: number; // -1 | 0 | 1
    isOwner: boolean;
    onVote: (value: 1 | -1) => void;
    onDelete: () => void;
}

export default function PresetCard({ preset, myVote, isOwner, onVote, onDelete }: PresetCardProps) {
    const { t } = useT();
    const router = useRouter();

    const thumbs = preset.categories.slice(0, 4);
    const hasStart = preset.starting_point !== 'open-world' && preset.starting_point.startsWith('{');

    const importPreset = () => {
        const id = Math.random().toString(36).substring(2, 8);
        router.push(`/game/${id}?preset=${preset.id}`);
    };

    return (
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
            {/* Thumbnails */}
            <div className="grid grid-cols-2 gap-px bg-slate-700 aspect-[2/1]">
                {thumbs.map((cat, i) => (
                    <div key={i} className="relative bg-slate-900 overflow-hidden">
                        <img src={getStreetViewImageUrl(cat, 240)} alt={cat.categoryName} className="w-full h-full object-cover" loading="lazy" />
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5 truncate">{cat.categoryName}</span>
                    </div>
                ))}
                {thumbs.length === 0 && <div className="col-span-2 flex items-center justify-center text-slate-500 text-sm">{t('community.noPreview')}</div>}
            </div>

            {/* Body */}
            <div className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h3 className="font-bold text-white truncate">{preset.name}</h3>
                        <p className="text-xs text-slate-400 truncate">
                            {t('community.by')} {preset.author_name || t('community.anonymous')}
                        </p>
                    </div>
                    {isOwner && (
                        <button type="button" onClick={onDelete} aria-label={t('community.delete')} className="text-slate-500 hover:text-red-400 p-1 shrink-0">
                            <FaRegTrashAlt />
                        </button>
                    )}
                </div>

                {preset.description && <p className="text-sm text-slate-300 line-clamp-2">{preset.description}</p>}

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 mt-auto">
                    <span>{t('community.categoriesCount', { count: preset.category_count })}</span>
                    <span>{t('community.boundariesCount', { count: preset.boundaries.length })}</span>
                    <span>{hasStart ? t('community.fixedStart') : t('community.openWorld')}</span>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-700">
                    <button type="button" onClick={() => onVote(1)} aria-label={t('community.upvote')} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-bold transition-colors ${myVote === 1 ? 'bg-green-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-700'}`}>
                        <FaThumbsUp size={12} /> {preset.upvotes}
                    </button>
                    <button type="button" onClick={() => onVote(-1)} aria-label={t('community.downvote')} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-bold transition-colors ${myVote === -1 ? 'bg-red-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-700'}`}>
                        <FaThumbsDown size={12} /> {preset.downvotes}
                    </button>
                    <button type="button" onClick={importPreset} className="ml-auto bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-4 rounded-lg text-sm uppercase transition-colors">
                        {t('community.import')}
                    </button>
                </div>
            </div>
        </div>
    );
}
