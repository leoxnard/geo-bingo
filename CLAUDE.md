# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this project is

**Geo BingBong** — a real-time multiplayer scavenger hunt played inside Google Street View.
A host opens a lobby, picks a map area and a set of categories ("a red car", "a funny sign"),
players hunt in Street View and capture finds, then everyone votes on each other's submissions
and a podium is shown. There is also a single-player **Daily Challenge** (one global category
per day, stopwatch race, worldwide leaderboard), **community presets**, **player profiles /
friends / invites**, and an **admin** area for curating daily challenges and the word pool.

Next.js App Router frontend + Supabase (Postgres, RLS, Realtime, pg_cron) backend.
There is no separate backend service — all server logic lives in Postgres functions plus a
handful of Next.js route handlers that proxy third-party APIs.

## Commands

```bash
npm run dev        # next dev --webpack (port 3000)
npm run build      # production build
npm run lint       # eslint . --max-warnings 0   ← must pass; warnings are errors
npm run lint:fix   # eslint --fix
npm run generate:schema   # supabase db dump --schema public -f supabase/schema.sql (needs Docker)
```

There is **no test suite** — no Jest/Vitest/Playwright, no `*.test.ts` files, no CI workflow.
Verification means: `npm run lint` and `npm run build` pass, plus manual play-testing.
For a build that must not clobber a running dev server's output, set `NEXT_DIST_DIR`
(e.g. `NEXT_DIST_DIR=.next-verify npm run build` — `.next-verify/` is gitignored).

Git hooks (husky):

- `pre-commit` → `lint-staged`: prettier (`--tab-width 4`) + `eslint --fix` on staged TS/TSX.
- `pre-push` → requires Docker and re-runs `npm run generate:schema`. **If Docker isn't
  available in your environment, `git push --no-verify` is the only way through** — say so
  rather than silently skipping the hook.

## Environment

`.env.local` (never committed):

