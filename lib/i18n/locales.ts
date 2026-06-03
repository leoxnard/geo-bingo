/*
================================================================================
LOCALE REGISTRY
================================================================================
The single source of truth for every language the app supports.

To add a new language:
  1. Add an entry below (code → label / flag / aiName).
  2. Create lib/i18n/messages/<code>.ts (copy en.ts, translate the values).
  3. Register it in lib/i18n/messages/index.ts.
TypeScript will then flag any keys you forgot to translate.

`aiName` is the lowercase language word handed to the AI category-generation
prompts (e.g. "german"). Keep it lowercase so prompt checks like
`language === 'english'` keep working.
================================================================================
*/

export const LOCALES = {
    de: { label: 'Deutsch', flag: '🇩🇪', aiName: 'german' },
    en: { label: 'English', flag: '🇬🇧', aiName: 'english' },
} as const;

export type Locale = keyof typeof LOCALES;

export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];

export const DEFAULT_LOCALE: Locale = 'de';

/** Name of the cookie that persists the user's UI language across requests. */
export const LOCALE_COOKIE = 'locale';

/** True if the given string is a supported locale code. */
export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && value in LOCALES;
}

/**
 * Coerce any stored/legacy language value into a supported Locale code.
 * Accepts both the new locale codes ("de"/"en") and the legacy category-language
 * words ("german"/"english") that older game rows still hold.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
    if (isLocale(value)) return value;
    if (value === 'german') return 'de';
    if (value === 'english') return 'en';
    return DEFAULT_LOCALE;
}

/** The lowercase language word the AI prompts expect for a given locale. */
export function aiLanguageName(locale: Locale): string {
    return LOCALES[locale].aiName;
}

/**
 * The game's category-generation language for a given UI locale. The board's
 * category language is recorded per-game (shared by all players) and currently
 * supports German/English word databases + AI prompts. New UI locales fall back
 * to English generation until a matching word DB is added.
 */
export function categoryLanguageForLocale(locale: Locale): 'german' | 'english' {
    return locale === 'de' ? 'german' : 'english';
}
