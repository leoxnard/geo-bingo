# 🌍 Geo BingBong

Geo BingBong is a multiplayer geolocation game that brings the fun of Bingo into Google Street View! Players jump into a game, navigate through Street View, and try to find specific categories or locations to complete their Bingo boards or lists. After the hunting phase, players vote on each other's finds, leading to a final podium ranking.

## Features

- **Real-Time Multiplayer:** Built with [Supabase](https://supabase.com) Realtime to instantly sync player states, submissions, and voting.
- **Interactive Street View:** Utilizes the Google Maps JavaScript API and Street View Static API so players can explore and capture the perfect angle of their findings.
- **Game Modes:** Choose between classic List mode or Bingo Mode (dynamic grid sizes).
- **Dynamic Categories:** Powered by the Gemini API, each game generates unique and fun categories to keep things fresh.
- **AI Submission Verification:** Optionally have Gemini vision-check your captures against their category, automatically ending the round once every tile passes.
- **Map Areas:** Hosts can create allow and disallow regions on the map to guide players to specific areas or landmarks.
- **Custom Settings:** Hosts can customize game duration, if categories can only be found by the first player or multiple players, win conditions, and more.
- **Snapshot Memory:** Bingo tiles update with the Street View snapshot of your exact camera position, zoom, and angle once you find a category!
- **Blind Voting System:** Players vote anonymously on the validity of other players' submissions.
- **Podium Ceremony:** See who scored the most points with a clean, animated results view.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router, Turbopack)
- **Backend & Database:** [Supabase](https://supabase.com/) (PostgreSQL & Realtime Channels)
- **AI:** [Gemini API](https://ai.google.dev/gemini) for generating dynamic categories and verifying submissions.
- **Maps:** `@react-google-maps/api` & Google Maps APIs
- **Security:** Postgres Row-Level Security — all writes go through `SECURITY DEFINER` RPCs that validate the caller (`host_id` / `player_id`) and whitelist the columns they may touch.

## Getting Started

### Prerequisites

Make sure you have Node.js installed, as well as a Supabase project and a Google Cloud project with the Maps JavaScript API and Street View Static API enabled.

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
GEMINI_API_KEY=your_gemini_api_key
```

### 4. Set up the database

Apply the database schema to your Supabase project: run the SQL in [`supabase/schema.sql`](supabase/schema.sql) (or the ordered files in [`supabase/migrations/`](supabase/migrations/)) from the Supabase SQL editor. This creates the tables, RLS policies, and the `SECURITY DEFINER` functions the client calls via `supabase.rpc(...)`. Regenerating the dump after a schema change is done with `npm run generate:schema` (requires Docker).

### 5. Run the Development Server

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## How to Play

1. **Create a Match:** A host creates a game room and generates custom categories.
2. **Join the Game:** Players join via the game link/ID.
3. **The Hunt:** Players get dropped into Street View. Whenever you spot a category (e.g., "A red car", "A funny sign"), point your camera at it and capture!
4. **Voting:** Once the hunt ends, players review everyone's submissions and vote if they actually captured the prompt.
5. **Results:** The points are tallied, and the winner is crowned!

## License

This project is created for fun. Feel free to fork and build upon it!
