import { useEffect, useState } from "react";
import type { Show, Movie } from "../types/calendar";
import { API_URL } from "../constants";
import { firebaseApp } from "../firebase";
import { getAuth } from "firebase/auth";
import MediaCard from "../components/MediaCard";

type TabType = "all" | "movies" | "tv";
type SortType = "default" | "rating_desc" | "rating_asc";

function sortByRating<T extends { user_rating?: number | null }>(items: T[], dir: "asc" | "desc"): T[] {
  return [...items].sort((a, b) => {
    const ra = a.user_rating ?? null;
    const rb = b.user_rating ?? null;
    if (ra === null && rb === null) return 0;
    if (ra === null) return 1;
    if (rb === null) return -1;
    return dir === "desc" ? rb - ra : ra - rb;
  });
}

export default function Watched() {
  const [results, setResults] = useState<{ movies: Movie[]; shows: Show[] }>({
    movies: [],
    shows: [],
  });
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [sort, setSort] = useState<SortType>("default");
  const auth = getAuth(firebaseApp);

  async function onRemove(type: "tv" | "movie", content_id: number) {
    const user = auth.currentUser;
    if (!user) { alert("You must be signed in."); return; }

    try {
      const res = await fetch(`${API_URL}/watched/remove`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content_type: type, content_id }),
      });
      if (!res.ok) throw new Error("Failed to remove item");
      setResults((prev) => ({
        movies: type === "movie" ? prev.movies.filter((m) => m.id !== content_id) : prev.movies,
        shows: type === "tv" ? prev.shows.filter((s) => s.id !== content_id) : prev.shows,
      }));
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) { alert("You must be signed in."); return; }
      try {
        const res = await fetch(`${API_URL}/watched`, {
          headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setResults({ movies: data.movies ?? [], shows: data.shows ?? [] });
      } catch (err) {
        console.error(err);
      }
    });
    return () => unsubscribe();
  }, []);

  const totalCount = results.movies.length + results.shows.length;

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalCount },
    { id: "movies", label: "Movies", count: results.movies.length },
    { id: "tv", label: "TV Shows", count: results.shows.length },
  ];

  const showMovies = activeTab === "all" || activeTab === "movies";
  const showTV = activeTab === "all" || activeTab === "tv";

  const sortedMovies = sort === "rating_desc"
    ? sortByRating(results.movies, "desc")
    : sort === "rating_asc"
    ? sortByRating(results.movies, "asc")
    : results.movies;

  const sortedShows = sort === "rating_desc"
    ? sortByRating(results.shows, "desc")
    : sort === "rating_asc"
    ? sortByRating(results.shows, "asc")
    : results.shows;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">Watched</h1>
            <span className="bg-green-600/20 text-green-400 border border-green-600/30 text-sm font-medium px-2.5 py-0.5 rounded-full">
              {totalCount}
            </span>
          </div>
          {totalCount > 0 && (
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="text-sm bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500"
            >
              <option value="default">Sort: Default</option>
              <option value="rating_desc">Rating: High to Low</option>
              <option value="rating_asc">Rating: Low to High</option>
            </select>
          )}
        </div>
        <p className="text-slate-400">Everything you've already seen</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-green-500 text-green-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.id ? "bg-green-600/30 text-green-300" : "bg-slate-700 text-slate-400"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-slate-300 font-medium mb-1">Nothing watched yet</h3>
          <p className="text-slate-500 text-sm">Mark items as watched from their detail pages</p>
        </div>
      )}

      {/* Movies */}
      {showMovies && results.movies.length > 0 && (
        <div className="mb-10">
          {activeTab === "all" && (
            <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
              Movies
              <span className="text-xs text-slate-500 font-normal bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                {results.movies.length}
              </span>
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedMovies.map((item) => (
              <MediaCard key={`movie-${item.id}`} type="movie" item={item} onRemove={onRemove} />
            ))}
          </div>
        </div>
      )}

      {/* TV Shows */}
      {showTV && results.shows.length > 0 && (
        <div>
          {activeTab === "all" && (
            <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
              TV Shows
              <span className="text-xs text-slate-500 font-normal bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                {results.shows.length}
              </span>
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedShows.map((item) => (
              <MediaCard key={`tv-${item.id}`} type="tv" item={item} onRemove={onRemove} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
