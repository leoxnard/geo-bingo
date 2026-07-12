'use client';

/*
================================================================================
WORD POOL — ADMIN WINDOW
================================================================================
Full editor for the community word pool (harvested from finished games). Gated
to allow-listed admins (am_i_daily_admin). Unlike the daily-challenge review
this is not just an approval queue: every word — pending, approved or rejected
— can be searched, re-reviewed, edited and deleted.

Translation runs here, in the admin's authenticated browser (Postgres cannot
call DeepL/Gemini): approving a word first fetches its five category-language
translations; editing a word's text re-translates before saving; and on every
load an automatic sweep backfills approved rows that still have no
translations (auto-approved AI words the harvest trigger stored untranslated).
================================================================================
*/

import { useCallback, useEffect, useRef, useState } from 'react';

import toast from 'react-hot-toast';
import { FaCheck, FaPen, FaSpinner, FaTimes, FaTrash } from 'react-icons/fa';

import AccountButton from '@/components/account/AccountButton';
import AuthGate from '@/components/community/AuthGate';
import { useUser } from '@/components/community/useUser';
import { Selection } from '@/components/utils/Elements';
import { amIDailyAdmin } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';
import { LOCALES, LOCALE_CODES, type CategoryLanguage } from '@/lib/i18n/locales';
import { adminDeletePoolWord, adminEditPoolWord, adminListPoolWords, adminReviewPoolWord, adminSetPoolWordTranslations, findRateOf, isFullyTranslated, translatePoolWords, type PoolWord, type PoolWordStatus, type PoolWordTranslations } from '@/lib/wordPool';

type Tab = PoolWordStatus | 'all';
type AdminSort = 'new' | 'imports' | 'played' | 'found' | 'alpha';

const LANGUAGE_OPTIONS = LOCALE_CODES.map((code) => ({ value: LOCALES[code].aiName as string, label: `${LOCALES[code].flag} ${LOCALES[code].label}` }));
const FLAG_BY_LANGUAGE = Object.fromEntries(LOCALE_CODES.map((code) => [LOCALES[code].aiName, LOCALES[code].flag])) as Record<CategoryLanguage, string>;

