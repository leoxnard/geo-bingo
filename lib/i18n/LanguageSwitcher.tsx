'use client';

/*
================================================================================
LANGUAGE SWITCHER
================================================================================
Global UI-language selector. Mounted absolutely at the top-right of every page
via the root layout (scrolls with the page rather than staying pinned), so it is
available even before a game exists. Changing it only affects THIS user's
interface (and the default category language when they host a new game) — it
never overrides other players.
================================================================================
*/

import { useEffect, useRef, useState } from 'react';

import { useT } from './I18nProvider';
import { LOCALE_CODES, LOCALES } from './locales';

export default function LanguageSwitcher() {
    const { locale, setLocale } = useT();
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

    const active = LOCALES[locale];

    return (
        <div ref={ref} className="absolute top-3 right-3 z-50">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-2 text-sm font-medium text-white shadow-lg backdrop-blur transition-colors hover:border-slate-500 hover:bg-slate-700">
                <span className="text-base leading-none">{active.flag}</span>
                <span className="hidden sm:inline">{active.label}</span>
            </button>

            {open && (
                <ul role="listbox" className="absolute right-0 mt-2 w-44 overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-xl">
                    {LOCALE_CODES.map((code) => {
                        const item = LOCALES[code];
                        const selected = code === locale;
                        return (
                            <li key={code}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    onClick={() => {
                                        setLocale(code);
                                        setOpen(false);
                                    }}
                                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-700 ${selected ? 'bg-slate-700/60 text-white' : 'text-slate-300'}`}
                                >
                                    <span className="text-base leading-none">{item.flag}</span>
                                    <span>{item.label}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
