/*
================================================================================
AI PROMPT LOCATION CONTEXT
================================================================================
Turns the lobby's map configuration into a plain-language block the AI category
generator can read. Two sources, both opt-in via the lobby checkbox:

  - Starting point: reverse-geocoded to a real postal address. Raw coordinates
    are useless to the model — it cannot reason about "52.51, 13.40", but it
    knows a great deal about "Pariser Platz, Berlin, Germany".
  - Boundaries: only the ones that came from a boundary preset, which carry a
    `name` (see handlePresetChange in LobbyMap). Hand-drawn polygons are just
    anonymous points on a map, so naming them would tell the model nothing.
================================================================================
*/

import type { BoundaryPolygon } from '../utils/types';

/**
 * Full postal address for a point, or null when the lookup fails or the key is
 * missing. Best-effort by design: the context block is a prompt nicety, so a
 * failed geocode degrades to "no address" rather than blocking generation.
 */
export async function reverseGeocodeAddress(lat: number, lng: number): Promise<string | null> {
    const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!mapsKey) return null;

    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = (await res.json()) as { results?: { formatted_address?: string }[] };
        // results[0] is the most specific match Google has for the point.
        return data.results?.[0]?.formatted_address?.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Names of the preset-derived boundaries, deduped and split by allow/forbid.
 * Hand-drawn polygons (no `name`) and the world-default sentinel are skipped.
 */
export function namedBoundaries(gameBoundary: string): { allow: string[]; forbid: string[] } {
    const out = { allow: [] as string[], forbid: [] as string[] };
    if (!gameBoundary || gameBoundary === '[]') return out;

    let parsed: BoundaryPolygon[];
    try {
        parsed = JSON.parse(gameBoundary);
    } catch {
        return out;
    }
    if (!Array.isArray(parsed)) return out;

    for (const b of parsed) {
        const name = b?.name?.trim();
        if (!name || !b.points?.length) continue;
        const bucket = b.type === 'forbid' ? out.forbid : out.allow;
        if (!bucket.includes(name)) bucket.push(name);
    }
    return out;
}

/** True when there is any context worth offering the host a checkbox for. */
export function hasPromptContext(startingPoint: string, gameBoundary: string): boolean {
    const { allow, forbid } = namedBoundaries(gameBoundary);
    return (startingPoint !== '' && startingPoint !== 'open-world') || allow.length > 0 || forbid.length > 0;
}

/**
 * The prompt block itself, or '' when nothing resolved. Async because the
 * address needs a geocode round-trip.
 */
export async function buildPromptContext(startingPoint: string, gameBoundary: string): Promise<string> {
    const lines: string[] = [];

    if (startingPoint && startingPoint !== 'open-world') {
        try {
            const { lat, lng } = JSON.parse(startingPoint);
            const address = await reverseGeocodeAddress(lat, lng);
            if (address) lines.push(`- Players start at: ${address}`);
        } catch {
            // Unparseable starting point — fall through with no address line.
        }
    }

    const { allow, forbid } = namedBoundaries(gameBoundary);
    if (allow.length > 0) lines.push(`- Players are confined to these areas: ${allow.join(', ')}`);
    if (forbid.length > 0) lines.push(`- These areas are off-limits: ${forbid.join(', ')}`);

    if (lines.length === 0) return '';

    return `
PLAY AREA — the categories must be findable here. Lean on what you know about this specific place (its architecture, vehicles, signage, vegetation, street furniture) and prefer items that are characteristic of it over generic worldwide filler:
${lines.join('\n')}
`;
}
