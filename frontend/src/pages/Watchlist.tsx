import { memo, useState, useCallback, useMemo, type ReactNode } from "react";
import type { Show, Movie } from "../types/calendar";
import { useSearchParams } from "react-router-dom";
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
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDoubleLeftIcon } from "@heroicons/react/24/outline";
import ListFilterPanel, {
  DEFAULT_FILTERS,
  type ListFilters,
  countActiveFilters,
  applyFilters,
} from "../components/ListFilterPanel";
import {
  Button,
  ButtonLink,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EmptyState,
  FilterIcon,
  IconButton,
  PageHeader,
  PosterCard,
  PosterCardSkeleton,
  SearchField,
  SectionHeader,
  StarIcon,
  cx,
  focusRing,
  selectClass,
} from "../components/ui";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useWatchlist,
  useCurrentlyWatching,
  useRemoveFromList,
  useReorderWatchlist,
} from "../hooks/api/useLists";
import {
  useShowProgressBulk,
  type ShowProgress,
} from "../hooks/api/useBingePlan";
import { useMyProviderIds } from "../hooks/api/useStreamingServices";

type TabType = "up_next" | "currently_watching" | "movies" | "shows" | "all";
type ListType = "watchlist" | "currently_watching";
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
  _listType: ListType;
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

function getTimeRemaining(
  item: Movie | Show,
  bingePlans?: Record<string, ShowProgress>,
): number {
  if ("name" in item) {
    return bingePlans?.[String(item.id)]?.remaining_minutes ?? Infinity;
  }
  return (item as Movie).runtime ?? 0;
}

