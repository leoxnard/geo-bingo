'use client';

/*
===============================================================================
LOBBY EXPLORE WORDS OVERLAY
===============================================================================
Modal overlay for browsing the community word pool — category words harvested
from real finished games — and pulling them onto the current board without
leaving the lobby. Hosts add words directly; non-hosts suggest them through the
regular suggestion flow. Words display in the lobby's current category language
(rows without a translation for it yet are hidden); the pool itself is
language-transparent, so there is no language filter.
===============================================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';

import toast from 'react-hot-toast';
import { FaArrowLeft, FaBullseye, FaCheck, FaDownload, FaGamepad, FaTimes } from 'react-icons/fa';

import { useT } from '@/lib/i18n/I18nProvider';
import type { CategoryLanguage } from '@/lib/i18n/locales';
import { difficultyOf, displayWordFor, findRateOf, listPoolWords, registerWordImports, type PoolDifficulty, type PoolWord } from '@/lib/wordPool';

import { Selection, ToggleSwitch } from '../utils/Elements';

type ExploreSort = 'imports' | 'played' | 'found' | 'findRate' | 'new' | 'alpha';

const SORTS: { key: ExploreSort; labelKey: string }[] = [
    { key: 'imports', labelKey: 'explore.sortImports' },
    { key: 'played', labelKey: 'explore.sortPlayed' },
    { key: 'found', labelKey: 'explore.sortFound' },
    { key: 'findRate', labelKey: 'explore.sortFindRate' },
    { key: 'new', labelKey: 'explore.sortNew' },
    { key: 'alpha', labelKey: 'explore.sortAlpha' },
];

interface ExploreWordsProps {
    isOpen: boolean;
    onClose: () => void;
    isHost: boolean;
    language: CategoryLanguage;
    boardWords: string[];
    suggestedWords: string[];
    /** Host add; returns false when the board is full (bingo grid limit). */
    onAddWord: (word: string) => boolean;
    /** Non-host suggest via the regular suggestion flow; resolves false on failure. */
    onSuggestWord: (word: string) => Promise<boolean>;
}

const norm = (s: string) => s.trim().toLowerCase();

