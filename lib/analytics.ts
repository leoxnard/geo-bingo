/*
================================================================================
ANALYTICS
================================================================================
The single seam between the app and Umami, our self-hosted analytics. Umami runs
as a separate service on the same machine as the app, so nothing here ever
leaves our own infrastructure — that is the promise the privacy policy makes.

Everything is opt-in through env vars: without NEXT_PUBLIC_UMAMI_SRC and
NEXT_PUBLIC_UMAMI_WEBSITE_ID the <Analytics> script never mounts and `track()`
degrades to a no-op, which is the normal state in local dev. Call sites
therefore never need to guard.

RULE — never put personal data in an event. No player names, no game ids, no
player_id / device_id / auth.uid(). Only counters and low-cardinality category
values. An event that would let you single out a person does not belong here.
================================================================================
*/

export const UMAMI_SRC = process.env.NEXT_PUBLIC_UMAMI_SRC;
export const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

// Comma-separated host allow-list handed to the tracker. One Umami instance
// serves several sites, so this is what keeps a preview deploy — or a second
// subdomain that happens to reuse the same website id — out of these stats.
// Unset means "count every host the app is served from".
export const UMAMI_DOMAINS = process.env.NEXT_PUBLIC_UMAMI_DOMAINS;

export const isAnalyticsEnabled = Boolean(UMAMI_SRC && UMAMI_WEBSITE_ID);

type EventData = Record<string, string | number | boolean>;

declare global {
    interface Window {
        umami?: {
            track: (event: string, data?: EventData) => void;
        };
    }
}

/**
 * Records a custom event. Silently does nothing when analytics is disabled, the
 * script hasn't loaded yet, or an ad blocker removed it.
 */
export const track = (event: string, data?: EventData): void => {
    if (typeof window === 'undefined' || !window.umami) return;
    try {
        window.umami.track(event, data);
    } catch {
        // Analytics must never break gameplay — a failed measurement is worth
        // strictly less than the action the player was in the middle of.
    }
};
