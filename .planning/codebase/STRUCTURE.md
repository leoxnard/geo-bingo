# Codebase Structure

**Analysis Date:** 2026-06-08

## Directory Layout

```
geo-bingo/
├── app/                    # Next.js App Router pages and API routes
│   ├── layout.tsx          # Root layout with font, i18n, analytics setup
│   ├── page.tsx            # Landing/home page (server component)
│   ├── error.tsx           # Global error boundary
│   ├── robots.ts           # SEO robots configuration
│   ├── sitemap.ts          # SEO sitemap generation
│   ├── api/                # Serverless API endpoints
│   │   ├── gemini/route.ts # Gemini AI proxy
│   │   └── translate/route.ts # DeepL translation proxy
│   ├── game/               # Game room routes
│   │   ├── [id]/           # Dynamic game ID route
│   │   │   ├── page.tsx    # Main game controller
│   │   │   └── layout.tsx  # Game-specific layout
│   │   └── actions.ts      # Server actions for game (AI key check)
│   ├── community/          # Community preset routes
│   │   ├── page.tsx        # Browse presets
│   │   ├── create/         # Preset creation flow
│   │   └── actions.ts      # Preset CRUD actions
│   ├── login/              # Authentication routes
│   │   ├── page.tsx        # Login page
│   │   └── actions.ts      # OAuth actions
│   ├── how-to-play/        # Static content pages
│   ├── privacy/            # Privacy policy
│   └── impressum/          # Legal notice
├── components/             # React components
│   ├── home/               # Landing page components
│   │   └── HomeInteractive.tsx
│   ├── lobby/              # Lobby setup components
│   │   ├── LobbyView.tsx
│   │   ├── LobbySettings.tsx
│   │   ├── LobbyMap.tsx
│   │   ├── LobbyCategories.tsx
│   │   ├── LobbySidebar.tsx
│   │   ├── AICategories.tsx
│   │   ├── NearbyPlaceCategories.tsx
│   │   ├── NearbyStreetViewCategories.tsx
│   │   └── prompts/        # Prompt templates for AI
│   │       ├── StreetViewPrompts.ts
│   │       └── NearbyPlacePrompts.ts
│   ├── streetview/         # Street View gameplay
│   │   ├── StreetView.tsx
│   │   ├── StreetViewMapPanel.tsx
│   │   ├── StreetViewSidebar.tsx
│   │   ├── StreetViewMapPanel.tsx
│   │   ├── RoundControls.tsx
│   │   ├── BingoBoard.tsx
│   │   ├── ChecklistList.tsx
│   │   ├── AiReasonLabel.tsx
│   │   ├── streetViewHelpers.ts
│   │   ├── useStreetViewPath.ts
│   │   ├── useSubmissionsRealtime.ts
│   │   └── useAiVerify.ts
│   ├── voting/             # Voting phase
│   │   └── VotingPanel.tsx
│   ├── community/          # Community preset components
│   │   ├── CommunityBrowse.tsx
│   │   ├── CommunityBuilder.tsx
│   │   ├── PresetCard.tsx
│   │   ├── AuthGate.tsx
│   │   ├── useUser.ts
│   │   ├── finalizePreset.ts
│   │   └── StreetViewExplorer.tsx
│   ├── utils/              # Shared utilities
│   │   ├── Functions.tsx
│   │   ├── mapUtils.tsx
│   │   ├── useViewport.ts
│   │   ├── Elements.tsx
│   │   ├── SafeImage.tsx
│   │   └── types.tsx
│   ├── VotingView.tsx
│   └── PodiumView.tsx
├── lib/                    # Core libraries
│   ├── supabase.ts         # Supabase client singleton
│   ├── hostToken.ts        # Host capability token management
│   ├── deviceId.ts         # Session UUID generation
│   ├── names.ts            # Random player name wordlists
│   ├── categories.ts       # Category generation utilities
│   ├── geoMeta.ts          # Geolocation metadata
│   ├── community.ts        # Community preset helpers
│   └── i18n/             # Internationalization
│       ├── I18nProvider.tsx
│       ├── translate.ts
│       ├── getServerLocale.ts
│       ├── locales.ts
│       ├── LanguageSwitcher.tsx
│       └── messages/
│           ├── index.ts
│           ├── en.ts
│           ├── de.ts
│           ├── es.ts
│           ├── fr.ts
│           └── zh.ts
├── supabase/               # Supabase configuration and schema
│   ├── schema.sql          # Database schema and RPC functions
│   └── migrations/       # Database migration scripts
├── public/                 # Static assets
│   ├── images/             # How-to-play images
│   ├── sounds/             # Timer audio effects
│   ├── mappin.and.ellipse.png
│   └── geo_bingo_presets.json
├── scripts/                # Build/deployment scripts
├── .planning/              # Documentation and planning
│   └── codebase/           # Generated architecture docs
├── package.json
├── next.config.ts
├── tsconfig.json
└── eslint.config.js
```

