import { useState, useCallback, useMemo } from "react";
import type { Show, Movie } from "../types/calendar";
import { useNavigate } from "react-router-dom";
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
import MediaCard from "../components/MediaCard";
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
import { useShowProgressBulk, ShowProgress } from "../hooks/api/useBingePlan";
import { useMyProviderIds } from "../hooks/api/useStreamingServices";

type TabType = "all" | "movies" | "tv";
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

function getTimeRemaining(item: Movie | Show, bingePlans?: Record<string, ShowProgress>): number {
  if ("name" in item) {
    // TV show — use remaining minutes from progress data, fall back to Infinity so unknowns sort last
    return bingePlans?.[String(item.id)]?.remaining_minutes ?? Infinity;
  }
  // Movie — runtime is the time remaining since it's unwatched
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
        (a, b) => getTimeRemaining(a, bingePlans) - getTimeRemaining(b, bingePlans),
      );
    case "time_remaining_desc":
      return sorted.sort(
        (a, b) => getTimeRemaining(b, bingePlans) - getTimeRemaining(a, bingePlans),
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
  const [activeTab, setActiveTab] = useState<TabType>("all");
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

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalCount },
    { id: "movies", label: "Movies", count: results.movies.length },
    { id: "tv", label: "TV Shows", count: results.shows.length },
  ];

  // Items to render in My Order filtered views (no drag, arrows only)
  const myOrderFilteredItems =
    activeTab === "movies"
      ? combinedByType.movies
      : activeTab === "tv"
        ? combinedByType.shows
        : [];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-16">
      <div className="mb-8" data-tour="watchlist-header">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-white">My Watchlist</h1>
          <span className="bg-primary-600/20 text-primary-400 border border-primary-600/30 text-sm font-medium px-2.5 py-0.5 rounded-full">
            {totalCount}
          </span>
        </div>
        <p className="text-neutral-400">Shows and movies you want to watch</p>
      </div>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl overflow-hidden bg-neutral-800 border border-neutral-700 flex flex-col animate-pulse"
            >
              <div className="aspect-[2/3] bg-neutral-700" />
              <div className="p-3 flex flex-col gap-2">
                <div className="h-4 bg-neutral-700 rounded w-3/4" />
                <div className="h-3 bg-neutral-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="flex gap-1 border-b border-neutral-700 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.id
                      ? "bg-primary-600/30 text-primary-300"
                      : "bg-neutral-700 text-neutral-400"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {!loading && totalCount > 0 && (
        <div className="mb-6 space-y-3">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
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
                placeholder="Search your watchlist…"
                className="w-full bg-neutral-800 border border-neutral-700 text-neutral-200 placeholder-neutral-500 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-neutral-500"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 shrink-0 text-sm px-3 py-2 rounded-lg border transition-colors ${
                showFilters || activeFilterCount > 0
                  ? "bg-primary-600/20 border-primary-600/40 text-primary-300"
                  : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="bg-primary-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="w-28 sm:w-auto shrink-0 text-sm bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-500"
            >
              <option value="my_order">My Order</option>
              <option value="added_desc">Recently Added</option>
              <option value="added_asc">Oldest Added</option>
              <option value="title_asc">Title: A → Z</option>
              <option value="title_desc">Title: Z → A</option>
              <option value="date_desc">Release Date: Newest</option>
              <option value="date_asc">Release Date: Oldest</option>
              <option value="popularity_desc">Most Popular</option>
              <option value="tmdb_rating_desc">TMDB Rating: High → Low</option>
              <option value="tmdb_rating_asc">TMDB Rating: Low → High</option>
              <option value="time_remaining_asc">Time Remaining: Shortest First</option>
              <option value="time_remaining_desc">Time Remaining: Longest First</option>
            </select>
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

      {!loading && totalCount === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
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

      {!loading &&
        totalCount > 0 &&
        filteredMovies.length === 0 &&
        filteredShows.length === 0 &&
        !isMyOrder && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-neutral-400 font-medium mb-1">
              {activeFilterCount > 0 ? "No results match your filters" : `No results for "${query}"`}
            </p>
            {activeFilterCount > 0 ? (
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-primary-400 hover:text-primary-300 text-sm mt-1 transition-colors"
              >
                Clear filters
              </button>
            ) : (
              <p className="text-neutral-500 text-sm">Try a different search term</p>
            )}
          </div>
        )}

      {!loading &&
        totalCount > 0 &&
        isMyOrder &&
        combinedItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-neutral-400 font-medium mb-1">
              {activeFilterCount > 0 ? "No results match your filters" : `No results for "${query}"`}
            </p>
            {activeFilterCount > 0 ? (
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-primary-400 hover:text-primary-300 text-sm mt-1 transition-colors"
              >
                Clear filters
              </button>
            ) : (
              <p className="text-neutral-500 text-sm">Try a different search term</p>
            )}
          </div>
        )}

      {/* ── My Order: All tab — combined sortable list ── */}
      {!loading &&
        isMyOrder &&
        activeTab === "all" &&
        combinedItems.length > 0 && (
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
                    bingePlan={item._contentType === "tv" ? (bingePlans?.[String(item.id)] ?? null) : null}
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
                      const after = combinedItems[0];
                      fireReorder(
                        item._contentType,
                        item.id,
                        null,
                        after.watchlist_id,
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
        )}

      {/* ── My Order: Movies or TV tab — filtered list, arrows only (no drag) ── */}
      {!loading &&
        isMyOrder &&
        activeTab !== "all" &&
        myOrderFilteredItems.length > 0 && (
          <div className="flex flex-col gap-2">
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
                  bingePlan={item._contentType === "tv" ? (bingePlans?.[String(item.id)] ?? null) : null}
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
                    const after = combinedItems[0];
                    fireReorder(
                      item._contentType,
                      item.id,
                      null,
                      after?.watchlist_id ?? null,
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

      {/* ── Non-My-Order grid views ── */}
      {!loading &&
        !isMyOrder &&
        (activeTab === "all" || activeTab === "movies") &&
        filteredMovies.length > 0 && (
          <div className="mb-10">
            {activeTab === "all" && (
              <h2 className="text-lg font-semibold text-neutral-200 mb-4 flex items-center gap-2">
                Movies
                <span className="text-xs text-neutral-500 font-normal bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">
                  {filteredMovies.length}
                </span>
              </h2>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredMovies.map((item) => (
                <MediaCard
                  key={`movie-${item.id}`}
                  type="movie"
                  item={item}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </div>
        )}

      {!loading &&
        !isMyOrder &&
        (activeTab === "all" || activeTab === "tv") &&
        filteredShows.length > 0 && (
          <div>
            {activeTab === "all" && (
              <h2 className="text-lg font-semibold text-neutral-200 mb-4 flex items-center gap-2">
                TV Shows
                <span className="text-xs text-neutral-500 font-normal bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">
                  {filteredShows.length}
                </span>
              </h2>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredShows.map((item) => (
                <MediaCard
                  key={`tv-${item.id}`}
                  type="tv"
                  item={item}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
