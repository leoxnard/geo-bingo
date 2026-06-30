'use client';

/*
================================================================================
OPTIONS BUTTON
================================================================================
The gear menu on every pre-game + community surface (landing page, lobby, daily
hub, community browse/builder). It opens a small panel with account controls, UI
language and master audio volume. Adding a new option later means adding one row
here (and a field in SettingsProvider) — account / language / volume are
independent rows, not a fixed set.

Position is `fixed` to the viewport top-right by default so it lands in exactly
the same spot on every page regardless of that page's layout (overridable via
`className`). Pairing fixed with `scrollbar-gutter: stable` on <html> (globals.css)
keeps it from shifting when a scrollbar appears. The dropdown stays mounted while
closed (just hidden) so the account section is already loaded the instant the
menu is opened — no flash of an empty account row.
================================================================================
*/

import { useEffect, useRef, useState } from 'react';

import { FaCog } from 'react-icons/fa';

import AccountButton from '@/components/account/AccountButton';
import { useT } from '@/lib/i18n/I18nProvider';
import { LOCALE_CODES, LOCALES } from '@/lib/i18n/locales';
import { useSettings } from '@/lib/settings/SettingsProvider';

export default function OptionsButton({ className = 'fixed top-3 right-3 z-[1000]', onRenamed }: { className?: string; onRenamed?: () => void }) {
    const { t, locale, setLocale } = useT();
    const { settings, setSetting } = useSettings();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    const volumePct = Math.round(settings.volume * 100);

    return (
        <div ref={ref} className={className}>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} aria-label={t('options.title')} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-white">
                <FaCog size={18} />
            </button>

            {/* Kept mounted while closed (just hidden) so the async account row is
                already loaded by the time the menu is first opened. */}
            <div role="dialog" aria-label={t('options.title')} hidden={!open} className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-600 bg-slate-800 p-4 shadow-xl">
                {/* Account */}
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{t('options.account')}</p>
                <div className="mb-4">
                    <AccountButton className="w-full justify-center" onRenamed={onRenamed} />
                </div>

                {/* UI language */}
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{t('options.language')}</p>
                <div className="mb-4 flex flex-col gap-1">
                    {LOCALE_CODES.map((code) => {
                        const item = LOCALES[code];
                        const selected = code === locale;
                        return (
                            <button key={code} type="button" aria-pressed={selected} onClick={() => setLocale(code)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-700 ${selected ? 'bg-slate-700/60 text-white' : 'text-slate-300'}`}>
                                <span className="text-base leading-none">{item.flag}</span>
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Audio volume */}
                <label htmlFor="options-volume" className="mb-1.5 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                    <span>{t('options.volume')}</span>
                    <span className="text-slate-500">{volumePct}%</span>
                </label>
                <input id="options-volume" type="range" min={0} max={100} value={volumePct} onChange={(e) => setSetting('volume', Number(e.target.value) / 100)} className="w-full accent-indigo-500" />
            </div>
        </div>
    );
}
