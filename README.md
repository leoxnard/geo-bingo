# 🌍 Geo BingBong

Geo BingBong is a multiplayer geolocation game that brings the fun of Bingo into Google Street View! Players jump into a game, navigate through Street View, and try to find specific categories or locations to complete their Bingo boards or lists. After the hunting phase, players vote on each other's finds, leading to a final podium ranking.

## Features

- **Real-Time Multiplayer:** Built with [Supabase](https://supabase.com) Realtime to instantly sync player states, submissions, and voting.
- **Interactive Street View:** Utilizes the Google Maps JavaScript API and Street View Static API so players can explore and capture the perfect angle of their findings.
- **Game Modes:** Choose between classic List mode or Bingo Mode (dynamic 3×3, 4×4, or 5×5 grid sizes).
- **Team Support:** Play Free-for-All or split into teams.
- **Dynamic AI Categories:** Powered by the Gemini API, each game generates unique and fun categories with selectable difficulty (easy, default, hard) to keep things fresh.
- **Nearby Place Categories:** Optionally generate categories from real Points of Interest near the game area using the Google Places API, so every game reflects its actual surroundings.
- **Nearby Street View Categories:** Gemini's vision API scans random Street View panoramas inside the game area and derives categories directly from what's visible on the streets.
- **AI Submission Verification:** Optionally have Gemini vision-check captures against their category, automatically ending the round once every tile passes.
- **Map Areas:** Hosts can create allow and disallow regions on the map to guide players to specific areas or landmarks.
- **Custom Settings:** Hosts can customize game duration, category exclusivity (first-finder or shared), win conditions, and more.
- **Snapshot Memory:** Bingo tiles update with the Street View snapshot of your exact camera position, zoom, and angle once you find a category.
- **Blind Voting System:** Players vote anonymously on the validity of other players' submissions.
- **Podium Ceremony:** See who scored the most points with a clean, animated results view.
- **Internationalization:** The UI and AI-generated categories are available in English, German, Spanish, French, and Chinese (Simplified). The language is auto-detected from the browser and can be switched at any time.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) 16 (App Router, Turbopack)
- **Backend & Database:** [Supabase](https://supabase.com/) (PostgreSQL & Realtime Channels)
- **AI:** [Gemini API](https://ai.google.dev/gemini) for generating dynamic categories and verifying submissions
- **Maps:** `@react-google-maps/api` & Google Maps APIs (JavaScript API, Street View Static API, Places API)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) v4
- **Deployment:** [Vercel](https://vercel.com/) (Analytics & Speed Insights included)
- **Security:** Postgres Row-Level Security — all writes go through `SECURITY DEFINER` RPCs that validate the caller (`host_id` / `player_id`) and whitelist the columns they may touch.

## Getting Started

### Prerequisites

Make sure you have Node.js installed, as well as a Supabase project and a Google Cloud project with the Maps JavaScript API, Street View Static API, and Places API enabled.

### 1. Clone the repository

```bash
git clone https://github.com/leoxnard/geo-bingo.git
cd geo-bingo
```

### 2. Install dependencies

```bash
npm install
# or
yarn install
```

### 3. Environment Variables

Create a `.env.local` file in the root directory and add the following keys. You will need to get these from your Supabase dashboard and Google Cloud console.

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
# Server-side only (no NEXT_PUBLIC_ prefix) — proxied via /api/gemini so the key
# never reaches the browser. Restrict the Maps key by HTTP referrer in Google Cloud.
#
# Gemini keys: a single GEMINI_API_KEY works for everything. To shield verification
# from the free tier's per-minute limit, optionally set two keys — a free-tier key
# for category generation and a paid-tier key for the verification bursts. Each tier
# falls back to GEMINI_API_KEY if its specific key is unset.
GEMINI_API_KEY=your_gemini_api_key
# GEMINI_API_KEY_FREE=your_free_tier_key   # used for AI category generation
# GEMINI_API_KEY_PAID=your_paid_tier_key   # used for submission verification
```

### 4. Set up the database

**Fresh project:** run the full schema in [`supabase/schema.sql`](supabase/schema.sql) from the Supabase SQL editor. It is the source of truth — it creates the tables, RLS policies, and the `SECURITY DEFINER` functions the client calls via `supabase.rpc(...)`.

The files in [`supabase/migrations/`](supabase/migrations/) are the **incremental** function/policy changes that have already been folded into `schema.sql`; they do **not** contain the `CREATE TABLE` statements, so they can't bootstrap an empty database on their own. Use them only to apply a specific later change to a project that already has the tables.

After any schema change, regenerate the dump with `npm run generate:schema` (requires Docker).

### 5. Run the Development Server

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## How to Play

1. **Create a Match:** A host creates a game room, picks a map area, and generates custom categories.
2. **Join the Game:** Players join via the game link/ID.
3. **The Hunt:** Players get dropped into Street View. Whenever you spot a category (e.g., "A red car", "A funny sign"), point your camera at it and capture!
4. **Voting:** Once the hunt ends, players review everyone's submissions and vote if they actually captured the prompt.
5. **Results:** The points are tallied, and the winner is crowned!

## License

This project is created for fun. Feel free to fork and build upon it!
