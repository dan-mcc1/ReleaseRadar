# ReleaseRadar

A full-stack web application for tracking movies and TV shows — manage your watchlist, log what you've watched, follow friends, and stay on top of new releases, all in one place.

Live at [releaseradar.co](https://releaseradar.co)

## Features

### Tracking
- **Watch tracking** — Mark movies and full TV shows as watched; track progress at the season and episode level
- **Watchlist** — Queue up titles you want to watch with a dedicated watchlist
- **Currently Watching** — A separate in-progress state for shows you've started but haven't finished
- **Auto-complete** — When you mark every episode of a season watched, the show automatically moves to Watched
- **Auto-reactivation** — When a new season drops on a show you've finished, it automatically moves back to your Watchlist
- **Rewatch tracking** — Log and track multiple rewatches of a title
- **Finish-by goals** — Set a target date to finish a show or movie

### Discovery
- **Search** — Full-text search across movies, TV shows, and people
- **Trending** — Browse currently trending titles on TMDb
- **Browse Genres** — Explore titles filtered by genre
- **Box Office** — See current box office rankings
- **For You** — Personalized recommendations based on your watch history (recent and top-rated modes)
- **Collections** — Browse movie collections and franchises (e.g. Marvel, Star Wars)
- **Person pages** — Browse filmographies for actors, directors, and crew

### Calendar & Releases
- **Release calendar** — Day-by-day view of upcoming movie and TV releases with inline episode details
- **Upcoming** — A dedicated page for content you're tracking that hasn't released yet
- **iCal sync** — Subscribe to a personal calendar feed of your tracked releases in any calendar app
- **News** — Entertainment news pulled for titles you follow

### Social
- **Friends** — Send/accept friend requests and see what friends are watching
- **Activity feed** — A social timeline of watch activity across your friend network
- **Reviews** — Write and like reviews for movies and shows
- **Friend profiles** — View a friend's watched list, watchlist, stats, and shelves

### Organization
- **Shelves** — Create custom lists to organize titles however you want (e.g. "Best of 2024", "Watch with family")
- **Favorites** — Star titles as favorites for quick access
- **Import/Export** — Import your watch history and export your data

### Stats & Profile
- **Watch time stats** — Total hours watched, broken down by genre, platform, and time period
- **Profile page** — Public profile showing your stats, activity, and shelves
- **Streaming services** — Set your subscribed streaming services to filter what's available to you

### Notifications & Email
- **Daily email digest** — Opt-in email summary of upcoming releases for titles you're tracking, sent at your preferred local time
- **Season premiere alerts** — Email notification when a new season of a tracked show is about to premiere
- **Trailer notifications** — Get notified when a new trailer drops for a title on your watchlist
- **Streaming availability** — Get notified when a title becomes available on a service you subscribe to
- **In-app notifications** — Bell icon with unread count for all notification types

### Other
- **Pricing / Pro tier** — Premium features available via subscription (billing via Stripe)
- **Feedback** — Built-in feedback submission form
- **Admin panel** — Moderation, user management, and feedback review (admin-only)

## Tech Stack

**Frontend**
- React + TypeScript
- Vite
- Tailwind CSS
- TanStack Query (React Query) — server state with persistence
- Firebase (client-side auth)

**Backend**
- Python + FastAPI
- SQLAlchemy ORM
- PostgreSQL (hosted on Neon)
- Firebase Admin SDK (token verification)
- Rate limiting via SlowAPI

**External APIs**
- [TMDb](https://www.themoviedb.org/documentation/api) — movie and TV metadata, images, trending, recommendations
- [OMDb](https://www.omdbapi.com/) — supplemental movie data
- [TVMaze](https://www.tvmaze.com/api) — episode data
- [Resend](https://resend.com/) — transactional email delivery
- Stripe — subscription billing

## Architecture Overview

The backend is a FastAPI app with one router file per feature area (`routers/`) and a service layer (`services/`) for business logic. TMDb data is cached in PostgreSQL to avoid redundant external API calls.

Five background async loops run on startup:
- **Hourly** — cleans up old activity and expired recommendations
- **3am Eastern** — refreshes episode data, reactivates watched shows with new seasons, updates vote averages, prunes stale cache
- **9am–rolling** — sends daily email digests and season premiere alerts (fires every hour, filters users by their preferred local hour)
- **Noon Eastern** — refreshes trailers and notifies users of new ones
- **11am Eastern** — refreshes streaming provider availability and notifies users of changes

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A PostgreSQL database (free tier on [Neon](https://neon.tech) works fine)
- A [Firebase](https://firebase.google.com/) project for authentication
- A [TMDb API](https://www.themoviedb.org/settings/api) bearer token (free)
- Optionally: OMDb API key, Resend API key, Stripe keys

### 1. Clone the repo

```bash
git clone https://github.com/dan-mcc1/ReleaseRadar.git
cd ReleaseRadar
```

### 2. Backend setup

```bash
cd backend/
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```env
DATABASE_URL=postgresql://user:password@host/dbname
TMDB_BEARER_TOKEN=your_tmdb_bearer_token
FIREBASE_CREDS_PATH=./firebase-service.json
RESEND_API_KEY=your_resend_key
EMAIL_FROM=noreply@yourdomain.com
OMDB_API_KEY=your_omdb_key
ICAL_SECRET=any_random_secret
UNSUBSCRIBE_KEY=any_random_secret
FRONTEND_URL=http://localhost:5173
```

Download your Firebase service account JSON from the Firebase console and save it as `backend/firebase-service.json`.

Start the dev server:

```bash
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`.

### 3. Frontend setup

```bash
cd frontend/
npm install
```

Create a `.env` file in `frontend/`:

```env
VITE_API_URL=http://localhost:8000
VITE_APP_FIREBASE_API_KEY=
VITE_APP_FIREBASE_AUTH_DOMAIN=
VITE_APP_FIREBASE_PROJECT_ID=
VITE_APP_FIREBASE_APP_ID=
```

Fill in the Firebase values from your Firebase project settings (Project Settings → Your apps → Web app → SDK config).

Start the dev server:

```bash
npm run dev
```

The app will be running at `http://localhost:5173`.

### Useful commands

```bash
# Backend
python -m pytest tests/ -v          # Run all tests
python -m pytest tests/test_auto_status.py -v  # Run a single test file
uvicorn app.main:app --reload        # Dev server

# Frontend
npm run dev      # Dev server
npm run build    # TypeScript check + production build
npm run lint     # ESLint
```

## Contributing

1. Fork the repo and create a branch from `main`
2. Make your changes — keep PRs focused on a single feature or fix
3. Run the test suite (`python -m pytest tests/ -v`) and linter (`npm run lint`) before submitting
4. Open a pull request with a clear description of what changed and why

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/dan-mcc1/ReleaseRadar/issues).

## License

MIT
