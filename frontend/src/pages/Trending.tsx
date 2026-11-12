import { useRef, useState, useCallback, useEffect } from "react";
import type { Movie, Show } from "../types/calendar";
import { usePageMeta } from "../hooks/usePageMeta";
import { useTrendingMulti, useUpcoming, useAiringToday, useNowPlaying, usePopularMulti, useTopRatedMulti } from "../hooks/api/useSearch";
import { BASE_IMAGE_URL } from "../constants";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import { useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import { TrackingLimitError } from "../hooks/api/errors";
import { useToast } from "../components/Toast";
import {
  BookmarkIcon,
  ButtonLink,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  IconButton,
  PageHeader,
  PlayIcon,
  PlusIcon,
  PosterCard,
  PosterCardSkeleton,
  SectionHeader,
  Segmented,
  StarIcon,
} from "../components/ui";
import type { WatchStatus } from "../components/WatchButton";
import { useAuthUser } from "../hooks/useAuthUser";
import { toLocalISODate } from "../utils/date";

type AnyItem = Movie | Show;
type TypedItem = AnyItem & { _type: "movie" | "tv" };
type ContentFilter = "all" | "movie" | "tv";

const FILTER_OPTS: { value: ContentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV" },
];

function getTitle(item: AnyItem) {
  return "title" in item ? item.title : item.name;
}

function getFormattedDate(item: AnyItem): string {
  const raw = "release_date" in item ? item.release_date : item.first_air_date;
  if (!raw) return "";
  const [y, m, d] = raw.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Rating({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StarIcon className="w-3 h-3 text-warning-400" />
      {value}
    </span>
  );
}


function ScrollRow({
  title,
  subtitle,
  loading,
  filter,
  onFilterChange,
  children,
}: {
  title: string;
  subtitle?: string;
  loading: boolean;
  filter?: ContentFilter;
  onFilterChange?: (f: ContentFilter) => void;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const syncState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    if (!loading) requestAnimationFrame(syncState);
  }, [loading, syncState]);

  // Re-sync when filter changes (item count may change, altering overflow)
  useEffect(() => {
    requestAnimationFrame(syncState);
  }, [filter, syncState]);

  function scrollBy(dir: "left" | "right") {
    scrollRef.current?.scrollBy({ left: dir === "right" ? 600 : -600, behavior: "smooth" });
  }

  return (
    <section className="mt-10">
      <SectionHeader
        title={title}
        note={subtitle}
        className="mb-5"
        action={
          onFilterChange && (
            <Segmented label="Show" value={filter ?? "all"} onChange={onFilterChange} options={FILTER_OPTS} />
          )
        }
      />

      {/* Scroll container with arrows */}
      <div
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Mobile-only edge fades — persistent hint that the row scrolls */}
        <div
          className={`sm:hidden absolute left-0 inset-y-0 mb-2 z-10 w-8 bg-gradient-to-r from-neutral-950 to-transparent pointer-events-none transition-opacity duration-200 ${
            canLeft ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`sm:hidden absolute right-0 inset-y-0 mb-2 z-10 w-10 bg-gradient-to-l from-neutral-950 to-transparent pointer-events-none transition-opacity duration-200 ${
            canRight ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Left arrow */}
        <div
          className={`hidden sm:flex absolute left-0 inset-y-0 mb-2 z-10 items-center pl-1 bg-gradient-to-r from-neutral-950/90 to-transparent transition-opacity duration-200 ${
            hovered && canLeft ? "opacity-100" : "opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto"
          }`}
        >
          <IconButton
            variant="overlay"
            size="touch"
            label="Scroll left"
            icon={<ChevronLeftIcon />}
            onClick={() => scrollBy("left")}
          />
        </div>

        {/* Right arrow */}
        <div
          className={`hidden sm:flex absolute right-0 inset-y-0 mb-2 z-10 items-center pr-1 bg-gradient-to-l from-neutral-950/90 to-transparent transition-opacity duration-200 ${
            hovered && canRight ? "opacity-100" : "opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto"
          }`}
        >
          <IconButton
            variant="overlay"
            size="touch"
            label="Scroll right"
            icon={<ChevronRightIcon />}
            onClick={() => scrollBy("right")}
          />
        </div>

        {/* Scroll track */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-2"
          style={{ scrollbarWidth: "none" }}
          onScroll={syncState}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

function TrendingCard({
  item,
  releaseDate,
  initialStatus,
}: {
  item: TypedItem;
  releaseDate?: string;
  initialStatus?: WatchStatus;
}) {
  const user = useAuthUser();
  const toast = useToast();
  const update = useUpdateWatchStatus();
  const title = getTitle(item);
  const genre = item.genres?.[0]?.name ?? "";
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;

  // Undefined while signed out: no buttons.
  const status = user ? (initialStatus ?? "none") : undefined;

  function setStatus(target: WatchStatus) {
    if (!status || update.isPending) return;
    update
      .mutateAsync({ contentType: item._type, contentId: item.id, currentStatus: status, targetStatus: target })
      .catch((err) => {
        if (err instanceof TrackingLimitError) {
          toast.error("You've hit the free tracking limit. Upgrade to Premium for unlimited tracking.");
        }
      });
  }

  const onWatchlist = status === "Want To Watch";
  const watched = status === "Watched";

  const actions = status && (
    <>
      {status === "Currently Watching" ? (
        <span
          role="img"
          aria-label="Currently watching"
          title="Currently watching"
          className="size-touch rounded-full bg-highlight-500 text-neutral-950 flex items-center justify-center"
        >
          <PlayIcon className="w-4 h-4 ml-0.5" />
        </span>
      ) : (
        !watched && (
          <IconButton
            variant="overlay"
            size="touch"
            pressed={onWatchlist}
            label={onWatchlist ? `Remove ${title} from your watchlist` : `Add ${title} to your watchlist`}
            title={onWatchlist ? "On your watchlist · click to remove" : "Add to watchlist"}
            icon={onWatchlist ? <BookmarkIcon filled /> : <PlusIcon />}
            onClick={() => setStatus(onWatchlist ? "none" : "Want To Watch")}
          />
        )
      )}
      <IconButton
        variant="overlay"
        size="touch"
        pressed={watched}
        label={watched ? `Mark ${title} unwatched` : `Mark ${title} watched`}
        title={watched ? "Watched · click to undo" : "Mark watched"}
        icon={<CheckIcon />}
        onClick={() => setStatus(watched ? "none" : "Watched")}
      />
    </>
  );

  const lead = releaseDate || genre;
  const subtitle =
    lead || rating ? (
      <>
        {lead}
        {lead && rating && " · "}
        {rating && <Rating value={rating} />}
      </>
    ) : undefined;

  return (
    <div className="w-[180px] flex-shrink-0">
      <PosterCard
        to={`/${item._type}/${item.id}`}
        title={title}
        posterPath={item.poster_path}
        subtitle={subtitle}
        actions={actions || undefined}
      />
    </div>
  );
}


const SKELETON_CARDS = Array.from({ length: 8 });

function SkeletonCards() {
  return (
    <>
      {SKELETON_CARDS.map((_, i) => (
        <div key={i} className="w-[180px] flex-shrink-0">
          <PosterCardSkeleton />
        </div>
      ))}
    </>
  );
}

// Owns its own filter state so changing a filter only re-renders this row
function FilteredScrollRow({
  title,
  subtitle,
  items,
  loading,
  bulkStatuses,
  showReleaseDates = false,
}: {
  title: string;
  subtitle?: string;
  items: TypedItem[];
  loading: boolean;
  bulkStatuses?: Record<string, { status: WatchStatus }>;
  showReleaseDates?: boolean;
}) {
  const [filter, setFilter] = useState<ContentFilter>("all");
  const filtered = filter === "all" ? items : items.filter((i) => i._type === filter);

  return (
    <ScrollRow
      title={title}
      subtitle={subtitle}
      loading={loading}
      filter={filter}
      onFilterChange={setFilter}
    >
      {loading ? (
        <SkeletonCards />
      ) : (
        filtered.map((item) => (
          <TrendingCard
            key={`${item._type}-${item.id}`}
            item={item}
            releaseDate={showReleaseDates ? getFormattedDate(item) : undefined}
            initialStatus={bulkStatuses?.[`${item._type}:${item.id}`]?.status}
          />
        ))
      )}
    </ScrollRow>
  );
}

export default function Trending() {
  usePageMeta({ title: "Discover", description: "See what is trending in movies and TV right now, then add anything you want to follow to your Release Radar calendar." });
  const { data: multiData, isPending: multiLoading } = useTrendingMulti();
  const { data: airingTodayData, isPending: airingTodayLoading } = useAiringToday();
  const { data: nowPlayingData, isPending: nowPlayingLoading } = useNowPlaying();
  const { data: popularData, isPending: popularLoading } = usePopularMulti();
  const { data: topRatedData, isPending: topRatedLoading } = useTopRatedMulti();

  const today = new Date();
  const minDate = toLocalISODate(today);
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const maxDate = toLocalISODate(nextMonth);

  const formatDateRange = () => {
    const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
    return `${today.toLocaleDateString("en-US", opts)} – ${nextMonth.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
  };

  const { data: upcomingMoviesData, isPending: upcomingMoviesLoading } = useUpcoming(
    "movie", 1, minDate, maxDate,
  );
  const { data: upcomingShowsData, isPending: upcomingShowsLoading } = useUpcoming(
    "tv", 1, minDate, maxDate,
  );

  const trendingMovies = multiData?.movies ?? [];
  const trendingShows = multiData?.shows ?? [];

  // Interleave movies and shows for the trending row
  const trendingItems: TypedItem[] = [];
  const maxLen = Math.max(trendingMovies.length, trendingShows.length);
  for (let i = 0; i < maxLen; i++) {
    if (trendingMovies[i]) trendingItems.push({ ...trendingMovies[i], _type: "movie" });
    if (trendingShows[i]) trendingItems.push({ ...trendingShows[i], _type: "tv" });
  }

  // Sort upcoming by release date ascending
  const upcomingItems: TypedItem[] = [
    ...(upcomingMoviesData?.results ?? []).map((m) => ({ ...m, _type: "movie" as const })),
    ...(upcomingShowsData?.results ?? []).map((s) => ({ ...s, _type: "tv" as const })),
  ].sort((a, b) => {
    const da = "release_date" in a ? a.release_date : (a as Show).first_air_date ?? "";
    const db = "release_date" in b ? b.release_date : (b as Show).first_air_date ?? "";
    return da.localeCompare(db);
  });


  const hero: AnyItem | null = trendingMovies[0] ?? trendingShows[0] ?? null;
  const heroType: "movie" | "tv" = trendingMovies[0] ? "movie" : "tv";
  const heroTitle = hero ? getTitle(hero) : "";
  const heroBackdrop = hero?.backdrop_path
    ? `${BASE_IMAGE_URL}/w1280${hero.backdrop_path}`
    : null;
  const heroGenre = hero?.genres?.[0]?.name ?? "";
  const heroRating = hero?.vote_average ? hero.vote_average.toFixed(1) : null;
  const heroOverview = hero && "overview" in hero ? (hero as Movie).overview : "";

  const upcomingLoading = upcomingMoviesLoading || upcomingShowsLoading;

  const airingTodayItems: TypedItem[] = (airingTodayData?.results ?? []).map((s) => ({ ...s, _type: "tv" as const }));
  const nowPlayingItems: TypedItem[] = (nowPlayingData?.results ?? []).map((m) => ({ ...m, _type: "movie" as const }));

  const popularMovies = popularData?.movies ?? [];
  const popularShows = popularData?.shows ?? [];
  const popularItems: TypedItem[] = [];
  const popularMaxLen = Math.max(popularMovies.length, popularShows.length);
  for (let i = 0; i < popularMaxLen; i++) {
    if (popularMovies[i]) popularItems.push({ ...popularMovies[i], _type: "movie" });
    if (popularShows[i]) popularItems.push({ ...popularShows[i], _type: "tv" });
  }

  const topRatedMovies = topRatedData?.movies ?? [];
  const topRatedShows = topRatedData?.shows ?? [];
  const topRatedItems: TypedItem[] = [];
  const topRatedMaxLen = Math.max(topRatedMovies.length, topRatedShows.length);
  for (let i = 0; i < topRatedMaxLen; i++) {
    if (topRatedMovies[i]) topRatedItems.push({ ...topRatedMovies[i], _type: "movie" });
    if (topRatedShows[i]) topRatedItems.push({ ...topRatedShows[i], _type: "tv" });
  }


  const allUniqueItems = Object.values(
    [...trendingItems, ...upcomingItems, ...airingTodayItems, ...nowPlayingItems, ...popularItems, ...topRatedItems]
      .reduce<Record<string, TypedItem>>((acc, item) => {
        acc[`${item._type}:${item.id}`] = item;
        return acc;
      }, {})
  );
  const bulkStatusItems = allUniqueItems.map((i) => ({ content_type: i._type, content_id: i.id }));
  const { data: bulkStatuses } = useBulkWatchStatus(bulkStatusItems);

  return (
    <div className="w-full px-6 sm:px-10 pt-8 pb-16">
      <PageHeader title="Discover" className="mb-6" />

      {/* Hero */}
      {multiLoading ? (
        <div className="rounded-surface bg-neutral-800 animate-pulse" style={{ height: 420 }} />
      ) : hero ? (
        <div data-tour="trending-header" className="relative rounded-surface overflow-hidden" style={{ height: 420 }}>
          {heroBackdrop ? (
            <img src={heroBackdrop} alt={heroTitle} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-neutral-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
          <div
            className="absolute inset-y-0 left-10 flex flex-col justify-center text-white"
            style={{ maxWidth: 540 }}
          >
            <h2 className="text-display font-semibold leading-tight tracking-tight">{heroTitle}</h2>
            {heroOverview && (
              <p className="text-body text-white/80 mt-4 leading-relaxed line-clamp-2 max-w-md">
                {heroOverview}
              </p>
            )}
            <div className="flex items-center gap-3 mt-5">
              <ButtonLink variant="primary" to={`/${heroType}/${hero.id}`}>
                More info
                <ChevronRightIcon />
              </ButtonLink>
              {(heroGenre || heroRating) && (
                <span className="text-white/70 text-label">
                  {heroGenre}
                  {heroGenre && heroRating && " · "}
                  {heroRating && <Rating value={heroRating} />}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <FilteredScrollRow
        title="Trending this week"
        items={trendingItems}
        loading={multiLoading}
        bulkStatuses={bulkStatuses}
      />

      <FilteredScrollRow
        title="Coming soon"
        subtitle={formatDateRange()}
        items={upcomingItems}
        loading={upcomingLoading}
        bulkStatuses={bulkStatuses}
        showReleaseDates
      />

      <ScrollRow title="Airing today" subtitle="New episodes on TV right now" loading={airingTodayLoading}>
        {airingTodayLoading ? <SkeletonCards /> : airingTodayItems.map((item) => (
          <TrendingCard
            key={`${item._type}-${item.id}`}
            item={item}
            initialStatus={bulkStatuses?.[`${item._type}:${item.id}`]?.status}
          />
        ))}
      </ScrollRow>

      <ScrollRow title="In theaters now" subtitle="Currently showing on the big screen" loading={nowPlayingLoading}>
        {nowPlayingLoading ? <SkeletonCards /> : nowPlayingItems.map((item) => (
          <TrendingCard
            key={`${item._type}-${item.id}`}
            item={item}
            initialStatus={bulkStatuses?.[`${item._type}:${item.id}`]?.status}
          />
        ))}
      </ScrollRow>

      <FilteredScrollRow
        title="Popular right now"
        subtitle="What people are watching"
        items={popularItems}
        loading={popularLoading}
        bulkStatuses={bulkStatuses}
      />

      <FilteredScrollRow
        title="Top rated"
        subtitle="The highest-rated of all time"
        items={topRatedItems}
        loading={topRatedLoading}
        bulkStatuses={bulkStatuses}
      />
    </div>
  );
}
