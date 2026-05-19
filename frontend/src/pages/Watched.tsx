import { useState, useMemo } from "react";
import type { Show, Movie } from "../types/calendar";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import ListFilterPanel, {
  DEFAULT_FILTERS,
  type ListFilters,
  countActiveFilters,
  applyFilters,
} from "../components/ListFilterPanel";
import { usePageTitle } from "../hooks/usePageTitle";
import { useWatched, useRemoveFromList } from "../hooks/api/useLists";
import { useMyProviderIds } from "../hooks/api/useStreamingServices";

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

type CombinedItem = (Movie | Show) & { _contentType: "movie" | "tv" };

function getTitle(item: Movie | Show) {
  return "title" in item ? item.title : item.name;
}

function getDate(item: Movie | Show): string {
  return (
    ("release_date" in item ? item.release_date : item.first_air_date) ?? ""
  );
}

function applySort<T extends Movie | Show>(items: T[], sort: SortType): T[] {
  const sorted = [...items];
  switch (sort) {
    case "watched_desc":
      return sorted.sort((a, b) =>
        ((b as any).watched_at ?? "").localeCompare(
          (a as any).watched_at ?? "",
        ),
      );
    case "watched_asc":
      return sorted.sort((a, b) =>
        ((a as any).watched_at ?? "").localeCompare(
          (b as any).watched_at ?? "",
        ),
      );
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
      return sorted.sort(
        (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0),
      );
    case "tmdb_rating_asc":
      return sorted.sort(
        (a, b) => (a.vote_average ?? 0) - (b.vote_average ?? 0),
      );
    default:
      return sorted;
  }
}