export default function WordPoolAdmin() {
    const { t } = useT();
    const { user, loading: userLoading } = useUser();
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

    useEffect(() => {
        if (!user) return;
        let alive = true;
        amIDailyAdmin().then((v) => alive && setIsAdmin(v));
        return () => {
            alive = false;
        };
    }, [user]);

    if (userLoading) return <Centered>{t('common.loading')}</Centered>;
    if (!user)
        return (
            <Centered>
                <div className="w-full max-w-md">
                    <AuthGate>
                        <p className="text-sm text-emerald-300">{t('community.signedIn')}</p>
                    </AuthGate>
                </div>
            </Centered>
        );
    if (isAdmin === null) return <Centered>{t('common.loading')}</Centered>;
    if (!isAdmin)
        return (
            <Centered>
                <div className="flex flex-col items-center gap-4">
                    <p>{t('daily.admin.notAdmin')}</p>
                    <AccountButton />
                </div>
            </Centered>
        );

    return (
        <main className="min-h-dvh bg-slate-900 px-4 py-8 text-white">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                <h1 className="text-2xl font-bold text-indigo-300">{t('words.admin.title')}</h1>
                <PoolEditor />
            </div>
        </main>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <main className="flex min-h-dvh items-center justify-center bg-slate-900 px-4 text-center text-slate-300">{children}</main>;
}

// ── Editor ────────────────────────────────────────────────────────────────────

function PoolEditor() {
    const { t } = useT();
    const [rows, setRows] = useState<PoolWord[] | null>(null);
    const [tab, setTab] = useState<Tab>('pending');
    const [langFilter, setLangFilter] = useState<string>('any');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [sort, setSort] = useState<AdminSort>('new');
    const [editing, setEditing] = useState<{ id: string; word: string; language: CategoryLanguage } | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    // The backfill sweep tries each row at most once per page visit, so a
    // failing translation service can't loop.
    const sweptIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 400);
        return () => clearTimeout(timer);
    }, [search]);

    // Automatic backfill: translate approved rows that have no translations
    // yet and persist them in batches. Best-effort — a failure leaves the word
    // usable in its source language until the next sweep.
    const backfillTranslations = useCallback(
        async (list: PoolWord[]) => {
            const targets = list.filter((w) => w.status === 'approved' && !isFullyTranslated(w) && !sweptIdsRef.current.has(w.id));
            if (targets.length === 0) return;
            targets.forEach((w) => sweptIdsRef.current.add(w.id));

            const loadingToast = toast.loading(t('words.admin.translating'));
            try {
                const translations = await translatePoolWords(targets.map((w) => w.word));
                const items = targets.map((w, i) => ({ id: w.id, translations: translations[i] }));
                for (let i = 0; i < items.length; i += 100) {
                    await adminSetPoolWordTranslations(items.slice(i, i + 100));
                }
                const byId = new Map(items.map((it) => [it.id, it.translations]));
                setRows((prev) => prev?.map((w) => (byId.has(w.id) ? { ...w, translations: byId.get(w.id) as PoolWordTranslations } : w)) ?? prev);
                toast.dismiss(loadingToast);
                toast.success(t('words.admin.translated', { count: items.length }));
            } catch {
                toast.dismiss(loadingToast);
                toast.error(t('words.admin.translateFailed'));
            }
        },
        [t],
    );

    const load = useCallback(async () => {
        try {
            const list = await adminListPoolWords({
                language: langFilter === 'any' ? null : (langFilter as CategoryLanguage),
                search: debouncedSearch || null,
            });
            setRows(list);
            void backfillTranslations(list);
        } catch {
            setRows([]);
            toast.error(t('words.admin.failed'));
        }
    }, [langFilter, debouncedSearch, backfillTranslations, t]);

    useEffect(() => {
        load();
    }, [load]);

    const review = async (w: PoolWord, action: 'approved' | 'rejected') => {
        setBusyId(w.id);
        try {
            // Approving makes the word importable everywhere, so fetch its
            // translations first (skipped when a previous approve already did).
            let translations: PoolWordTranslations | null = null;
            if (action === 'approved' && !isFullyTranslated(w)) {
                try {
                    translations = (await translatePoolWords([w.word]))[0];
                } catch {
                    toast.error(t('words.admin.translateFailed'));
                }
            }
            const res = await adminReviewPoolWord(w.id, action, translations);
            if (!res.success) {
                toast.error(t('words.admin.failed'));
                return;
            }
            toast.success(t('words.admin.saved'));
            await load();
        } finally {
            setBusyId(null);
        }
    };

    // Approve every pending word in the current view (respects the active language
    // and search filters). Reuses the per-word approve flow, but batch-translates
    // all untranslated words in a single call first so approval stays fast.
    const approveAll = async (words: PoolWord[]) => {
        const pending = words.filter((w) => w.status === 'pending');
        if (pending.length === 0 || bulkBusy) return;
        if (!window.confirm(t('words.admin.approveAllConfirm', { count: pending.length }))) return;

        setBulkBusy(true);
        const loadingToast = toast.loading(t('words.admin.approvingAll', { count: pending.length }));
        try {
            // One translation round for every word still missing a full set; a
            // failure just leaves those words usable in their source language.
            const needTranslation = pending.filter((w) => !isFullyTranslated(w));
            const translationById = new Map<string, PoolWordTranslations>();
            if (needTranslation.length > 0) {
                try {
                    const maps = await translatePoolWords(needTranslation.map((w) => w.word));
                    needTranslation.forEach((w, i) => translationById.set(w.id, maps[i]));
                } catch {
                    toast.error(t('words.admin.translateFailed'));
                }
            }

            let failed = 0;
            for (const w of pending) {
                try {
                    const res = await adminReviewPoolWord(w.id, 'approved', translationById.get(w.id) ?? null);
                    if (!res.success) failed++;
                } catch {
                    failed++;
                }
            }

            toast.dismiss(loadingToast);
            if (failed === 0) toast.success(t('words.admin.approvedAll', { count: pending.length }));
            else toast.error(t('words.admin.approveAllPartial', { done: pending.length - failed, total: pending.length, failed }));
            await load();
        } finally {
            setBulkBusy(false);
        }
    };

    const saveEdit = async () => {
        if (!editing) return;
        const original = rows?.find((r) => r.id === editing.id);
        if (!original) return;
        const newWord = editing.word.trim();
        if (!newWord) return;
        const wordChanged = newWord !== original.word;
        const languageChanged = editing.language !== original.language;

        setBusyId(editing.id);
        try {
            // A renamed word means new translations; a pure language re-tag keeps them.
            let translations: PoolWordTranslations | undefined;
            if (wordChanged) {
                try {
                    translations = (await translatePoolWords([newWord]))[0];
                } catch {
                    toast.error(t('words.admin.translateFailed'));
                }
            }
            const res = await adminEditPoolWord(editing.id, {
                word: wordChanged ? newWord : undefined,
                language: languageChanged ? editing.language : undefined,
                translations,
            });
            if (!res.success) {
                toast.error(res.error === 'DUPLICATE' ? t('words.admin.duplicate') : t('words.admin.failed'));
                return;
            }
            toast.success(t('words.admin.saved'));
            setEditing(null);
            await load();
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (w: PoolWord) => {
        if (!window.confirm(t('words.admin.deleteConfirm', { word: w.word }))) return;
        setBusyId(w.id);
        try {
            const res = await adminDeletePoolWord(w.id);
            if (!res.success) {
                toast.error(t('words.admin.failed'));
                return;
            }
            toast.success(t('words.admin.saved'));
            await load();
        } finally {
            setBusyId(null);
        }
    };

    if (rows === null) return <p className="text-sm text-slate-400">{t('common.loading')}</p>;

    const tabs: Tab[] = ['pending', 'approved', 'rejected', 'all'];
    const countFor = (tb: Tab) => (tb === 'all' ? rows.length : rows.filter((r) => r.status === tb).length);
    const tabLabel: Record<Tab, string> = {
        pending: t('words.admin.pending'),
        approved: t('words.admin.approved'),
        rejected: t('words.admin.rejected'),
        all: t('words.admin.all'),
    };
    const sorts: { key: AdminSort; label: string }[] = [
        { key: 'new', label: t('words.admin.sortNew') },
        { key: 'imports', label: t('words.admin.sortImports') },
        { key: 'played', label: t('words.admin.sortPlayed') },
        { key: 'found', label: t('words.admin.sortFound') },
        { key: 'alpha', label: t('words.admin.sortAlpha') },
    ];

    const visible = rows.filter((r) => tab === 'all' || r.status === tab);
    const byNorm = (a: PoolWord, b: PoolWord) => a.word_norm.localeCompare(b.word_norm);
    switch (sort) {
    case 'new':
        visible.sort((a, b) => b.created_at.localeCompare(a.created_at) || byNorm(a, b));
        break;
    case 'imports':
        visible.sort((a, b) => b.import_count - a.import_count || b.games_count - a.games_count || byNorm(a, b));
        break;
    case 'played':
        visible.sort((a, b) => b.games_count - a.games_count || byNorm(a, b));
        break;
    case 'found':
        visible.sort((a, b) => b.found_count - a.found_count || b.games_count - a.games_count || byNorm(a, b));
        break;
    case 'alpha':
        visible.sort(byNorm);
        break;
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Status tabs */}
            <div className="flex flex-wrap gap-2">
                {tabs.map((tb) => (
                    <button key={tb} type="button" onClick={() => setTab(tb)} className={`rounded-lg px-3 py-1.5 text-sm font-bold uppercase tracking-wide transition-colors ${tab === tb ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                        {tabLabel[tb]} ({countFor(tb)})
                    </button>
                ))}
            </div>

            {/* Search + language filter */}
            <div className="flex flex-wrap items-center gap-3">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('words.admin.searchPlaceholder')} className="min-w-[200px] flex-1 rounded-xl border border-slate-600 bg-slate-900 p-2.5 text-white outline-none focus:border-indigo-500" />
                <Selection title={t('words.admin.language')} options={[{ value: 'any', label: t('words.admin.anyLanguage') }, ...LANGUAGE_OPTIONS]} value={langFilter} onChange={setLangFilter} position="clean" />
            </div>

            {/* Sort */}
            <div className="flex flex-wrap gap-2">
                {sorts.map((s) => (
                    <button key={s.key} type="button" onClick={() => setSort(s.key)} className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${sort === s.key ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Bulk approve — only meaningful while looking at the pending queue */}
            {tab === 'pending' && visible.length > 0 && (
                <button type="button" onClick={() => approveAll(visible)} disabled={bulkBusy} className="flex items-center justify-center gap-2 self-start rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50">
                    {bulkBusy ? <FaSpinner className="animate-spin" size={12} /> : <FaCheck size={12} />} {t('words.admin.approveAll', { count: visible.length })}
                </button>
            )}

            {/* Words */}
            {visible.length === 0 ? (
                <p className="text-sm text-slate-400">{t('words.admin.empty')}</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {visible.map((w) => (
                        <WordRow key={w.id} w={w} busy={busyId === w.id || bulkBusy} editing={editing?.id === w.id ? editing : null} onEditChange={setEditing} onStartEdit={() => setEditing({ id: w.id, word: w.word, language: w.language })} onSaveEdit={saveEdit} onCancelEdit={() => setEditing(null)} onReview={review} onDelete={remove} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Row ───────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<PoolWordStatus, string> = {
    pending: 'bg-amber-500/15 text-amber-300',
    approved: 'bg-emerald-500/15 text-emerald-300',
    rejected: 'bg-rose-500/15 text-rose-300',
};

interface WordRowProps {
    w: PoolWord;
    busy: boolean;
    editing: { id: string; word: string; language: CategoryLanguage } | null;
    onEditChange: (e: { id: string; word: string; language: CategoryLanguage }) => void;
    onStartEdit: () => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    onReview: (w: PoolWord, action: 'approved' | 'rejected') => void;
    onDelete: (w: PoolWord) => void;
}

function WordRow({ w, busy, editing, onEditChange, onStartEdit, onSaveEdit, onCancelEdit, onReview, onDelete }: WordRowProps) {
    const { t } = useT();
    const rate = findRateOf(w);

    // Every translation that differs from the source word, prefixed by its flag.
    const translationsLine = LOCALE_CODES.map((code) => {
        const lang = LOCALES[code].aiName;
        const text = w.translations?.[lang]?.trim();
        return text && lang !== w.language ? `${LOCALES[code].flag} ${text}` : null;
    })
        .filter(Boolean)
        .join('  ·  ');

    return (
        <div className={`rounded-xl border border-slate-700 bg-slate-800 p-3 ${busy ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <input value={editing.word} onChange={(e) => onEditChange({ ...editing, word: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && onSaveEdit()} className="min-w-[160px] flex-1 rounded-lg border border-slate-600 bg-slate-900 p-2 text-white outline-none focus:border-indigo-500" />
                            <Selection title={t('words.admin.language')} options={LANGUAGE_OPTIONS} value={editing.language} onChange={(val) => onEditChange({ ...editing, language: val as CategoryLanguage })} position="clean" />
                            <button type="button" onClick={onSaveEdit} disabled={busy} className="rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-500 disabled:opacity-50" title={t('words.admin.save')}>
                                <FaCheck size={12} />
                            </button>
                            <button type="button" onClick={onCancelEdit} className="rounded-lg bg-slate-700 p-2 text-white hover:bg-slate-600" title={t('words.admin.cancel')}>
                                <FaTimes size={12} />
                            </button>
                        </div>
                    ) : (
                        <>
                            <p className="truncate font-bold text-white">
                                <span className="mr-1.5">{FLAG_BY_LANGUAGE[w.language]}</span>
                                {w.word}
                            </p>
                            <p className="truncate text-xs text-slate-500">{translationsLine || t('words.admin.untranslated')}</p>
                        </>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                        <span>{t('explore.statImports', { count: w.import_count })}</span>
                        <span>{t('explore.statPlayed', { count: w.games_count })}</span>
                        <span>{t('explore.statFound', { count: w.found_count })}</span>
                        {rate !== null && <span>{t('explore.statFindRate', { rate: Math.round(rate * 100) })}</span>}
                        <span>{new Date(w.created_at).toLocaleDateString()}</span>
                    </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                    <span className={`mr-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[w.status]}`}>{w.status}</span>
                    {w.status !== 'approved' && (
                        <button type="button" onClick={() => onReview(w, 'approved')} disabled={busy} className="rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-500 disabled:opacity-50" title={t('words.admin.approve')}>
                            <FaCheck size={12} />
                        </button>
                    )}
                    {w.status !== 'rejected' && (
                        <button type="button" onClick={() => onReview(w, 'rejected')} disabled={busy} className="rounded-lg bg-red-600 p-2 text-white hover:bg-red-500 disabled:opacity-50" title={t('words.admin.reject')}>
                            <FaTimes size={12} />
                        </button>
                    )}
                    {!editing && (
                        <button type="button" onClick={onStartEdit} disabled={busy} className="rounded-lg bg-slate-700 p-2 text-white hover:bg-slate-600 disabled:opacity-50" title={t('words.admin.edit')}>
                            <FaPen size={12} />
                        </button>
                    )}
                    <button type="button" onClick={() => onDelete(w)} disabled={busy} className="rounded-lg bg-slate-700 p-2 text-rose-300 hover:bg-slate-600 disabled:opacity-50" title={t('words.admin.delete')}>
                        <FaTrash size={12} />
                    </button>
                </div>
            </div>
        </div>
    );
}
