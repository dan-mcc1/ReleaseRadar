import { useEffect, useState } from "react";
import Calendar from "../components/Calendar";
import MediaList from "../components/MediaList";
import type {
  Show,
  ShowWithCalendar,
  CalendarData,
  Movie,
  Person,
} from "../types/calendar";
import { API_URL } from "../constants";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { firebaseApp } from "../firebase";
import CurrentlyWatchingStrip from "../components/CurrentlyWatchingStrip";
import CalendarSyncModal from "../components/CalendarSyncModal";
import { usePageTitle } from "../hooks/usePageTitle";
import { Link } from "react-router-dom";
import { getDashboardCache, setDashboardCache } from "../utils/dashboardCache";

export default function Dashboard() {
  usePageTitle();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [CalendarData, setCalendarData] = useState<CalendarData>({
    shows: [],
    movies: [],
  });
  const [watchedEpisodeKeys, setWatchedEpisodeKeys] = useState<Set<string>>(
    new Set(),
  );
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [currentlyWatchingShows, setCurrentlyWatchingShows] = useState<Show[]>(
    [],
  );
  const [currentlyWatchingMovies, setCurrentlyWatchingMovies] = useState<
    Movie[]
  >([]);

  // Guest view data
  const [trendingResults, setTrendingResults] = useState<{
    movies: Movie[];
    shows: Show[];
    people: Person[];
  }>({ movies: [], shows: [], people: [] });
  const [upcomingResults, setUpcomingResults] = useState<{
    movies: Movie[];
    shows: Show[];
  }>({ movies: [], shows: [] });
  const [guestLoading, setGuestLoading] = useState(false);

  const auth = getAuth(firebaseApp);

  async function fetchTVCalendar(): Promise<ShowWithCalendar[]> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return [];
    const res = await fetch(`${API_URL}/watchlist/tv/calendar`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return res.json();
  }

  async function fetchCurrentlyWatching(): Promise<{
    shows: Show[];
    movies: Movie[];
  }> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return { shows: [], movies: [] };
    const res = await fetch(`${API_URL}/currently-watching/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { shows: [], movies: [] };
    return res.json();
  }

  async function fetchMovieCalendar(): Promise<Movie[]> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return [];
    const res = await fetch(`${API_URL}/watchlist/movie`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to fetch movie watchlist");
    return res.json();
  }

  async function fetchWatchedMovies(): Promise<Movie[]> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return [];
    const res = await fetch(`${API_URL}/watched/movie`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return res.json();
  }

  async function fetchWatchedEpisodeKeys(): Promise<Set<string>> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return new Set();
    const res = await fetch(`${API_URL}/watched-episode/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return new Set();
    const data: {
      show_id: number;
      season_number: number;
      episode_number: number;
    }[] = await res.json();
    return new Set(
      data.map((e) => `${e.show_id}_${e.season_number}_${e.episode_number}`),
    );
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setCalendarData({ shows: [], movies: [] });
      return;
    }

    // Use cached data if available for this user
    const cached = getDashboardCache(user.uid);
    if (cached) {
      setCalendarData(cached.calendarData);
      setWatchedEpisodeKeys(cached.watchedEpisodeKeys);
      setCurrentlyWatchingShows(cached.currentlyWatchingShows);
      setCurrentlyWatchingMovies(cached.currentlyWatchingMovies);
      return;
    }

    async function fetchAllCalendarData() {
      setLoading(true);
      try {
        const [
          tvShows,
          watchlistMovies,
          watchedMovies,
          episodeKeys,
          currentlyWatching,
        ] = await Promise.all([
          fetchTVCalendar(),
          fetchMovieCalendar(),
          fetchWatchedMovies(),
          fetchWatchedEpisodeKeys(),
          fetchCurrentlyWatching(),
        ]);

        setCurrentlyWatchingShows(currentlyWatching.shows);
        setCurrentlyWatchingMovies(currentlyWatching.movies);

        const movieMap = new Map<number, Movie>();
        for (const m of watchlistMovies)
          movieMap.set(m.id, { ...m, isWatched: false });
        for (const m of watchedMovies)
          movieMap.set(m.id, { ...m, isWatched: true });
        for (const m of currentlyWatching.movies) {
          if (!movieMap.has(m.id))
            movieMap.set(m.id, { ...m, isWatched: false });
        }

        const calendarData: CalendarData = {
          shows: tvShows,
          movies: Array.from(movieMap.values()),
        };

        setWatchedEpisodeKeys(episodeKeys);
        setCalendarData(calendarData);

        setDashboardCache({
          calendarData,
          watchedEpisodeKeys: episodeKeys,
          currentlyWatchingShows: currentlyWatching.shows,
          currentlyWatchingMovies: currentlyWatching.movies,
          uid: user!.uid,
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchAllCalendarData();
  }, [user]);

  // Fetch public content for guest view
  useEffect(() => {
    if (authLoading || user) return;

    async function fetchGuestContent() {
      setGuestLoading(true);
      try {
        const today = new Date();
        const min_date = today.toISOString().split("T")[0];
        const nextMonth = new Date(today);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const max_date = nextMonth.toISOString().split("T")[0];

        const [trendingRes, upcomingRes] = await Promise.all([
          fetch(`${API_URL}/search/multi/trending`),
          fetch(
            `${API_URL}/search/movie/upcoming?${new URLSearchParams({ min_date, max_date })}`,
          ),
        ]);

        if (trendingRes.ok) {
          const data = await trendingRes.json();
          setTrendingResults({
            movies: data.movies ?? [],
            shows: data.shows ?? [],
            people: data.people ?? [],
          });
        }

        if (upcomingRes.ok) {
          const data = await upcomingRes.json();
          setUpcomingResults({ movies: data.results ?? [], shows: [] });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setGuestLoading(false);
      }
    }

    fetchGuestContent();
  }, [authLoading, user]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
        {/* Hero */}
        <div className="mb-10 text-center py-8">
          <h1 className="text-4xl font-bold text-white mb-3">
            Track What You Watch
          </h1>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Keep up with your favourite shows and movies. Log what you've
            watched, build your watchlist, and never miss a release.
          </p>
          <p className="text-xs text-slate-600 mb-6 max-w-sm mx-auto">
            Calendar shows initial air dates only — reruns are not included.
          </p>
          <Link
            to="/signIn"
            className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
          >
            Sign in to get started
          </Link>
        </div>

        {guestLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!guestLoading && (
          <div className="flex flex-col gap-14">
            {/* Trending */}
            {(trendingResults.movies.length > 0 ||
              trendingResults.shows.length > 0 ||
              trendingResults.people.length > 0) && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-white">Trending</h2>
                    <span className="text-lg">🔥</span>
                  </div>
                  <Link
                    to="/trending"
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    See all →
                  </Link>
                </div>
                <MediaList
                  results={{
                    movies: trendingResults.movies.slice(0, 6),
                    shows: trendingResults.shows.slice(0, 6),
                    people: trendingResults.people.slice(0, 6),
                  }}
                  showWatchButton={false}
                />
              </div>
            )}

            {/* Upcoming */}
            {upcomingResults.movies.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-white">Coming Soon</h2>
                  <Link
                    to="/upcoming"
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    See all →
                  </Link>
                </div>
                <MediaList
                  results={{
                    movies: upcomingResults.movies.slice(0, 6),
                    shows: [],
                  }}
                  showWatchButton={false}
                />
              </div>
            )}

            {/* Browse */}
            <div>
              <h2 className="text-2xl font-bold text-white mb-4">
                Browse by Genre
              </h2>
              <Link
                to="/search-genres"
                className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-200 font-medium px-5 py-3 rounded-xl transition-colors"
              >
                <svg
                  className="w-5 h-5 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 6h16M4 10h16M4 14h16M4 18h16"
                  />
                </svg>
                Browse all genres
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  function handleEpisodeWatched(
    showId: number,
    season: number,
    episode: number,
  ) {
    const key = `${showId}_${season}_${episode}`;
    setWatchedEpisodeKeys((prev) => new Set([...prev, key]));
  }

  return (
    <div>
      <CurrentlyWatchingStrip
        shows={currentlyWatchingShows}
        movies={currentlyWatchingMovies}
        user={user}
        onEpisodeWatched={handleEpisodeWatched}
      />
      <Calendar
        calendarData={CalendarData}
        setCalendarData={setCalendarData}
        showWatchlist={showWatchlist}
        setShowWatchlist={setShowWatchlist}
        user={user}
        watchedEpisodeKeys={watchedEpisodeKeys}
        onMarkEpisodeWatched={handleEpisodeWatched}
        isLoading={loading}
        onSyncCalendar={() => setShowSyncModal(true)}
      />
      <CalendarSyncModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
      />
    </div>
  );
}
