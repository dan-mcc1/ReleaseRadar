import { useCallback, useMemo, useState } from "react";
import type { Show, Movie } from "../types/calendar";
import { useSearchParams } from "react-router-dom";
import VirtualSections, { type GridSection } from "../components/VirtualSections";
import { POSTER_COLS, type ColBreakpoint } from "../components/VirtualGrid";
import ListFilterPanel, {
  DEFAULT_FILTERS,
  type ListFilters,
  countActiveFilters,
  applyFilters,
} from "../components/ListFilterPanel";
import {
  Button,
  ButtonLink,
  Chip,
  CloseIcon,
  EmptyState,
  IconButton,
  PageHeader,
  PosterCard,
  PosterCardSkeleton,
  SearchField,
  Segmented,
  StarIcon,
  cx,
  focusRing,
  selectClass,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { usePageTitle } from "../hooks/usePageTitle";
import { useWatched, useRemoveFromList } from "../hooks/api/useLists";
import { useRateItem } from "../hooks/api/useWatchActions";
import { useMyProviderIds } from "../hooks/api/useStreamingServices";

type TabType = "all" | "movies" | "tv";
type SortType =
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

// The poster tiers from 1536px up; below that, fewer and wider cards so the
// stars and the date still fit under each poster.
const WATCHED_COLS: ColBreakpoint[] = [
  ...POSTER_COLS.filter((bp) => bp.minWidth >= 1536),
  { minWidth: 1280, cols: 8 },
  { minWidth: 1024, cols: 7 },
  { minWidth: 768, cols: 5 },
  { minWidth: 480, cols: 4 },
  { minWidth: 0, cols: 3 },
];

function getTitle(item: Movie | Show) {
  return "title" in item ? item.title : item.name;
}

function getDate(item: Movie | Show): string {
  return ("release_date" in item ? item.release_date : item.first_air_date) ?? "";
}

function itemKey(item: CombinedItem): string {
  return `${item._contentType}-${item.id}`;
}

/** Unrated last, whichever way the ratings run. */
function byRating(a: CombinedItem, b: CombinedItem, dir: 1 | -1): number {
  const ra = a.user_rating ?? null;
  const rb = b.user_rating ?? null;
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1;
  if (rb === null) return -1;
  return (ra - rb) * dir;
}

function applySort(items: CombinedItem[], sort: SortType): CombinedItem[] {
  const sorted = [...items];
  switch (sort) {
    // Undated last either way, where "Date unknown" is drawn.
    case "watched_desc":
      return sorted.sort((a, b) => (b.watched_at ?? "").localeCompare(a.watched_at ?? ""));
    case "watched_asc":
      return sorted.sort((a, b) =>
        (a.watched_at ?? "￿").localeCompare(b.watched_at ?? "￿"),
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
      return sorted.sort((a, b) => byRating(a, b, -1));
    case "rating_asc":
      return sorted.sort((a, b) => byRating(a, b, 1));
    case "tmdb_rating_desc":
      return sorted.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    case "tmdb_rating_asc":
      return sorted.sort((a, b) => (a.vote_average ?? 0) - (b.vote_average ?? 0));
  }
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * When a title was marked watched, on the viewer's calendar. Imports that
 * only had a date store it as midnight UTC, which west of UTC is the evening
 * before; those are read as that calendar date instead.
 */
function watchedDate(iso: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:00)$/.exec(iso);
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
  return new Date(iso);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Items in watch order, under a heading per month watched. */
function byMonthWatched(items: CombinedItem[]): GridSection<CombinedItem>[] {
  const sections: GridSection<CombinedItem>[] = [];
  const undated: CombinedItem[] = [];
  for (const item of items) {
    if (!item.watched_at) {
      undated.push(item);
      continue;
    }
    const date = watchedDate(item.watched_at);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const last = sections[sections.length - 1];
    if (last?.key === key) last.items.push(item);
    else sections.push({ key, title: monthFormatter.format(date), items: [item] });
  }
  if (undated.length > 0) sections.push({ key: "undated", title: "Date unknown", items: undated });
  for (const s of sections) s.note = plural(s.items.length, "title");
  return sections;
}

/**
 * Five stars, each a button: pointing previews, clicking rates, and clicking
 * the current rating clears it. One tab stop per card; the arrow keys move
 * between the stars. Unrated titles say "Rate" beside them.
 */
function RatingStars({
  title,
  rating,
  onRate,
}: {
  title: string;
  rating: number | null;
  onRate: (rating: number | null) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? rating ?? 0;
  const tabStop = rating ?? 1;

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, n: number) {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? Math.min(5, n + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? Math.max(1, n - 1)
          : e.key === "Home"
            ? 1
            : e.key === "End"
              ? 5
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = e.currentTarget.parentElement?.children[next - 1];
    if (target instanceof HTMLElement) target.focus();
  }

  return (
    <div
      role="group"
      aria-label={rating ? `Your rating for ${title}: ${rating} of 5` : `Rate ${title}`}
      className="flex items-center h-11 -my-2.5"
      onPointerLeave={() => setPreview(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          tabIndex={n === tabStop ? 0 : -1}
          aria-pressed={rating === n}
          aria-label={rating === n ? `Clear your ${n}-star rating` : `${n} of 5`}
          // Touch has no hover, and a tap's preview would never be cleared.
          onPointerEnter={(e) => e.pointerType === "mouse" && setPreview(n)}
          onKeyDown={(e) => onKeyDown(e, n)}
          onClick={() => {
            setPreview(null);
            onRate(rating === n ? null : n);
          }}
          className={cx("h-11 w-[17px] flex items-center justify-center rounded-sm cursor-pointer", focusRing)}
        >
          <StarIcon
            filled={n <= shown}
            className={`w-[15px] h-[15px] ${
              n <= shown
                ? preview !== null
                  ? "text-warning-300"
                  : "text-warning-400"
                : "text-neutral-500"
            }`}
          />
        </button>
      ))}
      {rating == null && preview == null && (
        <span className="hidden @min-[150px]:inline ml-1.5 text-caption font-medium text-neutral-400">
          Rate
        </span>
      )}
    </div>
  );
}

function WatchedCard({
  item,
  onRate,
  onRemove,
}: {
  item: CombinedItem;
  onRate: (rating: number | null) => void;
  onRemove: () => void;
}) {
  const title = getTitle(item);
  const to = `/${item._contentType === "movie" ? "movie" : "tv"}/${item.id}`;
  let watchedOn: string | null = null;
  if (item.watched_at) {
    const date = watchedDate(item.watched_at);
    watchedOn = (
      date.getFullYear() === new Date().getFullYear() ? dayFormatter : fullDateFormatter
    ).format(date);
  }

  return (
    <PosterCard
      to={to}
      title={title}
      posterPath={item.poster_path}
      className="group/card"
      corner={
        <IconButton
          label={`Remove ${title} from watched`}
          icon={<CloseIcon className="w-3.5 h-3.5" />}
          variant="overlay"
          size="sm"
          onClick={onRemove}
          className="opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        />
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-2 min-h-6">
          <RatingStars title={title} rating={item.user_rating ?? null} onRate={onRate} />
          {watchedOn && (
            <time className="text-caption text-neutral-400 whitespace-nowrap">{watchedOn}</time>
          )}
        </div>
      }
    />
  );
}

export default function Watched() {
  usePageTitle("Watched");
  const { data, isLoading } = useWatched();
  const removeFromList = useRemoveFromList();
  const { mutateAsync: rateAsync } = useRateItem();
  const toast = useToast();
  const myProviderIds = useMyProviderIds();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabType = tabParam === "movies" || tabParam === "tv" ? tabParam : "all";
  function setActiveTab(tab: TabType) {
    setSearchParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortType>("watched_desc");
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [unratedOnly, setUnratedOnly] = useState(false);
  // Titles rated while "unrated only" is on stay put until it's turned off,
  // so the grid doesn't shift under the pointer mid-sweep.
  const [ratedHere, setRatedHere] = useState<ReadonlySet<string>>(new Set());

  const results = useMemo(() => data ?? { movies: [], shows: [] }, [data]);
  const allItems: CombinedItem[] = useMemo(
    () => [
      ...results.movies.map((m) => ({ ...m, _contentType: "movie" as const })),
      ...results.shows.map((s) => ({ ...s, _contentType: "tv" as const })),
    ],
    [results],
  );

  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    allItems.forEach((item) => (item.genres ?? []).forEach((g) => set.add(g.name)));
    return [...set].sort();
  }, [allItems]);

  const availableCertifications = useMemo(() => {
    const set = new Set<string>();
    allItems.forEach((item) => {
      if (item.certification) set.add(item.certification);
    });
    return [...set];
  }, [allItems]);

  const stats = useMemo(() => {
    const ratings = allItems
      .map((i) => i.user_rating)
      .filter((r): r is number => r != null);
    const average = ratings.length
      ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
      : null;
    return { rated: ratings.length, unrated: allItems.length - ratings.length, average };
  }, [allItems]);

  const activeFilterCount = countActiveFilters(filters);
  const totalCount = allItems.length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let items = allItems;
    if (activeTab === "movies") items = items.filter((i) => i._contentType === "movie");
    if (activeTab === "tv") items = items.filter((i) => i._contentType === "tv");
    if (q) items = items.filter((i) => getTitle(i).toLowerCase().includes(q));
    let filtered = applyFilters(
      unratedOnly ? items.filter((i) => i.user_rating == null) : items,
      filters,
      myProviderIds,
    );
    if (unratedOnly && ratedHere.size > 0) {
      // Their new rating no longer counts against them, here or in the
      // panel's rating filter.
      filtered = [
        ...filtered,
        ...applyFilters(
          items.filter((i) => i.user_rating != null && ratedHere.has(itemKey(i))),
          { ...filters, userRatings: [] },
          myProviderIds,
        ),
      ];
    }
    return applySort(filtered, sort);
  }, [allItems, activeTab, query, unratedOnly, ratedHere, filters, myProviderIds, sort]);

  const sections = useMemo(
    () =>
      sort === "watched_desc" || sort === "watched_asc"
        ? byMonthWatched(shown)
        : [{ key: "all", items: shown }],
    [shown, sort],
  );

  function toggleUnratedOnly() {
    setUnratedOnly((v) => !v);
    setRatedHere(new Set());
  }

  const rate = useCallback(
    (item: CombinedItem, rating: number | null) => {
      if (unratedOnly) setRatedHere((prev) => new Set(prev).add(itemKey(item)));
      // mutateAsync, not mutate's onError, which only fires for the latest call.
      rateAsync({ contentType: item._contentType, contentId: item.id, rating })
        .catch(() => toast.error(`Couldn't save your rating for ${getTitle(item)}. Try again.`));
    },
    [unratedOnly, rateAsync, toast],
  );

  const renderItem = useCallback(
    (item: CombinedItem) => (
      <WatchedCard
        item={item}
        onRate={(rating) => rate(item, rating)}
        onRemove={() =>
          removeFromList.mutate({
            list: "watched",
            contentType: item._contentType,
            contentId: item.id,
          })
        }
      />
    ),
    [rate, removeFromList],
  );

  const tabs: { value: TabType; label: string; count: number }[] = [
    { value: "all", label: "All", count: totalCount },
    { value: "movies", label: "Movies", count: results.movies.length },
    { value: "tv", label: "TV shows", count: results.shows.length },
  ];

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <PageHeader
        title="Watched"
        description={
          isLoading
            ? undefined
            : stats.average === null
              ? `${plural(totalCount, "title")} you've finished`
              : `${plural(totalCount, "title")} you've finished · ${stats.rated} rated, averaging ${stats.average.toFixed(1)} stars`
        }
        actions={
          totalCount > 0 && (
            <>
              <Button
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                className={showFilters || activeFilterCount > 0 ? "border-primary-500/60 text-primary-200" : undefined}
              >
                Filters
                {activeFilterCount > 0 && (
                  <span className="min-w-5 h-5 px-1 rounded-full bg-primary-500 text-neutral-950 text-caption font-semibold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              <label htmlFor="watched-sort" className="sr-only">
                Sort
              </label>
              <select
                id="watched-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortType)}
                className={selectClass}
              >
                <option value="watched_desc">Recently watched</option>
                <option value="watched_asc">Watched longest ago</option>
                <option value="rating_desc">My rating: high to low</option>
                <option value="rating_asc">My rating: low to high</option>
                <option value="title_asc">Title: A to Z</option>
                <option value="title_desc">Title: Z to A</option>
                <option value="date_desc">Release date: newest</option>
                <option value="date_asc">Release date: oldest</option>
                <option value="popularity_desc">Most popular</option>
                <option value="tmdb_rating_desc">TMDb rating: high to low</option>
                <option value="tmdb_rating_asc">TMDb rating: low to high</option>
              </select>
            </>
          )
        }
      />

      {showFilters && totalCount > 0 && (
        <ListFilterPanel
          filters={filters}
          onChange={setFilters}
          availableGenres={availableGenres}
          availableCertifications={availableCertifications}
          hasMyServices={myProviderIds.size > 0}
          showUserRating
        />
      )}

      {/* ── Type and search ── */}
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Segmented
            label="Type"
            value={activeTab}
            onChange={setActiveTab}
            options={tabs.map((t) => ({
              value: t.value,
              label: (
                <>
                  {t.label}
                  <span className="ml-1.5 tabular text-neutral-500">{t.count}</span>
                </>
              ),
            }))}
          />
          <SearchField value={query} onChange={setQuery} label="Search watched titles" />
          {(stats.unrated > 0 || unratedOnly) && (
            <Chip pressed={unratedOnly} onClick={toggleUnratedOnly} count={stats.unrated}>
              Unrated only
            </Chip>
          )}
        </div>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <div
          className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-posters gap-x-4 gap-y-6"
          aria-hidden="true"
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <PosterCardSkeleton key={i} />
          ))}
        </div>
      ) : totalCount === 0 ? (
        <EmptyState
          title="Nothing watched yet"
          description="Mark something watched from its page and it lands here, ready to rate."
          action={
            <ButtonLink to="/trending" variant="primary">
              Browse trending
            </ButtonLink>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={
            query.trim()
              ? `Nothing watched matches “${query.trim()}”`
              : unratedOnly && activeFilterCount === 0
                ? "Nothing left to rate here"
                : "Nothing matches these filters"
          }
          action={
            <>
              {query.trim() && <Button onClick={() => setQuery("")}>Clear search</Button>}
              {activeFilterCount > 0 && (
                <Button onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</Button>
              )}
              {unratedOnly && <Button onClick={toggleUnratedOnly}>Show rated titles too</Button>}
            </>
          }
        />
      ) : (
        <VirtualSections
          sections={sections}
          itemKey={itemKey}
          renderItem={renderItem}
          colBreakpoints={WATCHED_COLS}
          colGap={16}
          rowGap={24}
          captionHeight={50}
        />
      )}
    </div>
  );
}
