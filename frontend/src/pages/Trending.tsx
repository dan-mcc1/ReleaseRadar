import { useRef, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { useTrendingMulti, useUpcoming, useAiringToday, useNowPlaying, usePopularMulti, useTopRatedMulti } from "../hooks/api/useSearch";
import { BASE_IMAGE_URL } from "../constants";

type AnyItem = Movie | Show;
type TypedItem = AnyItem & { _type: "movie" | "tv" };
type ContentFilter = "all" | "movie" | "tv";

const FILTER_OPTS: { id: ContentFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "tv", label: "TV" },
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

function splitHeroTitle(title: string) {
  const words = title.trim().split(" ");
  if (words.length === 1) return { prefix: "", italic: title };
  return { prefix: words.slice(0, -1).join(" "), italic: words[words.length - 1] };
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
    <div className="mt-10">
      {/* Row header */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <h2
          className="font-normal tracking-tight leading-none"
          style={{ fontFamily: "var(--font-serif)", fontSize: 28 }}
        >
          {title}
        </h2>
        {subtitle && (
          <span className="text-[13px] text-neutral-500 hidden sm:inline">{subtitle}</span>
        )}
        <div className="flex-1" />
        {onFilterChange && (
          <div className="flex items-center gap-0.5 p-0.5 bg-neutral-800/70 rounded-lg border border-neutral-700/50">
            {FILTER_OPTS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => onFilterChange(opt.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  filter === opt.id
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scroll container with arrows */}
      <div
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Left arrow */}
        <div
          className={`absolute left-0 inset-y-0 mb-2 z-10 flex items-center pl-1 bg-gradient-to-r from-neutral-950/90 to-transparent transition-opacity duration-200 ${
            hovered && canLeft ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <button
            onClick={() => scrollBy("left")}
            className="w-9 h-9 rounded-full bg-neutral-800/90 border border-neutral-700 flex items-center justify-center text-neutral-200 hover:bg-neutral-700 transition-colors shadow-lg"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Right arrow */}
        <div
          className={`absolute right-0 inset-y-0 mb-2 z-10 flex items-center pr-1 bg-gradient-to-l from-neutral-950/90 to-transparent transition-opacity duration-200 ${
            hovered && canRight ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <button
            onClick={() => scrollBy("right")}
            className="w-9 h-9 rounded-full bg-neutral-800/90 border border-neutral-700 flex items-center justify-center text-neutral-200 hover:bg-neutral-700 transition-colors shadow-lg"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
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
    </div>
  );
}

function PosterCard({
  item,
  onClick,
  releaseDate,
}: {
  item: TypedItem;
  onClick: () => void;
  releaseDate?: string;
}) {
  const title = getTitle(item);
  const genre = item.genres?.[0]?.name ?? "";
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
  return (
    <div className="w-[180px] flex-shrink-0 cursor-pointer group" onClick={onClick}>
      <div className="aspect-[2/3] rounded-xl overflow-hidden bg-neutral-800">
        {item.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${item.poster_path}`}
            alt={title}
            className="w-full h-full object-cover transition-opacity duration-200 group-hover:opacity-80"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-3 text-center">
            <span className="text-neutral-600 text-xs leading-tight">{title}</span>
          </div>
        )}
      </div>
      <div className="mt-2 text-[13.5px] font-semibold text-neutral-100 tracking-tight leading-tight truncate">
        {title}
      </div>
      <div className="text-[11.5px] text-neutral-500 mt-0.5">
        {releaseDate
          ? [releaseDate, rating ? `★ ${rating}` : null].filter(Boolean).join(" · ")
          : [genre, rating ? `★ ${rating}` : null].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}


export default function Trending() {
  usePageTitle("Discover");
  const navigate = useNavigate();
  const [trendingFilter, setTrendingFilter] = useState<ContentFilter>("all");
  const [upcomingFilter, setUpcomingFilter] = useState<ContentFilter>("all");
  const [popularFilter, setPopularFilter] = useState<ContentFilter>("all");
  const [topRatedFilter, setTopRatedFilter] = useState<ContentFilter>("all");

  const { data: multiData, isPending: multiLoading } = useTrendingMulti();
  const { data: airingTodayData, isPending: airingTodayLoading } = useAiringToday();
  const { data: nowPlayingData, isPending: nowPlayingLoading } = useNowPlaying();
  const { data: popularData, isPending: popularLoading } = usePopularMulti();
  const { data: topRatedData, isPending: topRatedLoading } = useTopRatedMulti();

  const today = new Date();
  const minDate = today.toISOString().split("T")[0];
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const maxDate = nextMonth.toISOString().split("T")[0];

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

  const filteredTrending =
    trendingFilter === "all" ? trendingItems : trendingItems.filter((i) => i._type === trendingFilter);
  const filteredUpcoming =
    upcomingFilter === "all" ? upcomingItems : upcomingItems.filter((i) => i._type === upcomingFilter);

  const hero: AnyItem | null = trendingMovies[0] ?? trendingShows[0] ?? null;
  const heroType: "movie" | "tv" = trendingMovies[0] ? "movie" : "tv";
  const heroTitle = hero ? getTitle(hero) : "";
  const { prefix, italic } = splitHeroTitle(heroTitle);
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

  const filteredPopular =
    popularFilter === "all" ? popularItems : popularItems.filter((i) => i._type === popularFilter);
  const filteredTopRated =
    topRatedFilter === "all" ? topRatedItems : topRatedItems.filter((i) => i._type === topRatedFilter);

  return (
    <div className="w-full px-6 sm:px-10 pt-8 pb-16" data-tour="trending-header">
      {/* Hero */}
      {multiLoading ? (
        <div className="rounded-2xl bg-neutral-800 animate-pulse" style={{ height: 420 }} />
      ) : hero ? (
        <div className="relative rounded-2xl overflow-hidden" style={{ height: 420 }}>
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
            <p className="font-mono text-[11px] tracking-[0.15em] uppercase text-white/75 mb-3.5">
              Spotlight · Trending{heroGenre ? ` · ${heroGenre}` : ""}
            </p>
            <h2
              className="font-normal leading-[0.95] tracking-tight"
              style={{ fontFamily: "var(--font-serif)", fontSize: 52 }}
            >
              {prefix && <>{prefix} </>}
              <em className="italic">{italic}</em>
            </h2>
            {heroOverview && (
              <p className="text-[14px] text-white/80 mt-4 leading-relaxed line-clamp-2 max-w-md">
                {heroOverview}
              </p>
            )}
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => navigate(`/${heroType}/${hero.id}`)}
                className="bg-primary-500 hover:bg-primary-400 text-neutral-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                More info →
              </button>
              {heroRating && (
                <span className="text-white/60 text-sm font-mono">★ {heroRating}</span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Trending row */}
      <ScrollRow
title="Trending this week"
        subtitle="What people are talking about"
        loading={multiLoading}
        filter={trendingFilter}
        onFilterChange={setTrendingFilter}
      >
        {multiLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-2.5 bg-neutral-800 rounded mt-1.5 w-1/2" />
              </div>
            ))
          : filteredTrending.map((item) => (
              <PosterCard
                key={`${item._type}-${item.id}`}
                item={item}
                onClick={() => navigate(`/${item._type}/${item.id}`)}
              />
            ))}
      </ScrollRow>

      {/* Upcoming row */}
      <ScrollRow
title="Coming soon"
        subtitle={formatDateRange()}
        loading={upcomingLoading}
        filter={upcomingFilter}
        onFilterChange={setUpcomingFilter}
      >
        {upcomingLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-2.5 bg-neutral-800 rounded mt-1.5 w-1/2" />
              </div>
            ))
          : filteredUpcoming.map((item) => (
              <PosterCard
                key={`${item._type}-${item.id}`}
                item={item}
                releaseDate={getFormattedDate(item)}
                onClick={() => navigate(`/${item._type}/${item.id}`)}
              />
            ))}
      </ScrollRow>

      {/* Airing Today row */}
      <ScrollRow
title="Airing today"
        subtitle="New episodes on TV right now"
        loading={airingTodayLoading}
      >
        {airingTodayLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-2.5 bg-neutral-800 rounded mt-1.5 w-1/2" />
              </div>
            ))
          : airingTodayItems.map((item) => (
              <PosterCard
                key={`${item._type}-${item.id}`}
                item={item}
                onClick={() => navigate(`/${item._type}/${item.id}`)}
              />
            ))}
      </ScrollRow>

      {/* Now Playing row */}
      <ScrollRow
title="In theaters now"
        subtitle="Currently showing on the big screen"
        loading={nowPlayingLoading}
      >
        {nowPlayingLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-2.5 bg-neutral-800 rounded mt-1.5 w-1/2" />
              </div>
            ))
          : nowPlayingItems.map((item) => (
              <PosterCard
                key={`${item._type}-${item.id}`}
                item={item}
                onClick={() => navigate(`/${item._type}/${item.id}`)}
              />
            ))}
      </ScrollRow>

      {/* Popular row */}
      <ScrollRow
title="Popular right now"
        subtitle="What people are watching"
        loading={popularLoading}
        filter={popularFilter}
        onFilterChange={setPopularFilter}
      >
        {popularLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-2.5 bg-neutral-800 rounded mt-1.5 w-1/2" />
              </div>
            ))
          : filteredPopular.map((item) => (
              <PosterCard
                key={`${item._type}-${item.id}`}
                item={item}
                onClick={() => navigate(`/${item._type}/${item.id}`)}
              />
            ))}
      </ScrollRow>

      {/* Top Rated row */}
      <ScrollRow
title="Top rated"
        subtitle="The highest-rated of all time"
        loading={topRatedLoading}
        filter={topRatedFilter}
        onFilterChange={setTopRatedFilter}
      >
        {topRatedLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-2.5 bg-neutral-800 rounded mt-1.5 w-1/2" />
              </div>
            ))
          : filteredTopRated.map((item) => (
              <PosterCard
                key={`${item._type}-${item.id}`}
                item={item}
                onClick={() => navigate(`/${item._type}/${item.id}`)}
              />
            ))}
      </ScrollRow>
    </div>
  );
}
