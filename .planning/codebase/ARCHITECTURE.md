<!-- refreshed: 2026-06-08 -->
# Architecture

**Analysis Date:** 2026-06-08

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    React Client Layer                        │
│  [app/page.tsx] [app/game/[id]/page.tsx] [components/**]    │
├─────────────────────────────────────────────────────────────┤
│                    Next.js App Router                          │
│  [app/layout.tsx] [app/api/**] [app/community/**]           │
├─────────────────────────────────────────────────────────────┤
│                    Supabase Realtime                          │
│  [lib/supabase.ts] RPC Functions [supabase/schema.sql]       │
├─────────────────────────────────────────────────────────────┤
│                    External APIs                              │
│  Google Maps JavaScript API [NEXT_PUBLIC_GOOGLE_MAPS_API_KEY]  │
│  Gemini AI [app/api/gemini] [app/api/translate]              │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| RootLayout | Global font, metadata, i18n provider setup | `app/layout.tsx` |
| GameRoom | Game state orchestration, realtime sync, view switching | `app/game/[id]/page.tsx` |
| LobbyView | Game setup, settings, player management, start game flow | `components/lobby/LobbyView.tsx` |
| StreetView | Interactive Street View gameplay, submission handling, path tracking | `components/streetview/StreetView.tsx` |
| VotingView | Journey replay animation, voting interface, results display | `components/VotingView.tsx` |
| PodiumView | Final scoring and results screen | `components/PodiumView.tsx` |
| HomeInteractive | Landing page hero, create/join game UI | `components/home/HomeInteractive.tsx` |
| I18nProvider | Locale context, translation function, cookie persistence | `lib/i18n/I18nProvider.tsx` |
| LobbyMap | Interactive map for boundary/pin placement | `components/lobby/LobbyMap.tsx` |
| LobbyCategories | Category input, AI generation toggle, preset import | `components/lobby/LobbyCategories.tsx` |
| StreetViewSidebar | Checklist/board display during gameplay | `components/streetview/StreetViewSidebar.tsx` |
| VotingPanel | Submission voting controls | `components/voting/VotingPanel.tsx` |

## Pattern Overview

**Overall:** Next.js App Router with React Client Components + Supabase Realtime + Google Maps

**Key Characteristics:**
- Single-page application with client-side navigation via Next.js App Router
- Real-time multiplayer state synchronized through Supabase Realtime channels
- Component composition: container components compose presentational pieces
- Security via SECURITY DEFINER Postgres RPC functions (host tokens)
- Server-side API proxies for Gemini and DeepL to protect API keys

## Layers

**UI Layer (React Client):**
- Purpose: Presentational components and user interaction
- Location: `components/` directory
- Contains: View components, UI utilities, map integrations
- Depends on: I18nProvider, Supabase client
- Used by: GameRoom, LobbyView, VotingView, PodiumView

**Game Logic Layer (Client Controllers):**
- Purpose: Orchestrate game state, handle real-time updates, coordinate views
- Location: `app/game/[id]/page.tsx`, `components/**/use*.ts` hooks
- Contains: Game state machines, realtime subscriptions, effect handlers
- Depends on: Supabase client, Google Maps API
- Used by: UI layer components via props/callbacks

**Data Layer (Supabase):**
- Purpose: Persist game state, players, submissions, community presets
- Location: `lib/supabase.ts`, `supabase/schema.sql`, RPC functions
- Contains: Postgres tables (games, players, submissions, community_presets), security functions
- Depends on: Supabase service, Postgres triggers
- Used by: Client via RPC calls and realtime subscriptions

**API Layer (Serverless Endpoints):**
- Purpose: Proxy external API calls (Gemini, DeepL) without exposing keys
- Location: `app/api/gemini/route.ts`, `app/api/translate/route.ts`
- Contains: Request validation, API key injection, response mirroring
- Depends on: Environment variables (GEMINI_API_KEY, DEEPL_API_KEY)
- Used by: Client components for AI verification and category generation

**Utility Layer:**
- Purpose: Shared helpers, type definitions, i18n utilities
- Location: `lib/`, `components/utils/`
- Contains: Helper functions, types, i18n hooks, map utilities
- Depends on: External SDKs (Google Maps)
- Used by: All layers

## Data Flow

### Primary Request Path

1. Landing page loads (`app/page.tsx`) - server component renders footer translated via `getServerLocale()`
2. User enters lobby (`app/game/[id]/page.tsx`) - client component initializes game and player state
3. Supabase realtime subscribes to game/player channels (`supabase.from('games').on('postgres_changes')`)
4. Lobby settings update via `update_game_settings` RPC (`supabase.rpc('update_game_settings', ...)`)
5. Game start triggers `update_game_status('playing')` (`supabase.rpc('set_game_status', ...)`)
6. Street View captures positions and records submissions via `claim_category` RPC
7. Round end triggers `player_vote_to_end_round` RPC transitioning to voting phase
8. Voting phase replays paths and collects votes via `register_vote` RPC
9. Host ends game (`set_game_status('finished')`), all clients render PodiumView

### Preset Import Flow

1. User selects preset from `/community` page
2. Navigator navigates to `/game/<id>?preset=<presetId>` (`app/game/[id]/page.tsx`)
3. Game initialization detects `presetId` query param
4. Fetches preset data from `community_presets` table (`supabase.from('community_presets').select('*')`)
5. Seeds game settings (categories, boundary, starting point) into `games` table
6. Sets `category_translations` for live language switching during the session

## Key Abstractions

**Realtime Channels:**
- Purpose: Synchronize game state across all players
- Examples: `game-updates-{gameId}`, `player-updates-{gameId}`, `presence-{gameId}`
- Pattern: Supabase channel subscription with payload handlers for UPDATE events

**Host Token:**
- Purpose: Capability-based authentication for host-only actions
- Examples: `lib/hostToken.ts`, `register_host_secret` RPC, `is_valid_host()` function
- Pattern: Secret token stored in localStorage, validated server-side via SQL function

**Submission Claim:**
- Purpose: Record player captures of categories with Street View viewpoint
- Examples: `claim_category`, `claim_exclusive_category` RPCs in `supabase/schema.sql`
- Pattern: Upsert pattern ensuring atomic claims with AI verdict reset on retake

**I18n Context:**
- Purpose: Provide translation function and locale awareness to all components
- Examples: `useT()` hook, `translate()` function, locale cookie
- Pattern: React Context provider at root level, server-side locale detection

## Entry Points

**Home Page:**
- Location: `app/page.tsx`
- Triggers: Direct navigation to `/`
- Responsibilities: Render translated footer, compose HomeInteractive component

**Game Room:**
- Location: `app/game/[id]/page.tsx`
- Triggers: Navigation to `/game/<id>` or `/game/<id>?preset=<presetId>`
- Responsibilities: Initialize game state, manage realtime subscriptions, switch views

**Gemini Proxy:**
- Location: `app/api/gemini/route.ts`
- Triggers: POST requests from client AI verification code
- Responsibilities: Validate model, inject API key, forward to Google Gemini API

**Translate Proxy:**
- Location: `app/api/translate/route.ts`
- Triggers: POST requests during preset publishing
- Responsibilities: Translate category names via DeepL, return aligned translations

**Community Browse:**
- Location: `app/community/page.tsx`
- Triggers: Navigation to `/community`
- Responsibilities: List and search presets, display preset cards

## Architectural Constraints

- **Threading:** Single-threaded JavaScript event loop; concurrent database access serialized via Postgres row locks in RPC functions
- **Global state:** React Context for i18n; shared game state in Supabase; localStorage for session persistence (playerId, hostToken)
- **Circular imports:** Avoided by using `@/` alias paths and separating types into `components/utils/types.tsx`
- **Security:** All host actions require capability token validated server-side; direct table updates restricted via Row Level Security

## Anti-Patterns

### Direct Table Updates Blocked

**What happens:** React strict mode can mount effects twice, causing duplicate submissions
**Why it's wrong:** Could corrupt game state or create inconsistent data
**Do this instead:** Use RPC functions with row locking (see `claim_category` with `FOR UPDATE`)

### Host Token Bypass Attempts

**What happens:** Client code attempts to call host-only RPCs without valid token
**Why it's wrong:** Server rejects with `NOT_HOST` error
**Do this instead:** Always verify host status locally (`getHostToken(gameId)`) and call RPC with token parameter

## Error Handling

**Strategy:** Fail-closed with RPC payload errors, not exceptions

**Patterns:**
- RPC functions return `{ success: boolean, error?: string, data?: ... }` objects
- Client checks both Supabase error and `data.success === false` conditions
- Toast notifications for user-facing errors via `react-hot-toast`
- Console.error for unexpected failures

## Cross-Cutting Concerns

**Logging:** Console.log with timestamp markers (`[GameRoom]` prefix); Vercel Analytics for production metrics
**Validation:** Server-side validation in RPC functions (category counts, grid sizes, duplicate checking)
**Authentication:** Supabase anonymous access; host capability via secret token system