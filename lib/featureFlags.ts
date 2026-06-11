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

    /**
     * Bingo grid game mode (classic list ↔ bingo grid). When `false` the toggle
     * is removed and only the list mode is offered.
     */
    bingoMode: true,

    /**
     * Win condition for bingo games (first bingo ↔ full time). When `false` the
     * toggle is removed (only ever relevant in bingo mode).
     */
    winCondition: true,

    /**
     * Exclusive categories (the first player to claim a category locks it for the
     * others). When `false` the lobby toggle is removed and every game stays
     * non-exclusive — even if an imported preset asked for exclusive mode.
     */
    exclusiveCategories: false,

    // ── Lobby sidebar toggles ────────────────────────────────────────────────

    /**
     * The "hide minimap" toggle. When `false` the toggle is removed and the
     * in-game minimap is always shown.
     */
    hideMiniMap: false,

    /**
     * The "AI verify to end the round" toggle. When `false` the toggle is removed
     * and AI auto-ending is always off.
     */
    aiVerifyEndGame: true,

    // ── Category sources (LobbyCategories) ───────────────────────────────────

    /**
     * AI-powered category sources. Manual entry is always available; a disabled
     * source is removed from the picker (and treated as manual if it was set).
     */
    categorySources: {
        ai: true,
        nearbyPlaces: false,
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
} as const;
