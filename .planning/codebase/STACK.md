# Technology Stack

**Analysis Date:** 2026-06-08

## Languages

**Primary:**
- TypeScript - Application source code
- JavaScript (ES2017 target) - Compiled output and configuration files

## Runtime

**Environment:**
- Node.js - Server-side runtime (implied by Next.js requirements)

**Package Manager:**
- npm - Lockfile present (package-lock.json implied)

## Frameworks

**Core:**
- Next.js 16.2.3 - Full-stack React framework with App Router, Turbopack bundler
- React 19.2.4 - UI library with concurrent features

**Testing:**
- Not detected - No test framework installed

**Build/Dev:**
- Turbopack - Next.js native bundler (configured via next.config.ts)
- PostCSS - CSS transformation with @tailwindcss/postcss
- TailwindCSS 4 - Utility-first CSS framework

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` ^2.99.3 - Backend-as-a-Service for PostgreSQL database, authentication, and realtime subscriptions
- `@react-google-maps/api` ^2.20.8 - Google Maps JavaScript API bindings for React components
- `@googlemaps/markerclusterer` ^2.6.2 - Client-side clustering for map markers
- `react-hot-toast` ^2.6.0 - Toast notifications for user feedback
- `react-confetti` ^6.4.0 - Confetti animation for game celebrations

**Infrastructure:**
- `next` ^16.2.3 - Full-stack framework with SSR and API routes
- `node-fetch` ^3.3.2 - HTTP client for server-side fetch operations
- `@vercel/analytics` ^2.0.1 - Vercel Web Analytics integration
- `@vercel/speed-insights` ^2.0.0 - Performance monitoring

**Database:**
- Supabase CLI ^2.84.4 - Local development tooling and migration management

## Configuration

**Environment:**
- `.env.local` - Local development environment file (exists in project root)
- Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY`, `GEMINI_API_KEY_FREE`, `GEMINI_API_KEY_PAID`, `DEEPL_API_KEY`

**Build:**
- `next.config.ts` - Next.js configuration with Turbopack, Webpack warnings suppression, and noindex headers for non-production
- `tsconfig.json` - TypeScript configuration targeting ES2017, strict mode, bundler module resolution
- `eslint.config.js` - Flat config ESLint with TypeScript, React, and import ordering rules
- `.prettierrc.json` - Prettier formatting with 4-space tabs, 500 print width, single quotes, trailing commas

## Platform Requirements

**Development:**
- Node.js 20+ (based on @types/node ^20)
- Supabase account with Postgres database
- Google Maps API key with Street View and Maps APIs enabled
- Google Gemini API key (optional for AI features)
- DeepL API key (optional for translations)

**Production:**
- Vercel hosting - Optimized platform with automatic `VERCEL_ENV` detection
- Supabase managed Postgres database
- External API keys configured as environment variables

---

*Stack analysis: 2026-06-08*