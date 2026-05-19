import { useState, useCallback, useMemo } from "react";
import type { Show, Movie } from "../types/calendar";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { BASE_IMAGE_URL } from "../constants";
import WatchlistOrderRow from "../components/WatchlistOrderRow";
import ListFilterPanel, {
  DEFAULT_FILTERS,
  type ListFilters,
  countActiveFilters,
  applyFilters,
} from "../components/ListFilterPanel";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useWatchlist,
  useRemoveFromList,
  useReorderWatchlist,
} from "../hooks/api/useLists";
import {
  useShowProgressBulk,
  type ShowProgress,
} from "../hooks/api/useBingePlan";
import { useMyProviderIds } from "../hooks/api/useStreamingServices";

type TabType = "up_next" | "movies" | "shows" | "all";
type SortType =
  | "default"
  | "added_desc"
  | "added_asc"
  | "title_asc"
  | "title_desc"
  | "date_desc"
  | "date_asc"
  | "popularity_desc"
  | "tmdb_rating_desc"
  | "tmdb_rating_asc"
  | "time_remaining_asc"
  | "time_remaining_desc"
  | "my_order";

type CombinedItem = (Movie | Show) & {
  _contentType: "movie" | "tv";
  sort_key: number;
  watchlist_id: number;
};

function getTitle(item: Movie | Show) {
  return "title" in item ? item.title : item.name;
}

function getDate(item: Movie | Show): string {
  return (
    ("release_date" in item ? item.release_date : item.first_air_date) ?? ""
  );
}

function getYear(item: Movie | Show): string {
  return getDate(item).slice(0, 4) || "—";
}

function getTimeRemaining(
  item: Movie | Show,
  bingePlans?: Record<string, ShowProgress>,
): number {
  if ("name" in item) {
    return bingePlans?.[String(item.id)]?.remaining_minutes ?? Infinity;
  }
  return (item as Movie).runtime ?? 0;
}

