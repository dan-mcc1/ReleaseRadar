# 📅 TV Watch Calendar

A full-stack web application for tracking your watched content, managing watchlists, and staying up to date on upcoming movie and TV releases — all in one place.

## Features

- **Watch Tracking** — Mark movies and TV shows as watched and maintain a personal watchlist
- **Release Calendar** — Browse upcoming movie and TV releases by day; click any entry to expand episode or movie details including runtime and metadata
- **Media Filtering** — Filter the calendar and dashboard by movies, TV shows, or both
- **Personalized Dashboard** — See all your watched and watchlisted content at a glance across every tracked title
- **Fast Load Times** — Hybrid caching system reduces dashboard load time from ~10s to under 1s and cuts external API calls by 30%

## Tech Stack

**Frontend**
- React
- TypeScript
- Tailwind CSS

**Backend**
- Node.js / Express.js
- PostgreSQL
- TMDb API

## Getting Started

### Prerequisites
- Node.js
- PostgreSQL
- TMDb API key (free at [themoviedb.org](https://www.themoviedb.org/settings/api))

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/dan-mcc1/Watch-Calendar.git
   cd Watch-Calendar
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Set up environment variables — create a `.env` file in the root directory:
   ```env
   TMDB_BEARER_TOKEN=your_api_key_here
   DATABASE_URL=postgresql://localhost:5432/watch_calendar
   ```

4. Set up the database
   ```bash
   npm run db:migrate
   ```

5. Start the development server
   ```bash
   npm run dev
   ```

The app will be running at `http://localhost:3000`.

## How It Works

The app integrates with the [TMDb API](https://www.themoviedb.org/documentation/api) to fetch real-time movie and TV data. To avoid excessive API calls and slow load times, responses are cached in PostgreSQL — so frequently accessed data is served from the database rather than re-fetched on every request.

The release calendar pulls upcoming release dates and displays them day-by-day. Clicking an entry expands it inline to show episode or movie details, runtime, and other metadata from TMDb.

## Roadmap

- [ ] Granular episode-level watch tracking
- [ ] Filter dashboard by unwatched episodes
- [ ] User authentication
- [ ] Social features (share watchlists, see what friends are watching)

## License

MIT
