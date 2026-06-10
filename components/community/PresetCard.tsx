'use client';

/*
================================================================================
PRESET CARD
================================================================================
One community preset in the browse grid: an emoji banner (the author-chosen icon
as a large faded backdrop with the preset title sized to fill it), vote controls
(device-id based, optimistic), an Import button (fork-on-import into a fresh
lobby), and a Delete button for the author.
================================================================================
*/

import { useState } from 'react';

import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { FaMagic, FaPen, FaRegTrashAlt, FaThumbsDown, FaThumbsUp } from 'react-icons/fa';

import type { CommunityPreset } from '@/components/utils/types';
import { updatePreset } from '@/lib/community';
import { useT } from '@/lib/i18n/I18nProvider';

import { finalizePreset } from './finalizePreset';

interface PresetCardProps {
    preset: CommunityPreset;
    myVote: number; // -1 | 0 | 1
    isOwner: boolean;
    onVote: (value: 1 | -1) => void;
    onDelete: () => void;
    onChanged?: () => void; // re-pull the list after an in-place change (e.g. regenerate)
}

// Shown when the author didn't pick an icon.
const ICON_FALLBACK = '🗺️';

// Pick a title size so it fills the banner without overflowing: shorter names go
// bigger. Paired with break-words + line-clamp so even long names stay contained.
function titleSizeClass(name: string): string {
    const len = name.trim().length;
    if (len <= 8) return 'text-4xl sm:text-5xl';
    if (len <= 14) return 'text-3xl sm:text-4xl';
    if (len <= 22) return 'text-2xl sm:text-3xl';
    return 'text-xl sm:text-2xl';
}

export default function PresetCard({ preset, myVote, isOwner, onVote, onDelete, onChanged }: PresetCardProps) {
    const { t, locale } = useT();
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    // Show the title/description in the viewer's language when a translation exists.
    const displayName = preset.title_translations?.[locale] || preset.name;
    const displayDescription = preset.description_translations?.[locale] || preset.description;

    const hasStart = preset.starting_point !== 'open-world' && preset.starting_point.startsWith('{');

    const importPreset = () => {
        const id = Math.random().toString(36).substring(2, 8);
        router.push(`/game/${id}?preset=${preset.id}`);
    };

    // Backfill the emoji + per-language category translations in place (Gemini +
    // DeepL), without walking the wizard. Handy for presets created before the
    // icon/translation columns existed.
    const regenerate = async () => {
        setBusy(true);
        try {
            const fin = await finalizePreset({ name: preset.name, description: preset.description || '', categoryNames: preset.categories.map((c) => c.categoryName) });
            const res = await updatePreset(preset.id, {
                name: preset.name,
                description: preset.description || '',
                icon: fin.icon || preset.icon || ICON_FALLBACK,
                categories: preset.categories,
                boundaries: preset.boundaries,
                startingPoint: preset.starting_point,
                recommendedTime: preset.recommended_time,
                difficulty: preset.difficulty,
                gameMode: preset.game_mode === 'bingo' ? 'bingo' : 'list',
                gridSize: preset.grid_size,
                settings: preset.settings,
                categoryTranslations: fin.translations,
                titleTranslations: fin.titleTranslations,
                descriptionTranslations: fin.descriptionTranslations,
                categoryHintTranslations: fin.hintTranslations,
            });
            if (res.success) {
                toast.success(t('community.regenerated'));
                onChanged?.();
            } else {
                toast.error(t('community.updateError'));
            }
        } catch {
            toast.error(t('community.updateError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
            {/* Emoji banner: icon as a big faded backdrop, title sized to fill */}
            <div className="relative aspect-[2/1] overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
                <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[7rem] leading-none opacity-25 select-none">
                    {preset.icon || ICON_FALLBACK}
                </span>
                <h3 className={`relative z-10 px-4 text-center font-extrabold leading-tight text-white break-words line-clamp-3 [text-shadow:0_2px_8px_rgba(0,0,0,0.5)] ${titleSizeClass(displayName)}`}>{displayName}</h3>
            </div>

            {/* Body */}
            <div className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-xs text-slate-400 truncate">
                        {t('community.by')} {preset.author_name || t('community.anonymous')}
                    </p>
                    {isOwner && (
                        <div className="flex items-center gap-1 shrink-0 -mt-1">
                            <button type="button" onClick={regenerate} disabled={busy} aria-label={t('community.regenerate')} title={t('community.regenerate')} className="text-slate-500 hover:text-amber-400 p-1 disabled:opacity-50">
                                <FaMagic size={13} className={busy ? 'animate-pulse' : ''} />
                            </button>
                            <button type="button" onClick={() => router.push(`/community/create?edit=${preset.id}`)} aria-label={t('community.edit')} className="text-slate-500 hover:text-indigo-400 p-1">
                                <FaPen size={13} />
                            </button>
                            <button type="button" onClick={onDelete} aria-label={t('community.delete')} className="text-slate-500 hover:text-red-400 p-1">
                                <FaRegTrashAlt />
                            </button>
                        </div>
                    )}
                </div>

                {displayDescription && <p className="text-sm text-slate-300 line-clamp-2">{displayDescription}</p>}

                <div className="flex flex-wrap items-center gap-1 text-xs text-slate-400 mt-auto">
                    <span>{t('community.categoriesCount', { count: preset.category_count })}</span>
                    {preset.boundaries.length > 0 && (
                        <>
                            {' '}
                            <span className="px-1.5">•</span> <span>{t('community.boundariesCount', { count: preset.boundaries.length })}</span>{' '}
                        </>
                    )}
                    {hasStart && (
                        <>
                            {' '}
                            <span className="px-1.5">•</span> <span>{t('community.fixedStart')}</span>{' '}
                        </>
                    )}
                    <span className="px-1.5">•</span> <span>{preset.difficulty}</span>
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
