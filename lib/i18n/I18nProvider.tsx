'use client';

/*
================================================================================
I18N PROVIDER
================================================================================
Holds the active UI locale and exposes the `t()` translation function through
React context. The initial locale is read server-side from a cookie (see
app/layout.tsx) so the first paint already matches the user's choice — no
hydration flash. `setLocale` persists the choice to a cookie + localStorage and
updates <html lang> live.
================================================================================
*/

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { LOCALE_COOKIE, Locale } from './locales';
import { MessageKey } from './messages';
import { translate } from './translate';

type Vars = Record<string, string | number>;

export type TranslateFn = (key: MessageKey, vars?: Vars) => string;

interface I18nContextValue {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Re-exported for callers that still import `translate` from here.
export { translate };

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(initialLocale);

    const setLocale = useCallback((next: Locale) => {
        setLocaleState(next);
        if (typeof document !== 'undefined') {
            // 1 year, lax — readable by the server layout on the next request.
            document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
            document.documentElement.lang = next;
        }
        try {
            localStorage.setItem(LOCALE_COOKIE, next);
        } catch {
            /* private mode / storage disabled — cookie is enough */
        }
    }, []);

    const t = useCallback<TranslateFn>((key, vars) => translate(locale, key, vars), [locale]);

    const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useT must be used within an I18nProvider');
    return ctx;
}
