'use client';

/*
===============================================================================
LOBBY COMMUNITY PRESETS OVERLAY
===============================================================================
Modal overlay for browsing and importing community presets directly into the lobby
without leaving the page. Host-only functionality to import preset categories,
boundaries, and settings into the current game.
===============================================================================
*/

import { useCallback, useEffect, useRef, useState } from 'react';

import toast from 'react-hot-toast';
import { FaArrowLeft, FaTimes } from 'react-icons/fa';

import { countDrawnBoundaries } from '@/components/utils/mapUtils';
import type { CommunityPreset } from '@/components/utils/types';
import { listPresets, type PresetSort } from '@/lib/community';
import { useT } from '@/lib/i18n/I18nProvider';

const SORTS: { key: PresetSort; labelKey: string }[] = [
    { key: 'top', labelKey: 'community.sortTop' },
    { key: 'new', labelKey: 'community.sortNew' },
];

interface LobbyCommunityPresetsProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (preset: CommunityPreset) => void;
}

export default function LobbyCommunityPresets({ isOpen, onClose, onImport }: LobbyCommunityPresetsProps) {
    const { t } = useT();
    const [presets, setPresets] = useState<CommunityPreset[]>([]);
    const sortRef = useRef<PresetSort>('top');
    const [sort, setSortState] = useState<PresetSort>('top');
    const [importingId, setImportingId] = useState<string | null>(null);
    const hasLoadedRef = useRef(false);

    const loadPresets = useCallback(
        async (currentSort: PresetSort) => {
            try {
                const rows = await listPresets(currentSort);
                setPresets(rows);
            } catch {
                toast.error(t('community.loadError'));
            }
        },
        [t],
    );

    useEffect(() => {
        if (isOpen && !hasLoadedRef.current) {
            loadPresets(sortRef.current);
            hasLoadedRef.current = true;
        }
        if (!isOpen) {
            hasLoadedRef.current = false;
        }
    }, [isOpen, loadPresets]);

    const handleSortChange = (newSort: PresetSort) => {
        sortRef.current = newSort;
        setSortState(newSort);
        if (hasLoadedRef.current) {
            loadPresets(newSort);
        }
    };

    const handleImport = async (preset: CommunityPreset) => {
        setImportingId(preset.id);
        try {
            onImport(preset);
            toast.success(t('community.importSuccess'));
        } catch {
            toast.error(t('community.importError'));
        } finally {
            setImportingId(null);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="glass-dark rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label={t('landing.backHome')}>
                            <FaArrowLeft />
                        </button>
                        <h2 className="bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-xl font-bold text-transparent">{t('community.browseTitle')}</h2>
                    </div>
                    <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
                        <FaTimes />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {/* Sort tabs */}
                    <div className="flex gap-2 mb-4">
                        {SORTS.map((s) => (
                            <button key={s.key} type="button" onClick={() => handleSortChange(s.key)} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${sort === s.key ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]' : 'glass press text-slate-300 hover:text-white'}`}>
                                {t(s.labelKey as Parameters<typeof t>[0])}
                            </button>
                        ))}
                    </div>

                    {presets.length === 0 ? (
                        <div className="py-16 text-center">
                            <p className="text-slate-400">{t('community.empty')}</p>
                        </div>
                    ) : (
                        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                            {presets.map((preset) => (
                                <LobbyPresetCard key={preset.id} preset={preset} isImporting={importingId === preset.id} onImport={handleImport} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Simplified preset card for lobby import (no vote controls, just import button)
function LobbyPresetCard({ preset, isImporting, onImport }: { preset: CommunityPreset; isImporting: boolean; onImport: (preset: CommunityPreset) => void }) {
    const { t, locale } = useT();

    const displayName = preset.title_translations?.[locale] || preset.name;
    const displayDescription = preset.description_translations?.[locale] || preset.description;

    const hasStart = preset.starting_point !== 'open-world' && preset.starting_point.startsWith('{');
    const boundaryCount = countDrawnBoundaries(preset.boundaries);

    return (
        <div className="glass card-lift rounded-2xl overflow-hidden flex flex-col">
            {/* Emoji banner */}
            <div className="relative aspect-[2/1] overflow-hidden bg-gradient-to-br from-indigo-500/25 via-slate-900/60 to-fuchsia-500/20 flex items-center justify-center">
                <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[7rem] leading-none opacity-25 select-none">
                    {preset.icon || '🗺️'}
                </span>
                <h3 className={`relative z-10 px-4 text-center font-extrabold leading-tight text-white break-words line-clamp-3 [text-shadow:0_2px_8px_rgba(0,0,0,0.5)] ${preset.name.length <= 8 ? 'text-4xl sm:text-5xl' : preset.name.length <= 14 ? 'text-3xl sm:text-4xl' : preset.name.length <= 22 ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}`}>{displayName}</h3>
            </div>

            {/* Body */}
            <div className="p-4 flex flex-col gap-3 flex-1">
                <p className="min-w-0 text-xs text-slate-400 truncate">
                    {t('community.by')} {preset.author_name || t('community.anonymous')}
                </p>

                {displayDescription && <p className="text-sm text-slate-300 line-clamp-2">{displayDescription}</p>}

                <div className="flex flex-wrap items-center gap-1 text-xs text-slate-400 mt-auto">
                    <span>{t('community.categoriesCount', { count: preset.category_count })}</span>
                    {boundaryCount > 0 && (
                        <>
                            {' '}
                            <span className="px-1.5">•</span> <span>{t('community.boundariesCount', { count: boundaryCount })}</span>{' '}
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

                <button type="button" onClick={() => onImport(preset)} disabled={isImporting} className="btn-sheen press ml-auto bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold py-1.5 px-4 rounded-lg text-sm uppercase shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] disabled:opacity-50">
                    {isImporting ? t('common.loading') : t('community.import')}
                </button>
            </div>
        </div>
    );
}
