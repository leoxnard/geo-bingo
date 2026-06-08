# External Integrations

**Analysis Date:** 2026-06-08

## APIs & External Services

**AI & Machine Learning:**
- Google Gemini API - Image verification and category generation via multimodal models
  - SDK/Client: Custom proxy at `app/api/gemini/route.ts`
  - Auth: `GEMINI_API_KEY`, `GEMINI_API_KEY_FREE`, `GEMINI_API_KEY_PAID` environment variables
  - Two-tier key system: 'free' for low-volume text work, 'paid' for verification bursts
  - All requests proxied through `/api/gemini` to hide API key from client bundle

- DeepL API - Translation of community preset categories
  - SDK/Client: Custom proxy at `app/api/translate/route.ts`
  - Auth: `DEEPL_API_KEY` environment variable
  - Used when publishing community presets to translate category names into all supported languages

**Maps & Geolocation:**
- Google Maps JavaScript API - Interactive maps and Street View
  - SDK/Client: `@react-google-maps/api` ^2.20.8 and `@googlemaps/markerclusterer` ^2.6.2
  - Auth: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` environment variable
  - Libraries: 'places', 'geometry' loaded for map functionality
  - Used in `components/streetview/StreetView.tsx`, `components/VotingView.tsx`, `components/lobby/LobbyMap.tsx`

## Data Storage

**Databases:**
- PostgreSQL (via Supabase) - Primary game state database
  - Connection: `NEXT_PUBLIC_SUPABASE_URL` with `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Client: `@supabase/supabase-js` ^2.99.3
  - Tables: `games`, `players`, `submissions`, `community_presets`, `community_preset_votes`, `game_host_secrets`
  - Realtime subscriptions used via `useSubmissionsRealtime` hook in `components/streetview/useSubmissionsRealtime.ts`

**File Storage:**
- Not detected - All game data stored in PostgreSQL

**Caching:**
- localStorage - Client-side caching of last working Gemini model per tier
  - Implementation in `components/utils/geminiClient.ts`

## Authentication & Identity

**Auth Provider:**
- Supabase Auth - Anonymous authentication for community preset authorship
  - Implementation: `auth.uid()` used in RPC functions for user identity
  - Custom host token system for game host verification via `game_host_secrets` table
  - Host capability carried via `p_host_id` token parameter, validated by `is_valid_host` function

## Monitoring & Observability

**Error Tracking:**
- Not detected - No dedicated error tracking service

**Logs:**
- Console logging via `console.error` and `console.warn` in application code
- Server-side logs in API routes for debugging upstream failures

## CI/CD & Deployment

**Hosting:**
- Vercel - Primary hosting platform
  - Optimized for Next.js with automatic deployments
  - `VERCEL_ENV` environment variable used for header-based noindex on non-production

**CI Pipeline:**
- Not detected - No GitHub Actions or CI configuration files found

## Environment Configuration

**Required env vars:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` - Google Maps API key (exposed to client)
- `GEMINI_API_KEY` - Legacy Gemini API key (optional fallback)
- `GEMINI_API_KEY_FREE` - Gemini API key for free-tier category generation
- `GEMINI_API_KEY_PAID` - Gemini API key for paid-tier AI verification
- `DEEPL_API_KEY` - DeepL translation API key

**Secrets location:**
- `.env.local` - Local development secrets
- Vercel Environment Variables - Production secrets

## Webhooks & Callbacks

**Incoming:**
- Not detected - No incoming webhooks configured

**Outgoing:**
- Google Maps Street View API - Image fetching for AI verification (`components/utils/aiVerify.ts:56`)
- Google Gemini API - Multimodal content generation and verification (`app/api/gemini/route.ts:71`)
- DeepL API - Text translation (`app/api/translate/route.ts:66`)

---

*Integration audit: 2026-06-08*