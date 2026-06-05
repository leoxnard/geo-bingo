/*
================================================================================
TRANSLATE (server-safe)
================================================================================
The pure string-lookup used by both the client `useT()` hook (I18nProvider) and
server components. It lives in its own module — with NO 'use client' directive —
so server components (e.g. the landing page's SEO/how-to-play section) can call
it during server render without pulling in the client context.
================================================================================
*/

import { DEFAULT_LOCALE, Locale } from './locales';
import { messages, MessageKey } from './messages';

type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
    const dict = messages[locale] ?? messages[DEFAULT_LOCALE];
    let str: string = dict[key] ?? messages[DEFAULT_LOCALE][key] ?? key;
    if (vars) {
        for (const name of Object.keys(vars)) {
            str = str.split(`{${name}}`).join(String(vars[name]));
        }
    }
    return str;
}