## Directory Purposes

**app/:**
- Purpose: Next.js App Router file-based routing, pages, and API endpoints
- Contains: Server components, client components, serverless functions
- Key files: `app/page.tsx`, `app/game/[id]/page.tsx`, `app/api/gemini/route.ts`

**components/:**
- Purpose: Re-usable React components organized by feature area
- Contains: View components, UI elements, hooks, utilities
- Key files: `components/streetview/StreetView.tsx`, `components/voting/VotingPanel.tsx`

**lib/:**
- Purpose: Core utility modules, data clients, and shared logic
- Contains: Supabase client, i18n system, device/session management
- Key files: `lib/supabase.ts`, `lib/i18n/I18nProvider.tsx`, `lib/hostToken.ts`

**supabase/:**
- Purpose: Database schema definitions and migration scripts
- Contains: Postgres DDL, RPC functions, security policies
- Key files: `supabase/schema.sql`

**public/:**
- Purpose: Static assets served at web root
- Contains: Images, sounds, JSON preset files
- Key files: `public/images/how-to-play/`, `public/sounds/*.wav`

## Key File Locations

**Entry Points:**
- `app/page.tsx`: Landing page entry point
- `app/game/[id]/page.tsx`: Game room entry point
- `app/api/gemini/route.ts`: Gemini API proxy endpoint
- `app/api/translate/route.ts`: DeepL translation endpoint

**Configuration:**
- `package.json`: Project manifest, scripts, dependencies
- `next.config.ts`: Next.js configuration
- `tsconfig.json`: TypeScript compiler settings with `@/*` alias
- `eslint.config.js`: ESLint flat config with import plugin

**Core Logic:**
- `lib/supabase.ts`: Supabase client singleton
- `lib/hostToken.ts`: Host capability token management
- `app/game/[id]/page.tsx`: Game state machine

**Utilities:**
- `components/utils/types.tsx`: All TypeScript interfaces
- `components/utils/Functions.tsx`: Shared helper functions
- `lib/i18n/translate.ts`: Translation function

## Naming Conventions

**Files:**
- Components: PascalCase with descriptive suffix (e.g., `LobbyView.tsx`, `StreetViewMapPanel.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useStreetViewPath.ts`, `useViewport.ts`)
- Utilities: PascalCase for component helpers, camelCase for functions (e.g., `Functions.tsx`, `streetViewHelpers.ts`)

**Directories:**
- Feature grouping: Singular nouns for component folders (`lobby/`, `streetview/`)
- Context grouping: Functional names (`i18n/`, `utils/`)

**Components:**
- Exported as default from single-component files
- Interface props defined in same file or `components/utils/types.tsx`

## Where to Add New Code

**New Feature:**
- Primary code: `app/<feature>/page.tsx` for routes, `components/<feature>/` for components
- Tests: Co-located `.test.tsx` files (not currently used; manual testing)

**New Component/Module:**
- Implementation: `components/<feature>/<ComponentName>.tsx`
- Hooks: `components/<feature>/use<HookName>.ts`
- Types update types in `components/utils/types.tsx`

**Utilities:**
- Shared helpers: `components/utils/Functions.tsx` or new file in `components/utils/`
- Library-level utilities: `lib/<utilityName>.ts`

**API Endpoints:**
- New endpoints: `app/api/<endpoint>/route.ts`

**Database Schema:**
- New tables/functions: `supabase/schema.sql`
- Migrations: `supabase/migrations/2026MMDD_<description>.sql`

## Special Directories

**.planning/codebase/:**
- Purpose: Generated documentation (architecture maps)
- Generated: Yes (by gsd-map-codebase command)
- Committed: Yes

**supabase/migrations/:**
- Purpose: Incremental database schema changes
- Generated: Yes (manual SQL migrations)
- Committed: Yes

**.next/:**
- Purpose: Next.js build output (serverless functions, compiled assets)
- Generated: Yes (build-time)
- Committed: No (`.gitignore`)

**node_modules/:**
- Purpose: npm package dependencies
- Generated: Yes (install-time)
- Committed: No (`.gitignore`)

**public/:**
- Purpose: Static assets served at web root path
- Generated: No (manual assets)
- Committed: Yes

---

*Structure analysis: 2026-06-08*