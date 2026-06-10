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
    /**
     * The lobby "hide minimap" toggle. When `false` the toggle is removed and the
     * in-game minimap is always shown.
     */
    hideMiniMap: true,

    /**
     * Exclusive categories (the first player to claim a category locks it for the
     * others). When `false` the lobby toggle is removed and every game stays
     * non-exclusive — even if an imported preset asked for exclusive mode.
     */
    exclusiveCategories: true,
} as const;
