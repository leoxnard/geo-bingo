/*
================================================================================
SERVER LOCALE
================================================================================
Resolves the active UI locale during server render. The user's saved choice
(cookie) wins; otherwise we fall back to the device / browser language from the
Accept-Language header, then the default locale. Used by the root layout (to set
<html lang> and seed the client provider) and by server components that need to
render translated content in the initial HTML (e.g. the landing page).
================================================================================
*/

import { cookies, headers } from 'next/headers';

import { DEFAULT_LOCALE, isLocale, Locale, LOCALE_COOKIE, localeFromAcceptLanguage } from './locales';

export async function getServerLocale(): Promise<Locale> {
    const cookieStore = await cookies();
    const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isLocale(savedLocale)) return savedLocale;

    const headerStore = await headers();
    return localeFromAcceptLanguage(headerStore.get('accept-language')) ?? DEFAULT_LOCALE;
}
