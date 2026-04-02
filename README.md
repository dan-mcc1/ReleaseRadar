# 📅 ReleaseRadar

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
2. Setup backend
   ```bash
   cd backend/
   pip install -r requirements.txt
   ```
   
3. Install dependencies
   ```bash
   cd frontend/
   npm install
   ```
   
4. Set up the database and firebase
   Go to neon and create a project to connect to
   Go to firebase and create a project for authentication

5. Set up environment variables — create a `.env` file in the frontend directory:
   ```env
   VITE_APP_FIREBASE_API_KEY=
   VITE_APP_FIREBASE_AUTH_DOMAIN=
   VITE_APP_FIREBASE_PROJECT_ID=
   VITE_APP_FIREBASE_STORAGE_BUCKET=
   VITE_APP_FIREBASE_MESSAGING_SENDER_ID=
   VITE_APP_FIREBASE_APP_ID=
   VITE_APP_FIREBASE_MEASUREMENT_ID=
   ```
6. Setup backend environment variables
   ```env
   TMDB_BEARER_TOKEN=
   DATABASE_URL=postgresql://neondb_owner
   FIREBASE_CREDS_PATH=./firebase-service.json
   FRONTEND_URL=http://localhost:5173
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=
   SMTP_PASSWORD=
   SMTP_FROM=
   ICAL_SECRET=
   ```

7. Start the development server
   ```bash
   cd frontend/
   npm run dev
   ```
   In another terminal
   ```bash
   cd backend/
   uvicorn app.main:app --reload
   ```

The app will be running at `http://localhost:5173`.

## How It Works

The app integrates with the [TMDb API](https://www.themoviedb.org/documentation/api) to fetch real-time movie and TV data. To avoid excessive API calls and slow load times, responses are cached in PostgreSQL — so frequently accessed data is served from the database rather than re-fetched on every request.

The release calendar pulls upcoming release dates and displays them day-by-day. Clicking an entry expands it inline to show episode or movie details, runtime, and other metadata from TMDb.

## Roadmap

- [ ] Granular episode-level watch tracking
- [ ] Filter dashboard by unwatched episodes
- [ ] Social features (share watchlists, see what friends are watching)

## License

MIT
