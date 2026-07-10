/*
================================================================================
FEATURE FLAGS
================================================================================
Compile-time switches to completely hide optional features. Flip a value to
`false` to remove the feature everywhere — its setting control disappears from
the lobby and the game behaves as if the feature were off. Flip back to `true`
to restore it. Intentionally plain constants (no env var needed).
================================================================================
*/

export const FEATURES = {
    // ── Lobby game settings (LobbySettings) ──────────────────────────────────

    /** Bingo grid game mode (list ↔ grid). Off → only list mode. */
    bingoMode: true,

    /** Win condition toggle for bingo games (first bingo ↔ full time). */
    winCondition: true,

    /** Scale voting (rate 0–10 instead of yes/no/hype). List mode only. Off → only yes/no voting. */
    scaleVoting: true,

    /** Exclusive categories (first claimer locks a category). Off → always non-exclusive. */
    exclusiveCategories: false,

    // ── Lobby sidebar toggles ────────────────────────────────────────────────

    /** "Hide map symbols (POIs)" toggle. Off → POIs always shown. */
    hideMapSymbols: true,

    /** "Hide minimap" toggle. Off → minimap always shown. */
    hideMiniMap: false,

    /** "AI verify to end the round" toggle. Off → AI auto-ending always off. */
    aiVerifyEndGame: true,

    // ── Category sources (LobbyCategories) ───────────────────────────────────

    /** AI category sources. Manual is always available; a disabled source is treated as manual. */
    categorySources: {
        ai: true,
        nearbyPlaces: true,
        nearbyStreetView: true,
    },

    // ── Built-in word databases (manual "fill up" picker) ────────────────────

    /** Which built-in word databases appear in the manual fill-up dropdown. */
    categoryDatabases: {
        balanced: true,
        easy: true,
        hard: true,
        geo_all: true,
        geo_Vehicle: true,
        geo_Camera: true,
        geo_Infrastructure: true,
        geo_Nature: true,
        geo_Plate: true,
        geo_Marking: true,
    },

    /** Let non-host players suggest categories (and show the suggestions panel). */
    categorySuggestions: true,

    /**
     * Community word pool: the lobby "Explore" overlay for browsing words
     * harvested from finished games (hosts add, non-hosts suggest) and the
     * /admin/words review page. Off → the Explore button and the admin route
     * disappear. Note: the SQL harvest trigger keeps collecting words either
     * way (compile-time flags can't reach Postgres) — harmless, since
     * unapproved words are invisible and the pool simply goes unused.
     */
    exploreWords: true,

    // ── Daily Challenge ──────────────────────────────────────────────────────

    /**
     * Daily Challenge: one global category per day, a stopwatch race, a global
     * leaderboard and persistent account stats. Off → the home button, the /daily
     * and /admin/daily routes, and game-submission harvesting all disappear.
     */
    dailyChallenge: true,

    // ── Player profiles & friends ────────────────────────────────────────────

    /**
     * Persistent player profile: per-account game history, win-rate, categories
     * found (+ stored find coordinates for a future heatmap) and a friends list
     * with one-tap invites. Off → the /account route, its options-menu link and
     * the podium result-recording all disappear; nothing new is persisted.
     */
    playerProfiles: true,

    /**
     * Invite a friend straight into the current lobby. The invitee gets a realtime
     * toast with a Join button plus an invitations button next to the options gear.
     * Requires an account, so it also implies playerProfiles. Off → the lobby
     * "invite a friend" button, the invitations button and all invite realtime
     * disappear. Invitations are valid for 2 minutes.
     */
    gameInvites: true,

    // ── Admin tools ──────────────────────────────────────────────────────────

    /**
     * /admin/presets route (allow-listed admins only): draw boundary areas on
     * a map and export them as a JSON snippet for MANUAL_OVERRIDES in
     * scripts/getProcessedCountryBorders.py. Off → the route 404s.
     */
    presetExport: true,
} as const;
