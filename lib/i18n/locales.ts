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
`language === 'english'` keep working. It also doubles as the value stored in
the game's `language` column (the shared board language).
================================================================================
*/

export const LOCALES = {
    de: { label: 'Deutsch', flag: '🇩🇪', aiName: 'german' },
    en: { label: 'English', flag: '🇬🇧', aiName: 'english' },
    es: { label: 'Español', flag: '🇪🇸', aiName: 'spanish' },
    fr: { label: 'Français', flag: '🇫🇷', aiName: 'french' },
    zh: { label: '中文', flag: '🇨🇳', aiName: 'chinese' },
} as const;

export type Locale = keyof typeof LOCALES;

/** The lowercase language word the AI prompts + game.language column use. */
export type CategoryLanguage = (typeof LOCALES)[Locale]['aiName'];

export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];

export const DEFAULT_LOCALE: Locale = 'de';

/** Name of the cookie that persists the user's UI language across requests. */
export const LOCALE_COOKIE = 'locale';

/** True if the given string is a supported locale code. */
export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && value in LOCALES;
}

const AI_NAME_TO_LOCALE: Record<string, Locale> = Object.fromEntries(LOCALE_CODES.map((code) => [LOCALES[code].aiName, code])) as Record<string, Locale>;

/**
 * Coerce any stored/legacy language value into a supported Locale code.
 * Accepts both the locale codes ("de"/"en"/…) and the category-language words
 * ("german"/"english"/…) that game rows store in their `language` column.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
    if (isLocale(value)) return value;
    if (value && value in AI_NAME_TO_LOCALE) return AI_NAME_TO_LOCALE[value];
    return DEFAULT_LOCALE;
}

/** The lowercase language word the AI prompts expect for a given locale. */
export function aiLanguageName(locale: Locale): CategoryLanguage {
    return LOCALES[locale].aiName;
}

/**
 * The game's category-generation language for a given UI locale. The board's
 * category language is recorded per-game (shared by all players). German and
 * English additionally have local word databases for the "Fill Up" feature;
 * other languages fall back to the English word DB but still generate AI
 * categories in their own language.
 */
export function categoryLanguageForLocale(locale: Locale): CategoryLanguage {
    return LOCALES[locale].aiName;
}

/** localStorage key remembering the host's last-chosen board category language. */
export const CATEGORY_LANGUAGE_STORAGE_KEY = 'geoBingoCategoryLanguage';

const CATEGORY_LANGUAGES = LOCALE_CODES.map((code) => LOCALES[code].aiName) as CategoryLanguage[];

/** True if the given string is a valid category language. */
export function isCategoryLanguage(value: unknown): value is CategoryLanguage {
    return typeof value === 'string' && (CATEGORY_LANGUAGES as string[]).includes(value);
}

/**
 * The category language a new game should default to: the host's last-chosen
 * board language (persisted in localStorage), falling back to the one derived
 * from the current UI locale when nothing has been chosen before.
 */
export function defaultCategoryLanguage(locale: Locale): CategoryLanguage {
    if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(CATEGORY_LANGUAGE_STORAGE_KEY);
        if (isCategoryLanguage(stored)) return stored;
    }
    return categoryLanguageForLocale(locale);
}

/** Persist the host's chosen board category language for future new games. */
export function storeCategoryLanguage(lang: CategoryLanguage): void {
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(CATEGORY_LANGUAGE_STORAGE_KEY, lang);
    }
}

/**
 * Pick the best supported locale from an Accept-Language header (the user's
 * device/browser language), e.g. "en-US,en;q=0.9,de;q=0.8". Matches on the
 * primary subtag in the browser's preference order. Returns null if none match,
 * so the caller can fall back to DEFAULT_LOCALE.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
    if (!header) return null;
    const ranked = header
        .split(',')
        .map((part) => {
            const [tag, ...params] = part.trim().split(';');
            const q = params.find((p) => p.trim().startsWith('q='));
            const quality = q ? parseFloat(q.split('=')[1]) : 1;
            return { primary: tag.split('-')[0].toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
        })
        .sort((a, b) => b.quality - a.quality);

    for (const { primary } of ranked) {
        if (isLocale(primary)) return primary;
    }
    return null;
}
