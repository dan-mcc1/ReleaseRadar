import { useEffect, useState } from "react";
import type { Show, Movie } from "../types/calendar";
import { API_URL } from "../constants";
import { firebaseApp } from "../firebase";
import { getAuth } from "firebase/auth";
import MediaCard from "../components/MediaCard";
import { usePageTitle } from "../hooks/usePageTitle";

type TabType = "all" | "movies" | "tv";
type SortType = "default" | "title_asc" | "title_desc" | "date_desc" | "date_asc" | "popularity_desc" | "rating_desc" | "rating_asc";

function getTitle(item: Movie | Show) {
  return "title" in item ? item.title : item.name;
}

function getDate(item: Movie | Show): string {
  return ("release_date" in item ? item.release_date : item.first_air_date) ?? "";
}

function applySort<T extends Movie | Show>(items: T[], sort: SortType): T[] {
  const sorted = [...items];
  switch (sort) {
    case "title_asc":
      return sorted.sort((a, b) => getTitle(a).localeCompare(getTitle(b)));
    case "title_desc":
      return sorted.sort((a, b) => getTitle(b).localeCompare(getTitle(a)));
    case "date_desc":
      return sorted.sort((a, b) => getDate(b).localeCompare(getDate(a)));
    case "date_asc":
      return sorted.sort((a, b) => getDate(a).localeCompare(getDate(b)));
    case "popularity_desc":
      return sorted.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    case "rating_desc":
      return sorted.sort((a, b) => {
        const ra = a.user_rating ?? null;
        const rb = b.user_rating ?? null;
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return rb - ra;
      });
    case "rating_asc":
      return sorted.sort((a, b) => {
        const ra = a.user_rating ?? null;
        const rb = b.user_rating ?? null;
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra - rb;
      });
    default:
      return sorted;
  }
}

export default function Watched() {
  usePageTitle("Watched");
  const [results, setResults] = useState<{ movies: Movie[]; shows: Show[] }>({
    movies: [],
    shows: [],
  });
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [query, setQuery] = useState("");
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

  const q = query.toLowerCase();
  const filteredMovies = applySort(
    results.movies.filter((m) => m.title.toLowerCase().includes(q)),
    sort
  );
  const filteredShows = applySort(
    results.shows.filter((s) => s.name.toLowerCase().includes(q)),
    sort
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-white">Watched</h1>
          <span className="bg-green-600/20 text-green-400 border border-green-600/30 text-sm font-medium px-2.5 py-0.5 rounded-full">
            {totalCount}
          </span>
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

      {/* Search + Sort */}
      {totalCount > 0 && (
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search watched…"
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-slate-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortType)}
            className="text-sm bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
          >
            <option value="default">Sort: Default</option>
            <option value="title_asc">Title: A → Z</option>
            <option value="title_desc">Title: Z → A</option>
            <option value="date_desc">Release Date: Newest</option>
            <option value="date_asc">Release Date: Oldest</option>
            <option value="popularity_desc">Most Popular</option>
            <option value="rating_desc">Rating: High → Low</option>
            <option value="rating_asc">Rating: Low → High</option>
          </select>
        </div>
      )}

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

      {/* No search results */}
      {totalCount > 0 && query && filteredMovies.length === 0 && filteredShows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400 font-medium mb-1">No results for "{query}"</p>
          <p className="text-slate-500 text-sm">Try a different search term</p>
        </div>
      )}

      {/* Movies */}
      {showMovies && filteredMovies.length > 0 && (
        <div className="mb-10">
          {activeTab === "all" && (
            <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
              Movies
              <span className="text-xs text-slate-500 font-normal bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                {filteredMovies.length}
              </span>
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMovies.map((item) => (
              <MediaCard key={`movie-${item.id}`} type="movie" item={item} onRemove={onRemove} />
            ))}
          </div>
        </div>
      )}

      {/* TV Shows */}
      {showTV && filteredShows.length > 0 && (
        <div>
          {activeTab === "all" && (
            <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
              TV Shows
              <span className="text-xs text-slate-500 font-normal bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                {filteredShows.length}
              </span>
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredShows.map((item) => (
              <MediaCard key={`tv-${item.id}`} type="tv" item={item} onRemove={onRemove} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
