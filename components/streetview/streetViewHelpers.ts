/*
================================================================================
STREET VIEW HELPERS
================================================================================
Shared constants and pure helpers used across the Street View sub-components
(map panel, checklist, bingo board). Keeping them in one place avoids
duplicating the layout sizing, category-hint lookup and Street View image URL
building logic across the presentational components.
================================================================================
*/

import { geoGuessrMeta } from '../../lib/categories';
import { Locale } from '../../lib/i18n/locales';
import { Submission } from '../utils/types';

export type HintMap = Record<string, string>;

export const safeStartCenter = { lat: 30, lng: 10 };
export const initialWorldZoom = 2.4;

export const ROOMY_MAX = 90;
export const ROOMY_MIN = 67;
export const COMPACT_MAX = 48;
export const COMPACT_MIN = 33;
export const ROOMY_GAP = 12;
export const COMPACT_GAP = 8;

export const panoOptions = {
    addressControl: false,
    showRoadLabels: false,
    enableCloseButton: false,
    fullscreenControl: false,
    zoomControl: false,
    panControl: false,
    linksControl: false,
};

// Find the region hint for a category. The board category can be in any
// language, so we search every localized term and return the hint in the same
// language it matched.
export const getHintForCategory = (cat: string) => {
    for (const meta of geoGuessrMeta) {
        for (const lang of Object.keys(meta.term) as (keyof typeof meta.term)[]) {
            if (meta.term[lang] === cat) return meta.term_hint[lang];
        }
    }
    return null;
};

// Build a category-name -> hint lookup for the active locale from a preset's
// per-locale hint translations (aligned to the canonical `categories` order).
// Keying by name (not index) keeps hints correct even when the board is shuffled
// (bingo) or reordered, which a positional lookup would get wrong.
export const buildHintMap = (categories: string[], hintTranslations: Record<string, string[]>, locale: Locale): HintMap => {
    const localeHints = hintTranslations[locale];
    if (!Array.isArray(localeHints)) return {};
    const map: HintMap = {};
    categories.forEach((cat, i) => {
        const hint = localeHints[i];
        if (typeof hint === 'string' && hint.trim()) map[cat] = hint.trim();
    });
    return map;
};

// Resolve a category's hint: prefer the preset's translated hint, then fall back
// to the built-in geoGuessrMeta region hint.
export const resolveHint = (category: string, hintMap: HintMap): string | null => hintMap[category] ?? getHintForCategory(category);

export const getAiVerdictState = (submission?: Submission | null) => {
    if (submission?.ai_verdict === true) return 'verified';
    if (submission?.ai_verdict === false) return 'rejected';
    return 'unverified';
};

// Builds the static Street View image URL for a saved camera angle. Accepts any
// object carrying a viewpoint (a game Submission or a community CommunityCategory).
export const getStreetViewImageUrl = (sub: { lat: number; lng: number; heading: number; pitch: number; zoom: number }, size = 600) => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
    const fov = sub.zoom ? 180 / Math.pow(2, sub.zoom) : 90;
    let safeHeading = sub.heading % 360;
    if (safeHeading < 0) safeHeading += 360;
    return `https://maps.googleapis.com/maps/api/streetview?size=${size}x${size}&location=${sub.lat},${sub.lng}&heading=${safeHeading}&pitch=${sub.pitch}&fov=${fov}&key=${apiKey}`;
};