function WatchedCard({
  item,
  onNavigate,
  onRemove,
}: {
  item: CombinedItem;
  onNavigate: () => void;
  onRemove: () => void;
}) {
  const title = getTitle(item);
  const userRating = item.user_rating;

  return (
    <div className="flex flex-col gap-2 group/card">
      <div className="relative cursor-pointer" onClick={onNavigate}>
        <div className="aspect-[2/3] rounded-xl overflow-hidden bg-neutral-800">
          {item.poster_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w342${item.poster_path}`}
              alt={title}
              className="w-full h-full object-cover transition-opacity duration-200 group-hover/card:opacity-85"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-3 text-center">
              <span className="text-neutral-600 text-xs leading-tight">
                {title}
              </span>
            </div>
          )}
        </div>

        {/* User rating badge */}
        {userRating != null && (
          <div className="absolute top-2 right-2 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-primary-500 text-neutral-950 flex items-center justify-center shadow-lg text-[11px] font-bold leading-none">
            {userRating}
          </div>
        )}

        {/* Remove button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from watched"
          className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/70 text-neutral-400 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity hover:text-white hover:bg-black/90"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div>
        <p className="text-[13.5px] font-semibold text-neutral-100 leading-tight tracking-tight truncate">
          {title}
        </p>
      </div>
    </div>
  );
}

export default function Watched() {
  usePageTitle("Watched");
  const navigate = useNavigate();
  const { data, isLoading } = useWatched();
  const removeFromList = useRemoveFromList();
  const myProviderIds = useMyProviderIds();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabType) ?? "all";
  function setActiveTab(tab: TabType) {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortType>("watched_desc");
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const results = data ?? { movies: [], shows: [] };

  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    [...results.movies, ...results.shows].forEach((item) =>
      (item.genres ?? []).forEach((g) => set.add(g.name)),
    );
    return [...set].sort();
  }, [results.movies, results.shows]);

  const availableCertifications = useMemo(() => {
    const set = new Set<string>();
    [...results.movies, ...results.shows].forEach((item) => {
      if (item.certification) set.add(item.certification);
    });
    return [...set];
  }, [results.movies, results.shows]);

  const activeFilterCount = countActiveFilters(filters);

  function onRemove(type: "tv" | "movie", content_id: number) {
    removeFromList.mutate({
      list: "watched",
      contentType: type,
      contentId: content_id,
    });
  }

  const totalCount = results.movies.length + results.shows.length;
  const q = query.toLowerCase();

  const filteredMovies = applySort(
    applyFilters(
      results.movies.filter((m) => m.title.toLowerCase().includes(q)),
      filters,
      myProviderIds,
    ),
    sort,
  );
  const filteredShows = applySort(
    applyFilters(
      results.shows.filter((s) => s.name.toLowerCase().includes(q)),
      filters,
      myProviderIds,
    ),
    sort,
  );

  const gridItems: CombinedItem[] = useMemo(() => {
    switch (activeTab) {
      case "movies":
        return filteredMovies.map((m) => ({
          ...m,
          _contentType: "movie" as const,
        }));
      case "tv":
        return filteredShows.map((s) => ({
          ...s,
          _contentType: "tv" as const,
        }));
      case "all":
      default:
        return [
          ...filteredMovies.map((m) => ({
            ...m,
            _contentType: "movie" as const,
          })),
          ...filteredShows.map((s) => ({ ...s, _contentType: "tv" as const })),
        ];
    }
  }, [activeTab, filteredMovies, filteredShows]);

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalCount },
    { id: "movies", label: "Movies", count: results.movies.length },
    { id: "tv", label: "TV Shows", count: results.shows.length },
  ];

  const hasResults = gridItems.length > 0;

  return (
    <div className="w-full px-6 sm:px-10 pt-8 pb-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-neutral-500">
          {totalCount} title{totalCount !== 1 ? "s" : ""} watched
        </p>
        <div className="flex items-baseline gap-4 mt-2 flex-wrap">
          <h1
            className="text-4xl font-normal leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Already{" "}
            <em className="text-primary-400" style={{ fontStyle: "italic" }}>
              watched
            </em>
          </h1>
          <div className="flex-1 hidden sm:block" />
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                showFilters || activeFilterCount > 0
                  ? "bg-primary-600/20 border-primary-600/40 text-primary-300"
                  : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
                />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-primary-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="text-sm bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-neutral-500 max-w-[160px] sm:max-w-none"
            >
              <option value="watched_desc">Recently Watched</option>
              <option value="watched_asc">Oldest Watched</option>
              <option value="title_asc">Title: A → Z</option>
              <option value="title_desc">Title: Z → A</option>
              <option value="date_desc">Release Date: Newest</option>
              <option value="date_asc">Release Date: Oldest</option>
              <option value="popularity_desc">Most Popular</option>
              <option value="rating_desc">My Rating: High → Low</option>
              <option value="rating_asc">My Rating: Low → High</option>
              <option value="tmdb_rating_desc">TMDB Rating: High → Low</option>
              <option value="tmdb_rating_asc">TMDB Rating: Low → High</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-neutral-800 mt-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-3 text-sm font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? "border-primary-500 text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {tab.label}
              <span className="font-mono text-[10.5px] text-neutral-500 leading-none translate-y-px">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Search + filter panel */}
      {!isLoading && totalCount > 0 && (
        <div className="mt-4 space-y-3">
          <div className="relative max-w-xs">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full bg-neutral-800/60 border border-neutral-700 text-neutral-200 placeholder-neutral-600 rounded-lg pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:border-neutral-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
          {showFilters && (
            <ListFilterPanel
              filters={filters}
              onChange={setFilters}
              availableGenres={availableGenres}
              availableCertifications={availableCertifications}
              hasMyServices={myProviderIds.size > 0}
              showUserRating
            />
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-8">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 animate-pulse">
              <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
              <div className="h-3 bg-neutral-800 rounded w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Empty watched list */}
      {!isLoading && totalCount === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center mt-8">
          <div className="w-16 h-16 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-neutral-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-neutral-300 font-medium mb-1">
            Nothing watched yet
          </h3>
          <p className="text-neutral-500 text-sm mb-4">
            Find something to watch and mark it as watched from its detail page
          </p>
          <button
            onClick={() => navigate("/trending")}
            className="bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            Browse Trending
          </button>
        </div>
      )}

      {/* No results */}
      {!isLoading && totalCount > 0 && !hasResults && (
        <div className="flex flex-col items-center justify-center py-24 text-center mt-8">
          <p className="text-neutral-400 font-medium mb-1">
            {activeFilterCount > 0
              ? "No results match your filters"
              : `No results for "${query}"`}
          </p>
          {activeFilterCount > 0 ? (
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="text-primary-400 hover:text-primary-300 text-sm mt-1 transition-colors"
            >
              Clear filters
            </button>
          ) : (
            <p className="text-neutral-500 text-sm">
              Try a different search term
            </p>
          )}
        </div>
      )}

      {/* Poster grid */}
      {!isLoading && hasResults && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6 mt-8">
          {gridItems.map((item) => (
            <WatchedCard
              key={`${item._contentType}-${item.id}`}
              item={item}
              onNavigate={() =>
                navigate(
                  `/${item._contentType === "movie" ? "movie" : "tv"}/${item.id}`,
                )
              }
              onRemove={() => onRemove(item._contentType, item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
