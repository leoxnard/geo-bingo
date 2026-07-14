# DESIGN.md — Geo Bingo visual design system

Read this before building or styling any UI. New features must match this design; do not invent new visual patterns when an existing one fits.

## Identity in one paragraph

Dark, playful **glassmorphism over a deep slate night sky**. Frosted glass panels float above vibrant, slowly drifting color blobs and a faint map graticule, with tiny street-hunt emojis rising in the far background. Accents are an indigo→violet→fuchsia gradient; feedback is springy press-scale, brightness, and a light sheen — never hover-lift. Everything respects `prefers-reduced-motion`.

## Hard rules

1. **No `backdrop-filter`.** The frost is faked with layered translucent gradients + a 1px edge-lit inset highlight (see `.glass` in `app/globals.css`). Blur is only ever applied to background blobs themselves (`.glass-blob`), never as a backdrop filter. This is a deliberate performance decision — do not "upgrade" to real backdrop blur.
2. **Reuse the kit, don't restyle.** Panels, buttons, toggles, sliders, dropdowns already exist. Check `components/utils/Elements.tsx` and the CSS utilities below before writing new styles.
3. **Every animation must be disabled under `@media (prefers-reduced-motion: reduce)`.** Add your new animation class to the existing reduced-motion blocks in `globals.css`.
4. **No vertical hover movement.** Buttons and cards stay put. Feedback = `active` press-scale (`.press`), `hover:brightness-125`, sheen (`.btn-sheen`), or shadow/brightness (`.card-lift`). Small icon buttons may use `hover:scale-105 active:scale-95`.
5. **Dark only.** `color-scheme: dark`, background `#0f172a` (slate-900). There is no light theme.

## Color

- **Canvas:** slate-900 `#0f172a` body; deepest shadow tone slate-950 `#020617`.
- **Primary accent:** indigo → violet (→ fuchsia for hero CTAs): `bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500`. Single-color accent = `indigo-400/500` (focus rings, active states, checked toggles, highlighted values).
- **Secondary/special accent:** warm amber→orange gradient with dark `text-slate-900` (e.g. Daily-Challenge CTA). Use sparingly for one standout action per screen.
- **Destructive:** rose→red gradient (`from-rose-500/80 to-red-600/75`) with rose-tinted shadow.
- **Text:** white for primary, `text-slate-300` for labels, `text-slate-400` for secondary/descriptions, `text-slate-500` for faint metadata. Hover often brightens slate → white.
- **Borders:** always translucent white — `border-white/10` (dividers), `/15` (panels), `/25` (colored buttons).
- **Ambience blobs:** indigo-600, fuchsia-500, cyan-400, amber-400 at low opacity, `blur(70px)`.

## Glass surface kit (`app/globals.css`)

| Class | Use for |
|---|---|
| `.glass` | Standard frosted panel/card/pill on the page background |
| `.glass-dark` | HUD panels/buttons floating over live imagery (Street View, maps) — more opaque so it reads against bright skies |
| `.glass-inset` | Recessed wells: segmented-control tracks, slider troughs, input containers |
| `GlassAmbience` component | The shared page background (blobs + graticule + emoji drifters). Render once per page behind content: `components/utils/GlassAmbience.tsx` |

Colored (non-glass) buttons get gradient fills plus the signature shadow recipe: a colored drop shadow matching the fill + a top inner highlight, e.g. `shadow-[0_16px_32px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]`. The top `inset 0 1px 0 rgba(255,255,255,…)` highlight is the "edge-lit" signature — keep it on any new raised surface.

## Shape & spacing

- Radii: `rounded-3xl` for large panels, `rounded-xl`/`rounded-2xl` for cards, buttons, and control tracks, `rounded-lg` for inner elements (slider knobs, dropdown items), `rounded-full` for pills/chips, `rounded-md` for square 12×12 icon buttons.
- Panel padding: `p-4` mobile / `p-8` desktop on major panels; controls sit in sections separated by `border-t border-white/10` with `py-3`.
- Section labels: `font-bold text-xl text-slate-300`; values shown `font-black text-indigo-400 tabular-nums`; descriptions `text-xs text-slate-400 text-center`.
- Hero CTAs: `font-bold tracking-wide uppercase`.

## Motion

- Entrances: `.animate-fade-in-up` (0.35s) and `.animate-pop-in` (0.3s), optionally staggered via `animationDelay`.
- Ambient: blob drift (19–26s), chip float (7s), emoji drift (40–70s, opacity ≤ 0.13) — long, slow, low-opacity. Ambient motion must never be busy or attention-grabbing.
- Interactive: `.press` (springy scale 0.96 on `:active`), `.btn-sheen` (light sweep on hover), `.card-lift` (shadow + brightness on hover, pointer devices only).
- Sliding indicators (segmented controls) animate with `transition-all duration-300 ease-in-out`; color changes with `transition-colors duration-200`.

## Existing components — use these first

`components/utils/Elements.tsx`: `ToggleSwitch`, `ToggleButton` (2-way segmented), `MultiToggleButton` (n-way / grid segmented with sliding indicator), `RangeSlider`, `Selection` (portal-based styled dropdown — never use native `<select>`), `InfoHint` (tooltip badge), `FullscreenButton`, `ExitButton`, `CoverageToggleButton`, `MaskIcon` (monochrome SVG via CSS mask so it inherits `currentColor`), `GeoBingoLogo`.

Host-controlled active states use the indigo→violet gradient; non-host (read-only) states use neutral `bg-white/10`.

Icons: `react-icons/fa` or inline stroke SVGs (`strokeWidth 2.5, round caps`); custom glyphs go through `MaskIcon` from `/public/icons`.

Notifications: `react-hot-toast`. Tooltips/dropdown menus over glass panels must portal to `document.body` (glass panels create stacking contexts that trap z-index — see the `Selection` comment).

## Checklist for a new feature UI

- [ ] Panel uses `.glass` (or `.glass-dark` over imagery), `rounded-2xl/3xl`, translucent white border
- [ ] Page background uses `GlassAmbience` (or the screen sits inside one that has it)
- [ ] Accents are indigo/violet; only one amber standout max per screen
- [ ] Text hierarchy: white / slate-300 / slate-400 / slate-500
- [ ] Feedback: press/sheen/brightness — no hover translate
- [ ] New animations added to the reduced-motion disable blocks
- [ ] Reused `Elements.tsx` controls instead of new ones
- [ ] No `backdrop-filter`, no native `<select>`, no light-mode styles
