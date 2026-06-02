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

import { GeoGuessrMetaDe, GeoGuessrMetaEn } from '../../lib/categories';
import { Submission } from '../utils/types';

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

// Hilfsfunktion, um den Hint für eine Kategorie aus der Datenbank zu fischen
export const getHintForCategory = (cat: string) => {
    const foundDe = GeoGuessrMetaDe?.find((item) => item.term === cat);
    if (foundDe) return foundDe.term_hint;
    const foundEn = GeoGuessrMetaEn?.find((item) => item.term === cat);
    if (foundEn) return foundEn.term_hint;
    return null;
};

export const getAiVerdictState = (submission?: Submission | null) => {
    if (submission?.ai_verdict === true) return 'verified';
    if (submission?.ai_verdict === false) return 'rejected';
    return 'unverified';
};

// Builds the static Street View image URL for a submission's saved camera angle.
export const getStreetViewImageUrl = (sub: Submission, size = 600) => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
    const fov = sub.zoom ? 180 / Math.pow(2, sub.zoom) : 90;
    let safeHeading = sub.heading % 360;
    if (safeHeading < 0) safeHeading += 360;
    return `https://maps.googleapis.com/maps/api/streetview?size=${size}x${size}&location=${sub.lat},${sub.lng}&heading=${safeHeading}&pitch=${sub.pitch}&fov=${fov}&key=${apiKey}`;
};
