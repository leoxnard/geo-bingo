# Codebase Concerns

**Analysis Date:** 2026-06-08

## Tech Debt

**Large Monolithic Data Files:**
- Issue: `lib/categories.ts` (1586 lines) contains hardcoded category translations for 5 languages in a single file, making it difficult to maintain and extend
- Files: `lib/categories.ts`
- Impact: Any category addition requires editing this monolithic file; high risk of merge conflicts; difficult to review changes
- Fix approach: Externalize category data to JSON files per language, or implement a database-driven category system

**Complex State Management in Game Room:**
- Issue: `app/game/[id]/page.tsx` (960 lines) manages extensive game state in a single component with many interdependent refs and effects
- Files: `app/game/[id]/page.tsx`
- Impact: Difficult to reason about state transitions; React strict mode guards add complexity; potential for stale closures
- Fix approach: Extract game state logic into custom hooks or separate modules; consider Zustand or Jotai for centralized state

**Large Component Files:**
- Issue: Multiple component files exceed 600+ lines, indicating feature creep and complex responsibilities
- Files: `components/VotingView.tsx` (1163 lines), `components/streetview/StreetView.tsx` (799 lines), `components/lobby/LobbyMap.tsx` (934 lines), `components/community/CommunityBuilder.tsx` (591 lines), `lib/geoMeta.ts` (631 lines)
- Impact: Hard to navigate, test, and maintain; increased cognitive load for developers
- Fix approach: Split into smaller sub-components; extract business logic to separate utility modules

**Magic Numbers in Animation:**
- Issue: Hardcoded animation timing constants scattered in VotingView without clear documentation
- Files: `components/VotingView.tsx` (lines 27-31, 426-431)
- Impact: Tuning animation behavior requires code changes; unclear relationship between values and visual outcome
- Fix approach: Move constants to a configuration object with documentation; consider adaptive timing based on path complexity

## Known Bugs

**Concurrent Initialization Race Condition:**
- Symptoms: Duplicate game/player inserts, 409 conflicts, premature kick-redirects during startup
- Files: `app/game/[id]/page.tsx` (lines 87-97, 561-572)
- Trigger: React strict mode in development mounts effects twice; two clients opening same fresh game code simultaneously
- Workaround: The `initedGameRef` guard prevents duplicate initialization, but adds complexity

## Security Considerations

**Preview Auth Bypass Risk:**
- Risk: `proxy.ts` enforces authentication only on preview deployments, leaving production deployments without this protection layer
- Files: `proxy.ts`
- Current mitigation: Preview-only auth check with cookie-based verification
- Recommendations: Consider adding rate limiting or additional abuse detection; verify that preview auth is the intended security model

**Gemini Proxy Size Limit:**
- Risk: The 8MB body limit in `app/api/gemini/route.ts` may be insufficient for large base64-encoded images during verification bursts
- Files: `app/api/gemini/route.ts` (line 25)
- Current mitigation: Body size capping with 413 response for oversized payloads
- Recommendations: Monitor payload sizes in production; consider streaming or chunked uploads for very large images

**No Rate Limiting on Preview Auth:**
- Risk: Cookie-based preview auth in `proxy.ts` has no rate limiting, potentially vulnerable to brute force
- Files: `proxy.ts`
- Current mitigation: None
- Recommendations: Add rate limiting to preview auth endpoint; implement exponential backoff

## Performance Bottlenecks

**Category Verification Concurrency:**
- Problem: AI verification limited to 3 concurrent submissions maximum, which can cause long waits during large category submission rounds
- Files: `components/utils/aiVerify.ts` (line 118)
- Cause: `VERIFY_CONCURRENCY = 3` hardcoded throttle to avoid hitting API quotas
- Improvement path: Make concurrency configurable; implement priority queue; add progress indicators

**Large Bundle Size Risk:**
- Problem: Translation strings embedded in the client bundle via `lib/categories.ts` increase bundle size
- Files: `lib/categories.ts`, translation bundles in `lib/i18n/messages/`
- Cause: All category translations loaded regardless of user's selected language
- Improvement path: Dynamic loading of language-specific category bundles; tree-shaking improvements

**Street View Image Fetching in Voting:**
- Problem: Real-time Street View image fetching on hover in VotingView (`components/VotingView.tsx` lines 924-931) without caching
- Files: `components/VotingView.tsx`
- Cause: Direct Google Maps API calls on every hover event
- Improvement path: Implement image caching layer; debounce hover events

