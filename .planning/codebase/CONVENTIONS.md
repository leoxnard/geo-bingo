# Coding Conventions

**Analysis Date:** 2026-06-08

## Naming Patterns

**Files:**
- React components: PascalCase with `.tsx` extension (e.g., `StreetView.tsx`, `LobbyView.tsx`)
- Utility modules: camelCase with `.ts` or `.tsx` extension (e.g., `useViewport.ts`, `mapUtils.tsx`)
- Type definitions: `types.tsx` in component folders (e.g., `components/utils/types.tsx`)
- Language message files: lowercase locale codes (e.g., `en.ts`, `de.ts`, `fr.ts`)

**Functions:**
- camelCase for all functions and handlers (e.g., `handleSubmit`, `handleViewpointChange`, `useT`)
- Handler props are prefixed with `handle` (e.g., `handleViewpointChange`, `handleSubmit`, `handleStartGame`)
- Hook functions prefixed with `use` (e.g., `useAiVerify`, `useStreetViewPath`, `useSubmissionsRealtime`)

**Variables:**
- camelCase for all variables (e.g., `submittingCategory`, `lastValidPositionRef`, `animationFrameId`)
- State setters use `set` prefix (e.g., `setSubmittingCategory`, `setInStreetView`, `setIsFullscreen`)
- Refs use `Ref` suffix (e.g., `streetViewRef`, `containerRef`, `mainMapDotRef`)
- Boolean flags use `is`/`has`/`can` prefixes (e.g., `isLoading`, `hasVotedToEnd`, `canSubmit`)
- Constants use SCREAMING_SNAKE_CASE (e.g., `CHECKBOX_CLASS`, `ICON_FALLBACK`, `MAXGRIDSIZE`)

**Types:**
- Interfaces use PascalCase (e.g., `Submission`, `Player`, `CommunityPreset`)
- Type aliases for simple types use PascalCase (e.g., `GameStatus`, `Locale`, `PresetSort`)
- Props interfaces typically match component name with `Props` suffix (e.g., `StreetViewProps`, `LobbyViewProps`)
- Some props are inline without explicit interface (e.g., `Readonly<{ children: React.ReactNode; }>`)

## Code Style

**Formatting:**
- Prettier 3.8.2 with settings in `.prettierrc.json`
- 4-space indentation (enforced by both Prettier and ESLint)
- Single quotes for strings
- Trailing commas on all multi-line constructs
- Print width: 500 characters
- Semicolons required

**Linting:**
- ESLint 9.39.4 with Flat Config (`eslint.config.js`)
- TypeScript ESLint recommended rules
- React recommended rules
- React Hooks exhaustive deps plugin
- Import order plugin with alphabetical sorting
- Max line length: 500 characters
- Indentation: 4 spaces

## Import Organization

**Order:**
1. Built-in modules
2. External packages (including `react` before other external)
3. Internal modules (using `@/` path alias)
4. Parent/Sibling relative imports

**Path Aliases:**
- `@/*` resolves to project root (defined in `tsconfig.json`)
- `@/lib/*` for library functions
- `@/components/*` for UI components
- `@/app/*` for Next.js app router files

Example import block from `app/layout.tsx`:
```typescript
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

import { getServerLocale } from '@/lib/i18n/getServerLocale';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
```

## Error Handling

**Patterns:**
- Supabase errors are thrown with `throw error` (e.g., `lib/community.ts` line 35, 71)
- Server actions use try/catch blocks with conditional error responses (e.g., `app/api/translate/route.ts`)
- Client-side errors use `console.error` for logging (e.g., `StreetView.tsx` line 526, 549)
- User-facing errors use `toast.error()` from react-hot-toast
- Silent failures for non-critical async operations use empty catch blocks with comments (e.g., `app/api/translate/route.ts` line 74-76)

Error handling example from `StreetView.tsx`:
```typescript
if (error || (data && data.success === false)) {
    console.error('claim_category failed:', error || data.error);
    toast.error(t('sv.toastErrorSaving'));
}
```

## Logging

**Framework:** `console` (no dedicated logging library)

**Patterns:**
- `console.error` for error logging (e.g., `lib/community.ts`, `StreetView.tsx`)
- `console.log` sparingly, mostly for debugging (e.g., audio playback fallback in `StreetView.tsx` line 293)
- No structured logging pattern detected

## Comments

**When to Comment:**
- File-level block comments describing module purpose (multi-line `/* ===...=== */` format)
- Inline comments for complex conditional logic (e.g., boundary priority logic in `lib/community.ts` line 172-173)
- Comments for non-obvious interactions (e.g., "exclusive mode insert via RPC" in `StreetView.tsx` line 508)

**JSDoc/TSDoc:**
- No JSDoc comments on individual functions
- Type documentation embedded in type definitions via inline comments
- File headers extensively document module responsibilities

Example header format from `app/layout.tsx`:
```typescript
/*
================================================================================
ROOT LAYOUT
================================================================================
Global layout wrapper for the Geo Bingo application...
================================================================================
*/
```

## Function Design

**Size:**
- Functions vary from small (5-10 lines) to large (100+ lines)
- Async handlers common for Supabase database operations
- useMemo and useCallback used extensively for performance

**Parameters:**
- Destructured props pattern in components
- Optional parameters for configurable features (e.g., `gameMode = 'list'`, `gridSize = 3` in `StreetViewProps`)
- Callback props prefixed with `on` (e.g., `onVoteEnd`, `notifyGameEvent`)

**Return Values:**
- Components return JSX elements
- Hooks return objects/tuples for state and handlers
- Data functions return typed values or null/undefined for not found

## Module Design

**Exports:**
- Default exports for main components (e.g., `export default function StreetView`)
- Named exports for types and utilities (e.g., `export type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished'`)
- Re-exports through barrel pattern in some cases (e.g., `I18nProvider.tsx` line 34 re-exports `translate`)

**Barrel Files:**
- No explicit barrel files (index.ts re-exports) detected
- Direct imports from source files
- Path aliases defined in tsconfig.json for root-level imports

---

*Convention analysis: 2026-06-08*