export default function ExploreWords({ isOpen, onClose, isHost, language, boardWords, suggestedWords, onAddWord, onSuggestWord }: ExploreWordsProps) {
    const { t } = useT();
    const [words, setWords] = useState<PoolWord[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<ExploreSort>('imports');
    const [difficulty, setDifficulty] = useState<'any' | PoolDifficulty>('any');
    const [foundOnly, setFoundOnly] = useState(false);
    const [hideAdded, setHideAdded] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Suggestions reach the suggestedWords prop only via the realtime echo;
    // mirror them locally so rows flip to "Suggested" immediately.
    const [sessionSuggested, setSessionSuggested] = useState<string[]>([]);
    // Each word bumps the import counter at most once per overlay session,
    // no matter how often it is added, removed and re-added.
    const countedIdsRef = useRef<Set<string>>(new Set());
    const hasLoadedRef = useRef(false);

    useEffect(() => {
        if (isOpen && !hasLoadedRef.current) {
            hasLoadedRef.current = true;
            setLoadFailed(false);
            listPoolWords()
                .then(setWords)
                .catch(() => {
                    setWords([]);
                    setLoadFailed(true);
                });
        }
        if (!isOpen) {
            hasLoadedRef.current = false;
            setWords(null);
        }
    }, [isOpen]);

    const boardSet = useMemo(() => new Set(boardWords.map(norm)), [boardWords]);
    const suggestedSet = useMemo(() => new Set([...suggestedWords, ...sessionSuggested].map(norm)), [suggestedWords, sessionSuggested]);

    const rows = useMemo(() => {
        if (!words) return [];
        const q = norm(search);

        // Resolve each word into the lobby's category language; rows the admin
        // sweep has not translated yet are hidden rather than shown wrong.
        const entries = words.map((w) => ({ w, name: displayWordFor(w, language) })).filter((e): e is { w: PoolWord; name: string } => !!e.name);

        const filtered = entries.filter(({ w, name }) => {
            if (q && !name.toLowerCase().includes(q)) return false;
            if (foundOnly && w.found_count < 1) return false;
            if (hideAdded && boardSet.has(norm(name))) return false;
            if (difficulty !== 'any' && difficultyOf(w) !== difficulty) return false;
            return true;
        });

        type Entry = (typeof filtered)[number];
        const byNorm = (a: Entry, b: Entry) => a.w.word_norm.localeCompare(b.w.word_norm);
        const withTiebreaks = (primary: (a: Entry, b: Entry) => number) => (a: Entry, b: Entry) => primary(a, b) || b.w.games_count - a.w.games_count || byNorm(a, b);

        switch (sort) {
        case 'imports':
            filtered.sort(withTiebreaks((a, b) => b.w.import_count - a.w.import_count));
            break;
        case 'played':
            filtered.sort(withTiebreaks((a, b) => b.w.games_count - a.w.games_count));
            break;
        case 'found':
            filtered.sort(withTiebreaks((a, b) => b.w.found_count - a.w.found_count));
            break;
        case 'findRate':
            // Only rows with data get ranked by rate; the rest sink to the end.
            filtered.sort((a, b) => {
                const ra = findRateOf(a.w);
                const rb = findRateOf(b.w);
                if (ra === null && rb === null) return byNorm(a, b);
                if (ra === null) return 1;
                if (rb === null) return -1;
                return rb - ra || b.w.games_count - a.w.games_count || byNorm(a, b);
            });
            break;
        case 'new':
            filtered.sort(withTiebreaks((a, b) => b.w.created_at.localeCompare(a.w.created_at)));
            break;
        case 'alpha':
            filtered.sort((a, b) => a.name.localeCompare(b.name));
            break;
        }
        return filtered;
    }, [words, language, search, sort, difficulty, foundOnly, hideAdded, boardSet]);

    const countImport = (id: string) => {
        if (countedIdsRef.current.has(id)) return;
        countedIdsRef.current.add(id);
        void registerWordImports([id]);
    };

    const handleAdd = (w: PoolWord, name: string) => {
        if (!onAddWord(name)) {
            toast.error(t('explore.boardFull'));
            return;
        }
        countImport(w.id);
    };

    const handleSuggest = async (w: PoolWord, name: string) => {
        setBusyId(w.id);
        try {
            const ok = await onSuggestWord(name);
            if (ok) {
                setSessionSuggested((prev) => [...prev, name]);
                countImport(w.id);
            }
        } finally {
            setBusyId(null);
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
                        <h2 className="bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-xl font-bold text-transparent">{t('explore.title')}</h2>
                    </div>
                    <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
                        <FaTimes />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {/* Controls */}
                    <div className="flex flex-col gap-3 mb-4">
                        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('explore.searchPlaceholder')} className="w-full p-3 rounded-lg glass-inset text-white outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-indigo-500" />

                        <div className="flex flex-wrap gap-2">
                            {SORTS.map((s) => (
                                <button key={s.key} type="button" onClick={() => setSort(s.key)} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${sort === s.key ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]' : 'glass press text-slate-300 hover:text-white'}`}>
                                    {t(s.labelKey as Parameters<typeof t>[0])}
                                </button>
                            ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                            <Selection
                                title={t('explore.difficulty')}
                                options={[
                                    { label: t('explore.difficultyAny'), value: 'any' },
                                    { label: t('explore.difficultyEasy'), value: 'easy' },
                                    { label: t('explore.difficultyMedium'), value: 'medium' },
                                    { label: t('explore.difficultyHard'), value: 'hard' },
                                ]}
                                value={difficulty}
                                onChange={(val) => setDifficulty(val as 'any' | PoolDifficulty)}
                                position="clean"
                                classname="min-w-[220px]"
                            />
                            <ToggleSwitch checked={foundOnly} onChange={setFoundOnly} label={t('explore.filterFound')} />
                            <ToggleSwitch checked={hideAdded} onChange={setHideAdded} label={t('explore.filterHideAdded')} />
                        </div>
                    </div>

                    {/* Word list */}
                    {words === null ? (
                        <p className="py-16 text-center text-slate-400">{t('common.loading')}</p>
                    ) : loadFailed ? (
                        <p className="py-16 text-center text-slate-400">{t('explore.loadError')}</p>
                    ) : rows.length === 0 ? (
                        <p className="py-16 text-center text-slate-400">{t('explore.empty')}</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {rows.map(({ w, name }) => {
                                const onBoard = boardSet.has(norm(name));
                                const isSuggested = suggestedSet.has(norm(name));
                                const rate = findRateOf(w);
                                const done = isHost ? onBoard : onBoard || isSuggested;
                                const doneLabel = isHost || onBoard ? t('explore.added') : t('explore.suggested');
                                return (
                                    <div key={w.id} className="glass rounded-xl flex items-center justify-between gap-3 px-3 py-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-white font-medium truncate">{name}</p>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
                                                <span className="flex items-center gap-1" title={t('explore.statImports', { count: w.import_count })}>
                                                    <FaDownload size={10} /> {w.import_count}
                                                </span>
                                                <span className="flex items-center gap-1" title={t('explore.statPlayed', { count: w.games_count })}>
                                                    <FaGamepad size={10} /> {w.games_count}
                                                </span>
                                                <span className="flex items-center gap-1" title={t('explore.statFound', { count: w.found_count })}>
                                                    <FaCheck size={10} /> {w.found_count}
                                                </span>
                                                {rate !== null && (
                                                    <span className="flex items-center gap-1" title={t('explore.statFindRate', { rate: Math.round(rate * 100) })}>
                                                        <FaBullseye size={10} /> {Math.round(rate * 100)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {done ? (
                                            <span className="shrink-0 glass-inset text-slate-500 font-bold py-1.5 px-4 rounded-lg text-sm uppercase flex items-center gap-1.5">
                                                <FaCheck size={11} /> {doneLabel}
                                            </span>
                                        ) : (
                                            <button type="button" onClick={() => (isHost ? handleAdd(w, name) : handleSuggest(w, name))} disabled={busyId === w.id} className="btn-sheen press shrink-0 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold py-1.5 px-4 rounded-lg text-sm uppercase shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] disabled:opacity-50">
                                                {busyId === w.id ? t('common.loading') : isHost ? t('explore.add') : t('explore.suggest')}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