## Fragile Areas

**Realtime Subscription Management:**
- Files: `app/game/[id]/page.tsx` (lines 571-713)
- Why fragile: Complex multi-channel subscription setup with manual cleanup; race conditions between different update handlers; optimistic update guards add complexity
- Safe modification: Ensure cleanup runs on every unmount; test under React strict mode; verify subscription deduplication
- Test coverage: Unknown (no test files detected)

**Host Token Management:**
- Files: `lib/hostToken.ts`, `app/game/[id]/page.tsx` (lines 29, 437-438, 488-490, 596-611, 797-808)
- Why fragile: Host capability stored in localStorage + Supabase RPC; host transfer requires careful token invalidation; concurrent tab issues
- Safe modification: Always clear tokens on host transfer; verify RPC returns correct error states; test multi-tab scenarios
- Test coverage: Unknown (no test files detected)

**Polygon Insertion Algorithm:**
- Files: `components/utils/mapUtils.tsx` (lines 27-136)
- Why fragile: Complex geometric logic for avoiding self-intersection; fallback behavior may produce unexpected results on wild concave shapes
- Safe modification: Add extensive unit tests for edge cases; visualize intersection detection during development
- Test coverage: Unknown (no test files detected)

## Scaling Limits

**Category Count Hardcoded:**
- Current capacity: Default 10 categories in lobby UI; hardcoded arrays up to ~630 items
- Files: `lib/categories.ts`, `app/game/[id]/page.tsx` (line 52)
- Limit: Category arrays grow with each update; no pagination or lazy loading
- Scaling path: Implement on-demand category loading; database-backed categorization; pagination for large lists

**Supabase Realtime Channel Limits:**
- Current capacity: One channel per game for status, one for players, one for events, one for presence
- Files: `app/game/[id]/page.tsx`
- Limit: Supabase has connection and message rate limits; many concurrent games could exceed quotas
- Scaling path: Monitor connection usage; implement channel multiplexing; add reconnection logic with backoff

## Dependencies at Risk

**Google Maps API:**
- Risk: Heavy usage of Google Maps APIs (Street View, Maps JavaScript) for core gameplay; any API changes or quota issues break the game
- Files: Multiple components using `@react-google-maps/api`, `components/utils/mapUtils.tsx`
- Impact: Core game functionality depends on external API availability and pricing
- Migration plan: Consider Mapbox or other alternatives as fallbacks; implement graceful degradation

**Gemini API for Verification:**
- Risk: AI verification is critical for Bingo mode end-game detection; API unavailability or model deprecations could break core gameplay
- Files: `components/utils/aiVerify.ts`, `components/utils/geminiClient.ts`, `app/api/gemini/route.ts`
- Impact: Players may be unable to complete Bingo rounds if AI verification fails
- Migration plan: The model fallback system (`geminiClient.ts` lines 59-65) provides some resilience; consider alternative AI providers

## Missing Critical Features

**No Automated Tests:**
- Problem: No test files found in the codebase (`**/*.test.**` pattern returned empty)
- Files: None (missing)
- Blocks: Confidence in refactors; CI/CD quality gates; regression detection

**No Error Boundary Components:**
- Problem: No React error boundaries to gracefully handle Google Maps or AI API failures
- Files: No error boundary components detected
- Blocks: Crashes from API failures or map initialization errors could take down entire game UI

## Test Coverage Gaps

**Realtime WebSocket Logic:**
- What's not tested: Supabase channel subscription logic, presence tracking, broadcast handlers
- Files: `app/game/[id]/page.tsx`
- Risk: Race conditions, memory leaks, and incorrect state updates in multiplayer scenarios
- Priority: High

**AI Verification Logic:**
- What's not tested: Gemini API response parsing, hash computation, cache validation
- Files: `components/utils/aiVerify.ts`
- Risk: Incorrect verifications could allow cheating or false rejections
- Priority: High

**Polygon Geometry Functions:**
- What's not tested: `isPointInPolygon`, `insertPoint`, `isLocationAllowed` functions
- Files: `components/utils/mapUtils.tsx`
- Risk: Incorrect boundary calculations could allow players in wrong areas or block valid moves
- Priority: Medium

**Community Preset CRUD:**
- What's not tested: RPC wrappers for create/update/delete with ownership enforcement
- Files: `lib/community.ts`
- Risk: Security issues if RPC ownership checks are bypassed; data integrity problems
- Priority: Medium

---

*Concerns audit: 2026-06-08*