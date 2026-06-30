'use client';

/*
================================================================================
ACCOUNT BUTTON
================================================================================
A compact, reusable profile control: shows "Sign in" when logged out and the
account name when logged in. Clicking opens a profile overview — name + email,
an account-wide rename (display_name + every owned preset's author_name, via
renameAuthor), and sign out — or the email-OTP sign-in flow when logged out.
Used everywhere the player's profile appears (home, daily hub, community).
================================================================================
*/

import { useState } from 'react';

import toast from 'react-hot-toast';
import { FaPen, FaUserCircle } from 'react-icons/fa';

import AuthGate from '@/components/community/AuthGate';
import { useUser, displayNameFor } from '@/components/community/useUser';
import { deleteAccount, renameAuthor } from '@/lib/community';
import { useT } from '@/lib/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';

export default function AccountButton({ className = '', onRenamed }: { className?: string; onRenamed?: () => void }) {
    const { t } = useT();
    const { user, loading } = useUser();
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    if (loading) return null;

    const close = () => {
        setOpen(false);
        setRenaming(false);
        setDeleting(false);
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        close();
    };

    const confirmDelete = async () => {
        setBusy(true);
        try {
            await deleteAccount();
            toast.success(t('community.accountDeleted'));
            close();
        } catch {
            toast.error(t('community.deleteAccountError'));
        } finally {
            setBusy(false);
        }
    };

    const openRename = () => {
        setName(displayNameFor(user));
        setRenaming(true);
    };

    const saveRename = async () => {
        const next = name.trim();
        if (!next) return;
        setBusy(true);
        try {
            await renameAuthor(next);
            setRenaming(false);
            toast.success(t('community.nameUpdated'));
            onRenamed?.();
        } catch {
            toast.error(t('community.nameUpdateError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-indigo-500 hover:text-white ${className}`}>
                <FaUserCircle /> {user ? displayNameFor(user) : t('community.signIn')}
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
                    <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                        {user ? (
                            <div className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800 p-6">
                                {renaming ? (
                                    <>
                                        <div>
                                            <h2 className="text-xl font-bold text-indigo-400">{t('community.renameName')}</h2>
                                            <p className="mt-1 text-xs text-slate-400">{t('community.renameNameHelp')}</p>
                                        </div>
                                        <input autoFocus type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveRename()} className="w-full rounded-xl border border-slate-600 bg-slate-900 p-3 text-white outline-none focus:border-indigo-500" />
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={() => setRenaming(false)} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-slate-600">
                                                {t('common.cancel')}
                                            </button>
                                            <button type="button" onClick={saveRename} disabled={!name.trim() || busy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-indigo-500 disabled:opacity-50">
                                                {busy ? t('common.loading') : t('community.rename')}
                                            </button>
                                        </div>
                                    </>
                                ) : deleting ? (
                                    <>
                                        <div>
                                            <h2 className="text-xl font-bold text-red-400">{t('community.deleteAccountTitle')}</h2>
                                            <p className="mt-1 text-sm text-slate-400">{t('community.deleteAccountWarning')}</p>
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={() => setDeleting(false)} disabled={busy} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-slate-600 disabled:opacity-50">
                                                {t('common.cancel')}
                                            </button>
                                            <button type="button" onClick={confirmDelete} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-red-500 disabled:opacity-50">
                                                {busy ? t('common.loading') : t('community.deleteAccountCta')}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div>
                                            <h2 className="text-xl font-bold text-indigo-400">{displayNameFor(user)}</h2>
                                            {user.email && <p className="mt-1 text-sm text-slate-400">{user.email}</p>}
                                        </div>
                                        <button type="button" onClick={openRename} className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-indigo-500">
                                            <FaPen size={12} /> {t('community.renameName')}
                                        </button>
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={close} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-slate-600">
                                                {t('community.done')}
                                            </button>
                                            <button type="button" onClick={signOut} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-red-500">
                                                {t('community.signOut')}
                                            </button>
                                        </div>
                                        <button type="button" onClick={() => setDeleting(true)} className="mt-1 self-center text-xs font-medium text-red-400/80 transition-colors hover:text-red-300">
                                            {t('community.deleteAccount')}
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
                            <AuthGate>
                                <p className="text-sm text-emerald-300">{t('community.signedIn')}</p>
                            </AuthGate>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
