import { useState } from "react";
import type { Show, Movie } from "../types/calendar";
import { useNavigate } from "react-router-dom";
import MediaCard from "../components/MediaCard";
import { usePageTitle } from "../hooks/usePageTitle";
import { useWatched, useRemoveFromList } from "../hooks/api/useLists";

type TabType = "all" | "movies" | "tv";
type SortType =
  | "default"
  | "watched_desc"
  | "watched_asc"
  | "title_asc"
  | "title_desc"
  | "date_desc"
  | "date_asc"
  | "popularity_desc"
  | "rating_desc"
  | "rating_asc"
  | "tmdb_rating_desc"
  | "tmdb_rating_asc";

function getTitle(item: Movie | Show) {
  return "title" in item ? item.title : item.name;
}

function getDate(item: Movie | Show): string {
  return (("release_date" in item ? item.release_date : item.first_air_date) ?? "");
}

function applySort<T extends Movie | Show>(items: T[], sort: SortType): T[] {
  const sorted = [...items];
  switch (sort) {
    case "watched_desc":
      return sorted.sort((a, b) => ((b as any).watched_at ?? "").localeCompare((a as any).watched_at ?? ""));
    case "watched_asc":
      return sorted.sort((a, b) => ((a as any).watched_at ?? "").localeCompare((b as any).watched_at ?? ""));
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
    case "tmdb_rating_desc":
      return sorted.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    case "tmdb_rating_asc":
      return sorted.sort((a, b) => (a.vote_average ?? 0) - (b.vote_average ?? 0));
    default:
      return sorted;
  }
}

export default function Watched() {
  usePageTitle("Watched");
  const navigate = useNavigate();
  const { data, isLoading } = useWatched();
  const removeFromList = useRemoveFromList();
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortType>("default");

  const results = data ?? { movies: [], shows: [] };

  function onRemove(type: "tv" | "movie", content_id: number) {
    removeFromList.mutate({ list: "watched", contentType: type, contentId: content_id });
  }

  const totalCount = results.movies.length + results.shows.length;
  const showMovies = activeTab === "all" || activeTab === "movies";
  const showTV = activeTab === "all" || activeTab === "tv";
  const q = query.toLowerCase();
  const filteredMovies = applySort(results.movies.filter((m) => m.title.toLowerCase().includes(q)), sort);
  const filteredShows = applySort(results.shows.filter((s) => s.name.toLowerCase().includes(q)), sort);

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalCount },
    { id: "movies", label: "Movies", count: results.movies.length },
    { id: "tv", label: "TV Shows", count: results.shows.length },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-16">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-white">Watched</h1>
          <span className="bg-success-600/20 text-success-400 border border-success-600/30 text-sm font-medium px-2.5 py-0.5 rounded-full">
            {totalCount}
          </span>
        </div>
        <p className="text-neutral-400">Everything you've already seen</p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden bg-neutral-800 border border-neutral-700 flex flex-col animate-pulse">
              <div className="aspect-[2/3] bg-neutral-700" />
              <div className="p-3 flex flex-col gap-2">
                <div className="h-4 bg-neutral-700 rounded w-3/4" />
                <div className="h-3 bg-neutral-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="flex gap-1 border-b border-neutral-700 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-success-500 text-success-400"
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? "bg-success-600/30 text-success-300" : "bg-neutral-700 text-neutral-400"
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {totalCount > 0 && (
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search watched…"
              className="w-full bg-neutral-800 border border-neutral-700 text-neutral-200 placeholder-neutral-500 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-neutral-500"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortType)}
            className="w-28 sm:w-auto shrink-0 text-sm bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-500"
          >
            <option value="default">Sort: Default</option>
            <option value="watched_desc">Recently Watched</option>
            <option value="watched_asc">Oldest Watched</option>
            <option value="title_asc">Title: A → Z</option>
            <option value="title_desc">Title: Z → A</option>
            <option value="date_desc">Release Date: Newest</option>
            <option value="date_asc">Release Date: Oldest</option>
            <option value="popularity_desc">Most Popular</option>
            <option value="rating_desc">Rating: High → Low</option>
            <option value="rating_asc">Rating: Low → High</option>
            <option value="tmdb_rating_desc">TMDB Rating: High → Low</option>
            <option value="tmdb_rating_asc">TMDB Rating: Low → High</option>
          </select>
        </div>
      )}

      {!isLoading && totalCount === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-neutral-300 font-medium mb-1">Nothing watched yet</h3>
          <p className="text-neutral-500 text-sm mb-4">Find something to watch and mark it as watched from its detail page</p>
          <button onClick={() => navigate("/trending")} className="bg-success-600 hover:bg-success-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
            Browse Trending
          </button>
        </div>
      )}

      {totalCount > 0 && query && filteredMovies.length === 0 && filteredShows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-400 font-medium mb-1">No results for "{query}"</p>
          <p className="text-neutral-500 text-sm">Try a different search term</p>
        </div>
      )}

      {showMovies && filteredMovies.length > 0 && (
        <div className="mb-10">
          {activeTab === "all" && (
            <h2 className="text-lg font-semibold text-neutral-200 mb-4 flex items-center gap-2">
              Movies
              <span className="text-xs text-neutral-500 font-normal bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">{filteredMovies.length}</span>
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMovies.map((item) => (
              <MediaCard key={`movie-${item.id}`} type="movie" item={item} onRemove={onRemove} />
            ))}
          </div>
        </div>
      )}

      {showTV && filteredShows.length > 0 && (
        <div>
          {activeTab === "all" && (
            <h2 className="text-lg font-semibold text-neutral-200 mb-4 flex items-center gap-2">
              TV Shows
              <span className="text-xs text-neutral-500 font-normal bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">{filteredShows.length}</span>
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
