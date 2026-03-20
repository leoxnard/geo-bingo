# 🌍 Geo Bingo

Geo Bingo is a multiplayer geolocation game that brings the fun of Bingo into Google Street View! Players jump into a shared game, navigate through Street View, and try to find specific categories or locations to complete their Bingo boards. After the hunting phase, players vote on each other's finds, leading to a final podium ranking.

## Features

- **Real-Time Multiplayer:** Built with [Supabase](https://supabase.com) Realtime to instantly sync player states, submissions, and voting.
- **Interactive Street View:** Utilizes the Google Maps JavaScript API and Street View Static API so players can explore and capture the perfect angle of their findings.
- **Game Modes:** Choose between classic List mode or Bingo Mode (dynamic grid sizes).
- **Snapshot Memory:** Bingo tiles update with the Street View snapshot of your exact camera position, zoom, and angle once you find a category!
- **Blind Voting System:** Players vote anonymously on the validity of other players' submissions.
- **Podium Ceremony:** See who scored the most points with a clean, animated results view.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router, Turbopack)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Backend & Database:** [Supabase](https://supabase.com/) (PostgreSQL & Realtime Channels)
- **Maps:** `@react-google-maps/api` & Google Maps APIs
- **Icons:** `react-icons`

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
```

### 4. Run the Development Server
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