function applySort<T extends Movie | (Show & { added_at?: string | null })>(
  items: T[],
  sort: SortType,
  bingePlans?: Record<string, ShowProgress>,
): T[] {
  const sorted = [...items];
  switch (sort) {
    case "added_desc":
      return sorted.sort((a, b) =>
        ((b as any).added_at ?? "").localeCompare((a as any).added_at ?? ""),
      );
    case "added_asc":
      return sorted.sort((a, b) =>
        ((a as any).added_at ?? "").localeCompare((b as any).added_at ?? ""),
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
    case "tmdb_rating_desc":
      return sorted.sort(
        (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0),
      );
    case "tmdb_rating_asc":
      return sorted.sort(
        (a, b) => (a.vote_average ?? 0) - (b.vote_average ?? 0),
      );
    case "time_remaining_asc":
      return sorted.sort(
        (a, b) =>
          getTimeRemaining(a, bingePlans) - getTimeRemaining(b, bingePlans),
      );
    case "time_remaining_desc":
      return sorted.sort(
        (a, b) =>
          getTimeRemaining(b, bingePlans) - getTimeRemaining(a, bingePlans),
      );
    default:
      return sorted;
  }
}

function buildCombined(
  movies: Movie[],
  shows: Show[],
  query: string,
): CombinedItem[] {
  const q = query.toLowerCase();
  const filteredMovies = movies
    .filter((m) => m.title.toLowerCase().includes(q) && m.watchlist_id != null)
    .map((m) => ({
      ...m,
      _contentType: "movie" as const,
      sort_key: m.sort_key ?? 0,
      watchlist_id: m.watchlist_id!,
    }));
  const filteredShows = shows
    .filter((s) => s.name.toLowerCase().includes(q) && s.watchlist_id != null)
    .map((s) => ({
      ...s,
      _contentType: "tv" as const,
      sort_key: s.sort_key ?? 0,
      watchlist_id: s.watchlist_id!,
    }));
  return [...filteredMovies, ...filteredShows].sort(
    (a, b) => a.sort_key - b.sort_key,
  );
}

function getProgress(
  item: CombinedItem,
  bingePlans?: Record<string, ShowProgress>,
): number {
  if (item._contentType === "movie") return 0;
  const p = bingePlans?.[String(item.id)];
  if (!p || p.total_episodes === 0) return 0;
  return p.watched_episodes / p.total_episodes;
}

function getStatusText(
  item: CombinedItem,
  bingePlans?: Record<string, ShowProgress>,
): string | null {
  if (item._contentType === "movie") return null;
  const p = bingePlans?.[String(item.id)];
  if (!p || p.watched_episodes === 0) return null;
  if (p.remaining_episodes === 0) return "Caught up";
  return `${p.remaining_episodes} ep${p.remaining_episodes === 1 ? "" : "s"} left`;
}

function WatchlistCard({
  item,
  bingePlans,
  onNavigate,
  onRemove,
}: {
  item: CombinedItem;
  bingePlans?: Record<string, ShowProgress>;
  onNavigate: () => void;
  onRemove: () => void;
}) {
  const progress = getProgress(item, bingePlans);
  const statusText = getStatusText(item, bingePlans);
  const isCaughtUp =
    item._contentType === "tv" &&
    bingePlans?.[String(item.id)]?.remaining_episodes === 0;
  const title = getTitle(item);

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

        {/* Progress bar */}
        {progress > 0 && !isCaughtUp && (
          <div className="absolute left-2 right-2 bottom-2 h-[3px] bg-black/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full"
              style={{ width: `${Math.min(progress * 100, 100)}%` }}
            />
          </div>
        )}

        {/* Caught up badge */}
        {isCaughtUp && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary-500 text-neutral-950 flex items-center justify-center shadow-lg">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        )}

        {/* Remove button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from watchlist"
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
        {statusText && (
          <p className="text-[11.5px] text-neutral-500 mt-1 flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCaughtUp ? "bg-neutral-500" : "bg-primary-500"}`}
            />
            {statusText}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Watchlist() {
  usePageTitle("Watchlist");
  const navigate = useNavigate();
  const { data, isPending: loading } = useWatchlist();
  const myProviderIds = useMyProviderIds();
  const results = data ?? { movies: [], shows: [] };
  const removeFromList = useRemoveFromList();
  const reorderWatchlist = useReorderWatchlist();

  const tvShowIds = results.shows.map((s) => s.id);
  const { data: bingePlans } = useShowProgressBulk(tvShowIds);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabType) ?? "all";
  function setActiveTab(tab: TabType) {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortType>("my_order");
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  async function onRemove(type: "tv" | "movie", content_id: number) {
    try {
      await removeFromList.mutateAsync({
        list: "watchlist",
        contentType: type,
        contentId: content_id,
      });
    } catch (err) {
      console.error(err);
    }
  }

  const fireReorder = useCallback(
    (
      contentType: "movie" | "tv",
      contentId: number,
      beforeId: number | null,
      afterId: number | null,
    ) => {
      const savedScroll = window.scrollY;
      reorderWatchlist.mutate({ contentType, contentId, beforeId, afterId });
      requestAnimationFrame(() =>
        window.scrollTo({
          top: savedScroll,
          behavior: "instant" as ScrollBehavior,
        }),
      );
    },
    [reorderWatchlist],
  );

  function handleDragEnd(event: DragEndEvent, items: CombinedItem[]) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeIdx = items.findIndex(
      (i) => `${i._contentType}-${i.id}` === active.id,
    );
    const overIdx = items.findIndex(
      (i) => `${i._contentType}-${i.id}` === over.id,
    );
    if (activeIdx === -1 || overIdx === -1) return;
    const newItems = arrayMove(items, activeIdx, overIdx);
    const moved = newItems[overIdx];
    const beforeItem = newItems[overIdx - 1] ?? null;
    const afterItem = newItems[overIdx + 1] ?? null;
    fireReorder(
      moved._contentType,
      moved.id,
      beforeItem?.watchlist_id ?? null,
      afterItem?.watchlist_id ?? null,
    );
  }

  const totalCount = results.movies.length + results.shows.length;
  const isMyOrder = sort === "my_order";
  const q = query.toLowerCase();

  const filteredMovies = applySort(
    applyFilters(
      results.movies.filter((m) => m.title.toLowerCase().includes(q)),
      filters,
      myProviderIds,
    ),
    sort,
    bingePlans,
  );
  const filteredShows = applySort(
    applyFilters(
      results.shows.filter((s) => s.name.toLowerCase().includes(q)),
      filters,
      myProviderIds,
    ),
    sort,
    bingePlans,
  );

  const upNextShows = useMemo(
    () =>
      applySort(
        applyFilters(
          results.shows.filter((s) => {
            const p = bingePlans?.[String(s.id)];
            return (
              p &&
              p.watched_episodes > 0 &&
              p.remaining_episodes > 0 &&
              s.name.toLowerCase().includes(q)
            );
          }),
          filters,
          myProviderIds,
        ),
        sort,
        bingePlans,
      ),
    [results.shows, bingePlans, q, filters, myProviderIds, sort],
  );

  const combinedItems = useMemo(
    () =>
      isMyOrder
        ? buildCombined(
            applyFilters(results.movies, filters, myProviderIds),
            applyFilters(results.shows, filters, myProviderIds),
            query,
          )
        : [],
    [isMyOrder, results.movies, results.shows, query, filters, myProviderIds],
  );
  const combinedByType = useMemo(
    () => ({
      movies: combinedItems.filter((i) => i._contentType === "movie"),
      shows: combinedItems.filter((i) => i._contentType === "tv"),
    }),
    [combinedItems],
  );

  // Grid items for non-my-order views
  const gridItems: CombinedItem[] = useMemo(() => {
    if (isMyOrder) return [];
    switch (activeTab) {
      case "up_next":
        return upNextShows.map((s) => ({
          ...s,
          _contentType: "tv" as const,
          sort_key: (s as any).sort_key ?? 0,
          watchlist_id: (s as any).watchlist_id!,
        }));
      case "movies":
        return filteredMovies.map((m) => ({
          ...m,
          _contentType: "movie" as const,
          sort_key: m.sort_key ?? 0,
          watchlist_id: m.watchlist_id!,
        }));
      case "shows":
        return filteredShows.map((s) => ({
          ...s,
          _contentType: "tv" as const,
          sort_key: (s as any).sort_key ?? 0,
          watchlist_id: (s as any).watchlist_id!,
        }));
      case "all":
      default:
        return [
          ...filteredMovies.map((m) => ({
            ...m,
            _contentType: "movie" as const,
            sort_key: m.sort_key ?? 0,
            watchlist_id: m.watchlist_id!,
          })),
          ...filteredShows.map((s) => ({
            ...s,
            _contentType: "tv" as const,
            sort_key: (s as any).sort_key ?? 0,
            watchlist_id: (s as any).watchlist_id!,
          })),
        ];
    }
  }, [isMyOrder, activeTab, filteredMovies, filteredShows, upNextShows]);

  // My order filtered items for movies/shows tabs
  const myOrderFilteredItems =
    activeTab === "movies"
      ? combinedByType.movies
      : activeTab === "shows"
        ? combinedByType.shows
        : [];

  const upNextCount = useMemo(
    () =>
      results.shows.filter((s) => {
        const p = bingePlans?.[String(s.id)];
        return p && p.watched_episodes > 0 && p.remaining_episodes > 0;
      }).length,
    [results.shows, bingePlans],
  );

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: "up_next", label: "Up next", count: upNextCount },
    { id: "all", label: "All", count: totalCount },
    { id: "shows", label: "Shows", count: results.shows.length },
    { id: "movies", label: "Movies", count: results.movies.length },
  ];

  const hasResults = isMyOrder
    ? activeTab === "all"
      ? combinedItems.length > 0
      : myOrderFilteredItems.length > 0
    : gridItems.length > 0;

  return (
    <div className="w-full px-6 sm:px-10 pt-8 pb-16">
      {/* Header */}
      <div data-tour="watchlist-header">
        <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-neutral-500">
          {totalCount} title{totalCount !== 1 ? "s" : ""} tracking
        </p>
        <div className="flex items-baseline gap-4 mt-2 flex-wrap">
          <h1
            className="text-4xl font-normal leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Your{" "}
            <em className="text-primary-400" style={{ fontStyle: "italic" }}>
              watchlist
            </em>
          </h1>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
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
              className="text-sm bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-neutral-500"
            >
              <option value="my_order">My Order</option>
              <option value="added_desc">Recently Added</option>
              <option value="added_asc">Oldest Added</option>
              <option value="title_asc">Title: A → Z</option>
              <option value="title_desc">Title: Z → A</option>
              <option value="date_desc">Release Date: Newest</option>
              <option value="date_asc">Release Date: Oldest</option>
              <option value="popularity_desc">Most Popular</option>
              <option value="tmdb_rating_desc">Rating: High → Low</option>
              <option value="tmdb_rating_asc">Rating: Low → High</option>
              <option value="time_remaining_asc">
                Time Remaining: Shortest
              </option>
              <option value="time_remaining_desc">
                Time Remaining: Longest
              </option>
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
      {!loading && totalCount > 0 && (
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
            />
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-8">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 animate-pulse">
              <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
              <div className="h-3 bg-neutral-800 rounded w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Empty watchlist */}
      {!loading && totalCount === 0 && (
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
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
          </div>
          <h3 className="text-neutral-300 font-medium mb-1">
            Your watchlist is empty
          </h3>
          <p className="text-neutral-500 text-sm mb-4">
            Browse Trending or Upcoming to find something to add
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
      {!loading && totalCount > 0 && !hasResults && (
        <div className="flex flex-col items-center justify-center py-24 text-center mt-8">
          <p className="text-neutral-400 font-medium mb-1">
            {activeFilterCount > 0
              ? "No results match your filters"
              : activeTab === "up_next"
                ? "Nothing in progress yet"
                : `No results for "${query}"`}
          </p>
          {activeFilterCount > 0 ? (
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="text-primary-400 hover:text-primary-300 text-sm mt-1 transition-colors"
            >
              Clear filters
            </button>
          ) : activeTab === "up_next" ? (
            <p className="text-neutral-500 text-sm mt-1">
              Start watching a show to see your progress here
            </p>
          ) : (
            <p className="text-neutral-500 text-sm">
              Try a different search term
            </p>
          )}
        </div>
      )}

      {/* ── My Order: All tab — DnD list ── */}
      {!loading &&
        isMyOrder &&
        activeTab === "all" &&
        combinedItems.length > 0 && (
          <div className="mt-6">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleDragEnd(e, combinedItems)}
            >
              <SortableContext
                items={combinedItems.map((i) => `${i._contentType}-${i.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {combinedItems.map((item, idx) => (
                    <WatchlistOrderRow
                      key={`${item._contentType}-${item.id}`}
                      dndId={`${item._contentType}-${item.id}`}
                      rank={idx + 1}
                      title={getTitle(item)}
                      posterPath={item.poster_path}
                      year={getYear(item)}
                      contentType={item._contentType}
                      voteAverage={item.vote_average}
                      userRating={item.user_rating}
                      genres={item.genres}
                      certification={item.certification}
                      bingePlan={
                        item._contentType === "tv"
                          ? (bingePlans?.[String(item.id)] ?? null)
                          : null
                      }
                      isFirst={idx === 0}
                      isLast={idx === combinedItems.length - 1}
                      onMoveUp={() => {
                        const before = combinedItems[idx - 2] ?? null;
                        const after = combinedItems[idx - 1];
                        fireReorder(
                          item._contentType,
                          item.id,
                          before?.watchlist_id ?? null,
                          after.watchlist_id,
                        );
                      }}
                      onMoveDown={() => {
                        const before = combinedItems[idx + 1];
                        const after = combinedItems[idx + 2] ?? null;
                        fireReorder(
                          item._contentType,
                          item.id,
                          before.watchlist_id,
                          after?.watchlist_id ?? null,
                        );
                      }}
                      onMoveToTop={() => {
                        if (idx === 0) return;
                        fireReorder(
                          item._contentType,
                          item.id,
                          null,
                          combinedItems[0].watchlist_id,
                        );
                      }}
                      onDelete={() =>
                        removeFromList.mutate({
                          list: "watchlist",
                          contentType: item._contentType,
                          contentId: item.id,
                        })
                      }
                      onClick={() =>
                        navigate(
                          `/${item._contentType === "movie" ? "movie" : "tv"}/${item.id}`,
                        )
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

      {/* ── My Order: Movies or Shows tab — arrows only ── */}
      {!loading &&
        isMyOrder &&
        activeTab !== "all" &&
        activeTab !== "up_next" &&
        myOrderFilteredItems.length > 0 && (
          <div className="flex flex-col gap-2 mt-6">
            {myOrderFilteredItems.map((item) => {
              const allIdx = combinedItems.findIndex(
                (c) => c._contentType === item._contentType && c.id === item.id,
              );
              return (
                <WatchlistOrderRow
                  key={`${item._contentType}-${item.id}`}
                  dndId={`${item._contentType}-${item.id}`}
                  rank={allIdx + 1}
                  title={getTitle(item)}
                  posterPath={item.poster_path}
                  year={getYear(item)}
                  contentType={item._contentType}
                  voteAverage={item.vote_average}
                  userRating={item.user_rating}
                  genres={item.genres}
                  certification={item.certification}
                  bingePlan={
                    item._contentType === "tv"
                      ? (bingePlans?.[String(item.id)] ?? null)
                      : null
                  }
                  isFirst={allIdx === 0}
                  isLast={allIdx === combinedItems.length - 1}
                  isDragDisabled
                  onMoveUp={() => {
                    const before = combinedItems[allIdx - 2] ?? null;
                    const after = combinedItems[allIdx - 1];
                    if (after)
                      fireReorder(
                        item._contentType,
                        item.id,
                        before?.watchlist_id ?? null,
                        after.watchlist_id,
                      );
                  }}
                  onMoveDown={() => {
                    const before = combinedItems[allIdx + 1];
                    const after = combinedItems[allIdx + 2] ?? null;
                    if (before)
                      fireReorder(
                        item._contentType,
                        item.id,
                        before.watchlist_id,
                        after?.watchlist_id ?? null,
                      );
                  }}
                  onMoveToTop={() => {
                    if (allIdx === 0) return;
                    fireReorder(
                      item._contentType,
                      item.id,
                      null,
                      combinedItems[0]?.watchlist_id ?? null,
                    );
                  }}
                  onDelete={() =>
                    removeFromList.mutate({
                      list: "watchlist",
                      contentType: item._contentType,
                      contentId: item.id,
                    })
                  }
                  onClick={() =>
                    navigate(
                      `/${item._contentType === "movie" ? "movie" : "tv"}/${item.id}`,
                    )
                  }
                />
              );
            })}
          </div>
        )}

      {/* ── Poster grid (all non-my-order sorts, and up_next in my-order) ── */}
      {!loading &&
        (!isMyOrder || activeTab === "up_next") &&
        gridItems.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6 mt-8">
            {gridItems.map((item) => (
              <WatchlistCard
                key={`${item._contentType}-${item.id}`}
                item={item}
                bingePlans={bingePlans}
                onNavigate={() =>
                  navigate(
                    `/${item._contentType === "movie" ? "movie" : "tv"}/${item.id}`,
                  )
                }
                onRemove={() =>
                  removeFromList.mutate({
                    list: "watchlist",
                    contentType: item._contentType,
                    contentId: item.id,
                  })
                }
              />
            ))}
          </div>
        )}
    </div>
  );
}