function applySort<T extends Movie | Show>(
  items: T[],
  sort: SortType,
  bingePlans?: Record<string, ShowProgress>,
): T[] {
  const sorted = [...items];
  switch (sort) {
    case "added_desc":
      return sorted.sort((a, b) =>
        ((b.added_at ?? "")).localeCompare((a.added_at ?? "")),
      );
    case "added_asc":
      return sorted.sort((a, b) =>
        ((a.added_at ?? "")).localeCompare((b.added_at ?? "")),
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
  cwMovieIds: Set<number>,
  cwShowIds: Set<number>,
): CombinedItem[] {
  const q = query.toLowerCase();
  const filteredMovies = movies
    .filter((m) => m.title.toLowerCase().includes(q) && m.watchlist_id != null)
    .map((m) => ({
      ...m,
      _contentType: "movie" as const,
      _listType: (cwMovieIds.has(m.id) ? "currently_watching" : "watchlist") as ListType,
      sort_key: m.sort_key ?? 0,
      watchlist_id: m.watchlist_id!,
    }));
  const filteredShows = shows
    .filter((s) => s.name.toLowerCase().includes(q) && s.watchlist_id != null)
    .map((s) => ({
      ...s,
      _contentType: "tv" as const,
      _listType: (cwShowIds.has(s.id) ? "currently_watching" : "watchlist") as ListType,
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

function CardFooter({
  item,
  bingePlans,
  rank,
  children,
}: {
  item: CombinedItem;
  bingePlans?: Record<string, ShowProgress>;
  rank?: number;
  children?: ReactNode;
}) {
  const progress = getProgress(item, bingePlans);
  const statusText = getStatusText(item, bingePlans);
  const isCaughtUp =
    item._contentType === "tv" &&
    bingePlans?.[String(item.id)]?.remaining_episodes === 0;
  const isWatching = item._listType === "currently_watching" && !isCaughtUp;

  return (
    <div className="flex flex-col gap-1.5">
      {progress > 0 && !isCaughtUp && (
        <div className="h-1 rounded-full bg-neutral-800 overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-primary-500 rounded-full"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
      )}
      {(rank != null || isWatching || statusText) && (
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-neutral-400">
          {rank != null && <span className="tabular">#{rank}</span>}
          {isWatching && <span className="text-primary-300">Watching</span>}
          {statusText && (
            <span className="inline-flex items-center gap-1">
              {isCaughtUp && <CheckIcon className="w-3 h-3" />}
              {statusText}
            </span>
          )}
        </p>
      )}
      {children}
    </div>
  );
}

function getSubtitle(item: CombinedItem): ReactNode {
  if (item.vote_average == null || item.vote_average <= 0) return undefined;
  return (
    <span className="inline-flex items-center gap-1">
      <StarIcon className="w-3 h-3 text-warning-400 flex-none" />
      <span className="tabular">{item.vote_average.toFixed(1)}</span>
    </span>
  );
}

const WatchlistCard = memo(function WatchlistCard({
  item,
  bingePlans,
  onRemove,
}: {
  item: CombinedItem;
  bingePlans?: Record<string, ShowProgress>;
  onRemove: (type: "movie" | "tv", id: number, listType: ListType) => void;
}) {
  const title = getTitle(item);

  return (
    <PosterCard
      to={`/${item._contentType}/${item.id}`}
      title={title}
      posterPath={item.poster_path}
      subtitle={getSubtitle(item)}
      className="group/card"
      corner={
        <IconButton
          label={`Remove ${title} from watchlist`}
          icon={<CloseIcon className="w-3.5 h-3.5" />}
          variant="overlay"
          size="sm"
          onClick={() => onRemove(item._contentType, item.id, item._listType)}
          className="opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        />
      }
      footer={<CardFooter item={item} bingePlans={bingePlans} />}
    />
  );
});

const SortableWatchlistCard = memo(function SortableWatchlistCard({
  item,
  bingePlans,
  rank,
  dndId,
  isFirst,
  isLast,
  isDragDisabled = false,
  onRemove,
  onMoveUp,
  onMoveDown,
  onMoveToTop,
}: {
  item: CombinedItem;
  bingePlans?: Record<string, ShowProgress>;
  rank: number;
  dndId: string;
  isFirst: boolean;
  isLast: boolean;
  isDragDisabled?: boolean;
  onRemove: (type: "movie" | "tv", id: number, listType: ListType) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToTop: () => void;
}) {
  const {
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dndId, disabled: isDragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragDisabled ? undefined : isDragging ? "grabbing" : "grab",
  };

  const isCaughtUp =
    item._contentType === "tv" &&
    bingePlans?.[String(item.id)]?.remaining_episodes === 0;
  const title = getTitle(item);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(!isDragDisabled ? listeners : {})}
    >
      <PosterCard
        to={`/${item._contentType}/${item.id}`}
        title={title}
        posterPath={item.poster_path}
        subtitle={getSubtitle(item)}
        className="group/card"
        corner={
          <span onPointerDown={stop}>
            <IconButton
              label={`Remove ${title} from watchlist`}
              icon={<CloseIcon className="w-3.5 h-3.5" />}
              variant="overlay"
              size="sm"
              onClick={() => onRemove(item._contentType, item.id, item._listType)}
              className="opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            />
          </span>
        }
        footer={
          <CardFooter
            item={item}
            bingePlans={bingePlans}
            rank={!isCaughtUp && item._listType === "watchlist" ? rank : undefined}
          >
            {/* Reorder controls: only for watchlist items */}
            {item._listType === "watchlist" && (
              <div
                className="flex flex-wrap items-center gap-1 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity"
                onPointerDown={stop}
              >
                <IconButton
                  label={`Move ${title} to first`}
                  icon={<ChevronDoubleLeftIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
                  variant="secondary"
                  size="sm"
                  shape="square"
                  onClick={onMoveToTop}
                  disabled={isFirst}
                />
                <IconButton
                  label={`Move ${title} left`}
                  icon={<ChevronLeftIcon />}
                  variant="secondary"
                  size="sm"
                  shape="square"
                  onClick={onMoveUp}
                  disabled={isFirst}
                />
                <IconButton
                  label={`Move ${title} right`}
                  icon={<ChevronRightIcon />}
                  variant="secondary"
                  size="sm"
                  shape="square"
                  onClick={onMoveDown}
                  disabled={isLast}
                />
              </div>
            )}
          </CardFooter>
        }
      />
    </div>
  );
});

export default function Watchlist() {
  usePageTitle("Watchlist");
  const { data, isPending: loading } = useWatchlist();
  const { data: cwData } = useCurrentlyWatching();
  const myProviderIds = useMyProviderIds();
  const results = data ?? { movies: [], shows: [] };
  const cwResults = cwData ?? { movies: [], shows: [] };
  const cwMovieIds = useMemo(
    () => new Set(cwResults.movies.map((m) => m.id)),
    [cwResults.movies],
  );
  const cwShowIds = useMemo(
    () => new Set(cwResults.shows.map((s) => s.id)),
    [cwResults.shows],
  );
  // Currently-watching items that aren't also on the watchlist (avoid duplicates
  // for shows that auto-promote from watchlist → currently_watching).
  const cwOnlyMovies = useMemo(
    () =>
      cwResults.movies.filter(
        (m) => !results.movies.some((wm) => wm.id === m.id),
      ),
    [cwResults.movies, results.movies],
  );
  const cwOnlyShows = useMemo(
    () =>
      cwResults.shows.filter((s) => !results.shows.some((ws) => ws.id === s.id)),
    [cwResults.shows, results.shows],
  );
  const removeFromList = useRemoveFromList();
  const reorderWatchlist = useReorderWatchlist();

  const tvShowIds = useMemo(
    () => [...new Set([...results.shows.map((s) => s.id), ...cwResults.shows.map((s) => s.id)])],
    [results.shows, cwResults.shows],
  );
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

  const onRemove = useCallback(
    async (type: "tv" | "movie", content_id: number, listType: ListType = "watchlist") => {
      try {
        await removeFromList.mutateAsync({
          list: listType === "currently_watching" ? "currently-watching" : "watchlist",
          contentType: type,
          contentId: content_id,
        });
      } catch (err) {
        console.error(err);
      }
    },
    [removeFromList],
  );

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

  const filteredMovies = useMemo(
    () =>
      applySort(
        applyFilters(
          results.movies.filter((m) => m.title.toLowerCase().includes(q)),
          filters,
          myProviderIds,
        ),
        sort,
        bingePlans,
      ),
    [results.movies, q, filters, myProviderIds, sort, bingePlans],
  );

  const filteredShows = useMemo(
    () =>
      applySort(
        applyFilters(
          results.shows.filter((s) => s.name.toLowerCase().includes(q)),
          filters,
          myProviderIds,
        ),
        sort,
        bingePlans,
      ),
    [results.shows, q, filters, myProviderIds, sort, bingePlans],
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
            cwMovieIds,
            cwShowIds,
          )
        : [],
    [isMyOrder, results.movies, results.shows, query, filters, myProviderIds, cwMovieIds, cwShowIds],
  );
  const combinedByType = useMemo(
    () => ({
      movies: combinedItems.filter((i) => i._contentType === "movie"),
      shows: combinedItems.filter((i) => i._contentType === "tv"),
    }),
    [combinedItems],
  );

  // Currently-watching items shaped as CombinedItem (no watchlist_id / sort_key)
  const cwFilteredMovies = useMemo(
    () =>
      applySort(
        applyFilters(
          cwOnlyMovies.filter((m) => m.title.toLowerCase().includes(q)),
          filters,
          myProviderIds,
        ),
        sort,
        bingePlans,
      ),
    [cwOnlyMovies, q, filters, myProviderIds, sort, bingePlans],
  );
  const cwFilteredShows = useMemo(
    () =>
      applySort(
        applyFilters(
          cwOnlyShows.filter((s) => s.name.toLowerCase().includes(q)),
          filters,
          myProviderIds,
        ),
        sort,
        bingePlans,
      ),
    [cwOnlyShows, q, filters, myProviderIds, sort, bingePlans],
  );

  function tagCW(items: (Movie | Show)[], type: "movie" | "tv"): CombinedItem[] {
    return items.map((it) => ({
      ...(it as Movie | Show),
      _contentType: type,
      _listType: "currently_watching" as ListType,
      sort_key: Number.MAX_SAFE_INTEGER, // sorts after watchlist in my_order
      watchlist_id: 0,
    }));
  }

  function tagWL(items: (Movie | Show)[], type: "movie" | "tv"): CombinedItem[] {
    return items.map((it) => {
      const onCW =
        type === "movie" ? cwMovieIds.has(it.id) : cwShowIds.has(it.id);
      return {
        ...(it as Movie | Show),
        _contentType: type,
        _listType: (onCW ? "currently_watching" : "watchlist") as ListType,
        sort_key: it.sort_key ?? 0,
        watchlist_id: it.watchlist_id!,
      };
    });
  }

  // Grid items for non-my-order views, and for up_next regardless of sort
  const gridItems: CombinedItem[] = (() => {
    if (isMyOrder && activeTab !== "up_next" && activeTab !== "currently_watching") return [];
    switch (activeTab) {
      case "up_next":
        return tagWL(upNextShows, "tv");
      case "currently_watching":
        return [...tagWL(filteredMovies.filter((m) => cwMovieIds.has(m.id)), "movie"),
                ...tagWL(filteredShows.filter((s) => cwShowIds.has(s.id)), "tv"),
                ...tagCW(cwFilteredMovies, "movie"),
                ...tagCW(cwFilteredShows, "tv")];
      case "movies":
        return [...tagWL(filteredMovies, "movie"), ...tagCW(cwFilteredMovies, "movie")];
      case "shows":
        return [...tagWL(filteredShows, "tv"), ...tagCW(cwFilteredShows, "tv")];
      case "all":
      default:
        return [
          ...tagWL(filteredMovies, "movie"),
          ...tagWL(filteredShows, "tv"),
          ...tagCW(cwFilteredMovies, "movie"),
          ...tagCW(cwFilteredShows, "tv"),
        ];
    }
  })();

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

  const cwCount = cwResults.movies.length + cwResults.shows.length;
  const totalIncludingCW = totalCount + cwOnlyMovies.length + cwOnlyShows.length;

  // shortLabel is what shows on narrow viewports — the only overlong one is
  // "Currently watching", so we abbreviate to "Watching" on mobile and let CSS
  // swap between them via responsive utility classes.
  const tabs: {
    id: TabType;
    label: string;
    shortLabel?: string;
    count: number;
  }[] = [
    { id: "up_next", label: "Up next", count: upNextCount },
    {
      id: "currently_watching",
      label: "Currently watching",
      shortLabel: "Watching",
      count: cwCount,
    },
    { id: "all", label: "All", count: totalIncludingCW },
    { id: "shows", label: "Shows", count: results.shows.length + cwOnlyShows.length },
    { id: "movies", label: "Movies", count: results.movies.length + cwOnlyMovies.length },
  ];

  const hasResults = isMyOrder
    ? activeTab === "all"
      ? combinedItems.length > 0 || cwFilteredMovies.length > 0 || cwFilteredShows.length > 0
      : activeTab === "up_next" || activeTab === "currently_watching"
        ? gridItems.length > 0
        : myOrderFilteredItems.length > 0 ||
          (activeTab === "movies" ? cwFilteredMovies.length : cwFilteredShows.length) > 0
    : gridItems.length > 0;

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <div data-tour="watchlist-header" className="flex flex-col gap-6">
        <PageHeader
          title="Watchlist"
          description={
            loading
              ? undefined
              : `${totalIncludingCW} ${totalIncludingCW === 1 ? "title" : "titles"} you're tracking`
          }
          actions={
            <>
              <Button
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                icon={<FilterIcon />}
                className={showFilters || activeFilterCount > 0 ? "border-primary-500/60 text-primary-200" : undefined}
              >
                Filters
                {activeFilterCount > 0 && (
                  <span className="min-w-5 h-5 px-1 rounded-full bg-primary-500 text-neutral-950 text-caption font-semibold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              <label htmlFor="watchlist-sort" className="sr-only">
                Sort
              </label>
              <select
                id="watchlist-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortType)}
                className={cx(selectClass, "max-w-[160px] sm:max-w-none")}
              >
                <option value="my_order">My order</option>
                <option value="added_desc">Recently added</option>
                <option value="added_asc">Oldest added</option>
                <option value="title_asc">Title: A to Z</option>
                <option value="title_desc">Title: Z to A</option>
                <option value="date_desc">Release date: newest</option>
                <option value="date_asc">Release date: oldest</option>
                <option value="popularity_desc">Most popular</option>
                <option value="tmdb_rating_desc">Rating: high to low</option>
                <option value="tmdb_rating_asc">Rating: low to high</option>
                <option value="time_remaining_asc">
                  Time remaining: shortest
                </option>
                <option value="time_remaining_desc">
                  Time remaining: longest
                </option>
              </select>
            </>
          }
        />

        {/* Tabs — shrink to fit on mobile, then wrap to a second row if the
            viewport is still too narrow (e.g. tiny phones or large count
            badges). Reverts to the roomier desktop sizing at sm+. Five
            options with counts is too wide for a Segmented on a phone. */}
        <div className="flex flex-wrap gap-x-0 gap-y-1 border-b border-neutral-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              className={cx(
                "px-2 sm:px-3.5 py-3 text-label font-medium inline-flex items-center gap-1 sm:gap-1.5 border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer",
                focusRing,
                activeTab === tab.id
                  ? "border-primary-500 text-neutral-100"
                  : "border-transparent text-neutral-400 hover:text-neutral-200",
              )}
            >
              {/* Long label visible from sm+; short label visible below sm. */}
              {tab.shortLabel ? (
                <>
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.shortLabel}</span>
                </>
              ) : (
                tab.label
              )}
              <span className="tabular text-caption text-neutral-500">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Search + filter panel */}
      {!loading && totalIncludingCW > 0 && (
        <div className="space-y-3">
          <SearchField value={query} onChange={setQuery} label="Search watchlist" />
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
        <div
          className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-posters gap-3"
          aria-hidden="true"
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <PosterCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty watchlist */}
      {!loading && totalIncludingCW === 0 && (
        <EmptyState
          title="Your watchlist is empty"
          description="Browse Trending or Upcoming to find something to add."
          action={
            <ButtonLink to="/trending" variant="primary">
              Browse trending
            </ButtonLink>
          }
        />
      )}

      {/* No results */}
      {!loading && totalIncludingCW > 0 && !hasResults && (
        <EmptyState
          title={
            activeFilterCount > 0
              ? "No results match your filters"
              : activeTab === "up_next"
                ? "Nothing in progress yet"
                : activeTab === "currently_watching"
                  ? "Nothing in your Currently Watching list"
                  : `No results for "${query}"`
          }
          description={
            activeFilterCount > 0
              ? undefined
              : activeTab === "up_next"
                ? "Start watching a show to see your progress here."
                : activeTab === "currently_watching"
                  ? 'Mark a title as "Currently Watching" from its page to see it here.'
                  : "Try a different search term."
          }
          action={
            activeFilterCount > 0 ? (
              <Button onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</Button>
            ) : undefined
          }
        />
      )}

      {/* ── My Order: All tab — DnD grid ── */}
      {!loading &&
        isMyOrder &&
        activeTab === "all" &&
        combinedItems.length > 0 && (
          <div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleDragEnd(e, combinedItems)}
            >
              <SortableContext
                items={combinedItems.map((i) => `${i._contentType}-${i.id}`)}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-posters gap-x-3 gap-y-5">
                  {combinedItems.map((item, idx) => (
                    <SortableWatchlistCard
                      key={`${item._contentType}-${item.id}`}
                      dndId={`${item._contentType}-${item.id}`}
                      item={item}
                      bingePlans={bingePlans}
                      rank={idx + 1}
                      isFirst={idx === 0}
                      isLast={idx === combinedItems.length - 1}
                      onRemove={onRemove}
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
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

      {/* ── My Order: Movies or Shows tab — grid with arrows ── */}
      {!loading &&
        isMyOrder &&
        activeTab !== "all" &&
        activeTab !== "up_next" &&
        activeTab !== "currently_watching" &&
        myOrderFilteredItems.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-posters gap-x-3 gap-y-5">
            {myOrderFilteredItems.map((item) => {
              const allIdx = combinedItems.findIndex(
                (c) => c._contentType === item._contentType && c.id === item.id,
              );
              return (
                <SortableWatchlistCard
                  key={`${item._contentType}-${item.id}`}
                  dndId={`${item._contentType}-${item.id}`}
                  item={item}
                  bingePlans={bingePlans}
                  rank={allIdx + 1}
                  isFirst={allIdx === 0}
                  isLast={allIdx === combinedItems.length - 1}
                  isDragDisabled
                  onRemove={onRemove}
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
                />
              );
            })}
          </div>
        )}

      {/* ── My Order: append Currently Watching section below All/Movies/Shows ── */}
      {!loading &&
        isMyOrder &&
        (activeTab === "all" || activeTab === "movies" || activeTab === "shows") &&
        ((activeTab !== "shows" && cwFilteredMovies.length > 0) ||
          (activeTab !== "movies" && cwFilteredShows.length > 0)) && (
          <div className="flex flex-col gap-3">
            <SectionHeader title="Currently watching" />
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-posters gap-x-3 gap-y-5">
              {[
                ...(activeTab !== "shows"
                  ? cwFilteredMovies.map((m) => ({
                      ...m,
                      _contentType: "movie" as const,
                      _listType: "currently_watching" as ListType,
                      sort_key: 0,
                      watchlist_id: 0,
                    }))
                  : []),
                ...(activeTab !== "movies"
                  ? cwFilteredShows.map((s) => ({
                      ...s,
                      _contentType: "tv" as const,
                      _listType: "currently_watching" as ListType,
                      sort_key: 0,
                      watchlist_id: 0,
                    }))
                  : []),
              ].map((item) => (
                  <WatchlistCard
                    key={`cw-${item._contentType}-${item.id}`}
                    item={item}
                    bingePlans={bingePlans}
                      onRemove={onRemove}
                  />
                ))}
            </div>
          </div>
        )}

      {/* ── Poster grid (all non-my-order sorts, and up_next/currently_watching in my-order) ── */}
      {!loading &&
        (!isMyOrder || activeTab === "up_next" || activeTab === "currently_watching") &&
        gridItems.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-posters gap-x-3 gap-y-5">
            {gridItems.map((item) => (
              <WatchlistCard
                key={`${item._contentType}-${item.id}`}
                item={item}
                bingePlans={bingePlans}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
    </div>
  );
}