| Var | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase client (`lib/supabase.ts` throws at import time if unset) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | yes | Maps JS API, Street View, Places |
| `GEMINI_API_KEY` | yes for AI | Fallback for both tiers |
| `GEMINI_API_KEY_FREE` / `GEMINI_API_KEY_PAID` | optional | Free tier = category generation, paid tier = verification bursts |
| `DEEPL_API_KEY` | optional | Translation fallback in `/api/translate` |
| `APP_ENV` | optional | `production` \| `preview` \| unset. Unset/`production` = indexable; anything else adds `X-Robots-Tag: noindex` (`next.config.ts`). Replaced `VERCEL_ENV` after the move to Coolify |
| `NEXT_PUBLIC_UMAMI_SRC` / `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | optional | Self-hosted Umami analytics. Either unset → tracker never loads and `track()` is a no-op |
| `NEXT_PUBLIC_UMAMI_DOMAINS` | optional | Comma-separated host allow-list for the tracker. Unset → every host is counted. One Umami instance serves several subdomains, so set this per deployment |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | optional | Gates **preview** deploys, i.e. `APP_ENV=preview` (see `proxy.ts`) |

Never add a `NEXT_PUBLIC_` prefix to Gemini or DeepL keys — they are server-only by design and
reach the browser only through the proxies.

## Architecture

```
Browser (React client components)
  ├─ Google Maps JS API / Street View        (direct, referrer-restricted key)
  ├─ /api/gemini    → Gemini    (key injected server-side, model allow-list)
  ├─ /api/translate → DeepL
  ├─ /api/geocode   → OSM Nominatim (boundary polygons; Google doesn't expose these)
  └─ Supabase
       ├─ Realtime channels  (game/player/submission/presence/invite sync)
       └─ SECURITY DEFINER RPCs  (every write path)
```

### The one rule that shapes everything: writes go through RPCs

Row-Level Security blocks direct client `INSERT`/`UPDATE` on game tables. All mutations call
`supabase.rpc(...)` against `SECURITY DEFINER` Postgres functions that validate the caller and
whitelist the columns they may touch. ~70 RPCs exist (`claim_category`, `update_game_settings`,
`set_game_status`, `register_vote`, `join_game`, `submit_daily_attempt`, `send_game_invitation`,
`admin_*`, …). When adding a feature that writes data, **write the RPC first** — do not reach for
`supabase.from('table').update()`.

RPCs return payload objects, not exceptions. Always check both:

```ts
const { data, error } = await supabase.rpc('claim_category', { ... });
if (error || (data && data.success === false)) {
    console.error('claim_category failed:', error || data.error);
    toast.error(t('sv.toastErrorSaving'));
}
```

### Identity model

Three distinct identities, do not conflate them:

- **`player_id`** — per-game player row id, in localStorage. Anonymous play needs nothing else.
- **Host token** (`lib/hostToken.ts`) — high-entropy secret in localStorage, never present in any
  readable row or realtime payload. Host-only RPCs validate it server-side (`is_valid_host`).
  `host_id` is the *public* host player id and is not a credential.
- **`auth.uid()`** — real Supabase account (Twitch OAuth / email). Required for community preset
  authorship, the daily leaderboard, profiles, friends and invites.
- **Device id** (`lib/deviceId.ts`) — anonymous localStorage UUID, used for one-vote-per-device on
  community presets and for anonymous daily attempts.

### Game phase machine

`app/game/[id]/page.tsx` (~1200 lines) is the controller. `status` ∈
`lobby | playing | voting | finished` drives which view renders; the three non-lobby views are
`next/dynamic` code-split so only the lobby ships in the initial bundle.

```
LobbyView → StreetView → VotingView → PodiumView
```

Realtime channels (all in `app/game/[id]/page.tsx` unless noted):
`game-updates-{id}`, `player-updates-{id}`, `game-events-{id}`, `presence-{id}`,
`game-submissions-{id}` (`useSubmissionsRealtime.ts`), `voting-journey-{id}` (`VotingView.tsx`),
`game-invites-{userId}` (`GameInvitesProvider.tsx`).

## Directory map

```
app/                      # App Router routes
  page.tsx                # landing (server component)
  game/[id]/page.tsx      # ★ game controller / phase machine
  daily/, daily/[date]/   # Daily Challenge
  community/              # preset browse + create
  account/                # profile, friends, Twitch linking
  admin/                  # daily, words, presets (allow-listed)
  dev/compare-prompts/    # internal prompt playground
  api/gemini|translate|geocode/route.ts   # server-side proxies
  game/actions.ts, login/actions.ts       # server actions
components/
  lobby/ streetview/ voting/ daily/ community/ account/ admin/ invites/ game/ home/
  VotingView.tsx PodiumView.tsx           # top-level phase views
  utils/                  # types.tsx, Elements.tsx (UI kit), Functions.tsx, mapUtils.tsx,
                          # geminiClient.ts, aiVerify.ts, votes.ts, typeGuards.ts
lib/
  supabase.ts hostToken.ts deviceId.ts featureFlags.ts
  categories.ts daily.ts community.ts wordPool.ts friends.ts invites.ts account.ts twitch.ts
  i18n/                   # I18nProvider, locales.ts, messages/{en,de,es,fr,zh}.ts
  settings/ sound/        # SettingsProvider (localStorage prefs), SoundProvider
supabase/
  schema.sql              # ★ source of truth (~4000 lines) — full dump, tables + RLS + RPCs
  migrations/YYYYMMDD_*.sql   # incremental changes already folded into schema.sql
scripts/                  # country-border preprocessing (Python), word-pool seeding
public/                   # icons (MaskIcon SVGs), sounds, how-to-play images
```

Docs worth reading before you touch things:
`README.md` (features + setup), **`DESIGN.md` (mandatory before any UI work)**,
`.planning/codebase/*.md` (generated architecture notes, dated 2026-06-08 — partly stale,
predates daily/account/admin/invites/word-pool; treat this file and the source as authoritative).

## Database workflow

1. Write the change as `supabase/migrations/YYYYMMDD_<short_description>.sql`.
2. Apply it to the Supabase project.
3. Regenerate the dump: `npm run generate:schema` (needs Docker; the pre-push hook enforces it).

Migrations contain **only** incremental function/policy changes — no `CREATE TABLE` — so they
cannot bootstrap an empty database. `supabase/schema.sql` is the only thing that can.

Core tables: `games`, `players`, `submissions`, `game_host_secrets`, `community_presets`,
`community_preset_votes`, `daily_challenges`, `daily_challenge_candidates`, `daily_attempts`,
`daily_admins`, `word_pool`, `profiles`, `friendships`, `friend_requests`, `game_invitations`,
`account_game_results`.

The daily-challenge scheduler runs in-database via pg_cron at 00:00 UTC. Admin access to
`/admin/*` is gated by the `daily_admins` e-mail allow-list (`am_i_daily_admin` RPC), re-checked
on every admin subpage.

## Feature flags

`lib/featureFlags.ts` exports a plain `FEATURES` const — compile-time switches, no env vars.
Flipping one to `false` must make the feature vanish completely: its lobby control, its routes,
and any persistence. When adding an optional feature, add a flag with a doc comment explaining
what "off" means (including anything the flag *can't* reach, e.g. SQL triggers). Follow the
existing comment style there.

## Internationalization

Five locales: `en`, `de`, `es`, `fr`, `zh`. `DEFAULT_LOCALE` is **`de`**.

- `lib/i18n/messages/en.ts` is the canonical key set; every other file is typed `Messages`, so a
  missing key is a **type error**. Adding a user-visible string means adding it to **all five**.
- Keys are dotted and namespaced by screen: `home.*`, `settings.*`, `sv.*`, `daily.*`, …
- Placeholders are `{name}`, filled via `t('key', { name: value })`.
- Client: `const { t } = useT()`. Server components: `getServerLocale()` + `translate()`.
- Locale persists in a cookie (server-readable, so first paint matches — no hydration flash).
- `LOCALES[x].aiName` (lowercase `"german"`, `"english"`, …) is what AI prompts and the game's
  `language` column use — distinct from the two-letter UI locale code. Don't mix them up.
- Adding a language: entry in `locales.ts` → new `messages/<code>.ts` → register in
  `messages/index.ts`.

**Never hardcode user-facing English in a component.**

## Code style

Enforced by Prettier + ESLint (`--max-warnings 0`), so just run the tools — but the conventions:

- 4-space indent, single quotes, semicolons, trailing commas, print width **500**.
- Import order (auto-fixed): builtin → external (`react` first) → internal `@/…` → relative,
  alphabetized, blank line between groups.
- `@/*` aliases the project root. Prefer `@/lib/...`, `@/components/...` over deep relatives
  (some older files in `app/game/[id]/` still use `../../../lib/...`).
- Components: PascalCase files, default export. Hooks: `use*.ts`, named export.
- `handleX` for handlers, `onX` for callback props, `setX` for setters, `xRef` for refs,
  `is/has/can` for booleans, `SCREAMING_SNAKE_CASE` for module constants.
- Shared types live in `components/utils/types.tsx`; `Props` interfaces sit beside the component.
- **File header comments are the house style.** Every non-trivial module opens with a
  `/* === TITLE === ... === */` block explaining *why* the module exists and the non-obvious
  decisions in it. Match that when creating files; it is the primary documentation in this repo.
  Individual functions get no JSDoc — inline comments explain non-obvious logic only.
- Errors: `console.error` for diagnostics, `toast.error(t('...'))` from `react-hot-toast` for the
  user. Empty catch blocks are acceptable for genuinely optional work — add a comment saying why.

## UI conventions

Read `DESIGN.md` before writing any UI. The short version:

- Dark-only glassmorphism. **No `backdrop-filter`** — the frost is faked with layered gradients
  (`.glass`, `.glass-dark`, `.glass-inset` in `app/globals.css`). This is deliberate; don't
  "upgrade" it.
- Reuse `components/utils/Elements.tsx` (`ToggleSwitch`, `ToggleButton`, `MultiToggleButton`,
  `RangeSlider`, `Selection`, `InfoHint`, `MaskIcon`, …) instead of new controls. Never a native
  `<select>` — use `Selection`. Tooltips/menus over glass must portal to `document.body`.
- Accents indigo→violet→fuchsia; amber only for one standout action per screen.
- No hover-lift/translate; feedback is `.press`, `hover:brightness-125`, `.btn-sheen`.
- Every new animation must also be disabled in the `prefers-reduced-motion` blocks in
  `globals.css`.
- Page backgrounds render `GlassAmbience` once.
- Button click sounds are wired globally by `SoundProvider` via a document listener — opt out with
  `data-sound="none"`, swap with `data-sound="<name>"`.

## AI (Gemini) usage

- Client code never talks to Gemini directly: `components/utils/geminiClient.ts` → `/api/gemini`.
- `withModelFallback` walks `GEMINI_MODELS` (strongest first) and remembers the last working model
  per tier in localStorage, for rate-limit resilience.
- `GEMINI_MODELS` must stay a **subset** of `ALLOWED_MODELS` in `app/api/gemini/route.ts`, or
  calls 400.
- Tier selection matters: `'free'` for category generation, `'paid'` for verification bursts.
- Prompts live in `components/lobby/prompts/` and `lib/categories.ts`.
  `app/dev/compare-prompts` is the playground for iterating on them.

## Git conventions

- Work on the branch you were assigned; never push to `main`.
- Conventional-commit subjects, matching existing history:
  `feat:`, `fix:`, `fix(db):`, `perf:`, `docs:`, `chore:`, `i18n:`.
- Never commit `.env*`, `node_modules/`, `.next/`, or `data/`.
- `.planning/`, `.claude/`, `.agents/` and `docs/agents/` are gitignored.

## Gotchas

- `lib/supabase.ts` throws at module load when env vars are missing — a build without them fails
  loudly, by design.
- React Strict Mode is on; effects mount twice in dev. Submission paths guard against duplicates
  server-side (`FOR UPDATE` row locks in the RPCs) — keep it that way.
- Non-production deployments send `X-Robots-Tag: noindex` (`next.config.ts`), and preview deploys
  redirect everything to `/login` behind basic auth (`proxy.ts`).
- Street View timer sounds still use plain `Audio` in `StreetView.tsx` rather than `SoundProvider`
  — intentional, they predate it.
- `.planning/codebase/*.md` are auto-generated snapshots from 2026-06-08 and no longer describe
  the whole app. Verify against source before quoting them.
