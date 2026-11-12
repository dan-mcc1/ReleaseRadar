import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuthUser } from "../hooks/useAuthUser";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { useForYou } from "../hooks/api/useRecommendations";
import { useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import { TrackingLimitError } from "../hooks/api/useSubscription";
import type { WatchStatus } from "../components/WatchButton";
import Segmented from "../components/Segmented";
import StarIcon from "../components/icons/StarIcon";
import { useToast } from "../components/Toast";
import { BASE_IMAGE_URL } from "../constants";

type Tab = "movies" | "tv";
type MediaType = "movie" | "tv";

// TMDB recommendation items have genre_ids, not genre objects
type RecItem = (Movie | Show) & {
  genre_ids?: number[];
  media_type?: string;
  /** The watched titles that led to this pick, when the server sends them. */
  because?: { id: number; title: string }[];
};

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy",
  10768: "War & Politics", 10762: "Kids", 10763: "News", 10764: "Reality",
};

const TOP_PICKS = 3;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400";
const POSTER_GRID =
  "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-posters gap-x-3 gap-y-5";
// Phones: stacked. md: the first pick leads, wide, with two below. xl: three across.
const TOP_GRID = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 xl:gap-5";
const TOP_SHAPE = "aspect-video first:md:col-span-2 first:md:aspect-[21/9] first:xl:col-span-1 first:xl:aspect-video";

function getTitle(item: RecItem) {
  return "title" in item && item.title ? item.title : (item as Show).name ?? "";
}

function getGenre(item: RecItem): string {
  if (item.genre_ids?.length) return GENRE_MAP[item.genre_ids[0]] ?? "";
  if ("genres" in item && item.genres?.length) return item.genres[0].name;
  return "";
}

function getYear(item: RecItem): string {
  const raw = "release_date" in item ? item.release_date : (item as Show).first_air_date;
  return raw ? raw.slice(0, 4) : "";
}

function listTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

function Score({ item }: { item: RecItem }) {
  if (!item.vote_average) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <StarIcon filled className="w-3 h-3 text-yellow-400" />
      {item.vote_average.toFixed(1)}
    </span>
  );
}

const PLUS = <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;
const CHECK = <path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
const BOOKMARK = <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" fill="currentColor" />;

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 shrink-0" aria-hidden="true">
      {children}
    </svg>
  );
}

interface PickProps {
  item: RecItem;
  contentType: MediaType;
  /** What the visitor has done with this pick since the list loaded. */
  status: WatchStatus;
  onSet: (target: WatchStatus) => void;
}

function TopPick({ item, contentType, status, onSet }: PickProps) {
  const title = getTitle(item);
  const because = (item.because ?? []).slice(0, 2).map((b) => b.title);
  const meta: React.ReactNode[] = [];
  if (getGenre(item)) meta.push(getGenre(item));
  if (item.vote_average) meta.push(<Score item={item} />);
  if (getYear(item)) meta.push(getYear(item));
  const listed = status === "Want To Watch";
  const watched = status === "Watched";

  return (
    <article className={`@container group relative rounded-2xl overflow-hidden bg-neutral-900 ${TOP_SHAPE}`}>
      {item.backdrop_path && (
        <img
          src={`${BASE_IMAGE_URL}/w780${item.backdrop_path}`}
          srcSet={`${BASE_IMAGE_URL}/w780${item.backdrop_path} 780w, ${BASE_IMAGE_URL}/w1280${item.backdrop_path} 1280w`}
          sizes="(min-width: 1280px) 33vw, 100vw"
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-[center_25%]"
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4/5 bg-gradient-to-t from-neutral-950/95 via-neutral-950/55 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-4 @md:p-6 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex-1 basis-60 min-w-0">
          <h3 className="text-xl @md:text-2xl @2xl:text-[2rem] font-bold leading-tight tracking-tight text-white text-balance">
            {/* The link covers the whole card; the buttons sit above it. */}
            <Link
              to={`/${contentType}/${item.id}`}
              className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary-400"
            >
              {title}
            </Link>
          </h3>
          {because.length > 0 && (
            <p className="mt-1.5 text-sm @md:text-[15px] text-neutral-100 line-clamp-1">
              Because you watched {listTitles(because)}
            </p>
          )}
          {meta.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-neutral-300">
              {meta.map((part, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {part}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="relative flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={listed}
            onClick={() => onSet("Want To Watch")}
            className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border text-[13px] font-semibold whitespace-nowrap transition-colors ${FOCUS} ${
              listed
                ? "bg-neutral-950/70 border-primary-400 text-primary-200"
                : "bg-primary-500 border-primary-500 text-primary-950 hover:bg-primary-400"
            }`}
          >
            <Glyph>{listed ? BOOKMARK : PLUS}</Glyph>
            {listed ? "On watchlist" : "Add to watchlist"}
          </button>
          <button
            type="button"
            aria-pressed={watched}
            onClick={() => onSet("Watched")}
            className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border text-[13px] font-semibold whitespace-nowrap transition-colors ${FOCUS} ${
              watched
                ? "bg-primary-500/20 border-primary-400 text-primary-200"
                : "bg-neutral-950/70 border-white/35 text-neutral-50 hover:border-white/70"
            }`}
          >
            <Glyph>{CHECK}</Glyph>
            Watched
          </button>
        </div>
      </div>
    </article>
  );
}

function QuickButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`w-9 h-9 flex items-center justify-center rounded-full border backdrop-blur-sm transition-colors ${FOCUS} ${
        pressed
          ? "bg-primary-500 border-primary-500 text-primary-950"
          : "bg-neutral-950/85 border-white/30 text-neutral-50 hover:border-primary-400 hover:text-primary-300"
      }`}
    >
      <Glyph>{children}</Glyph>
    </button>
  );
}

function PosterCard({ item, contentType, status, onSet }: PickProps) {
  const title = getTitle(item);
  const genre = getGenre(item);
  const href = `/${contentType}/${item.id}`;
  const listed = status === "Want To Watch";
  const watched = status === "Watched";

  return (
    <div className="flex flex-col min-w-0">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-800 border border-white/10 hover:border-white/40 transition-colors">
        <Link to={href} tabIndex={-1} aria-hidden="true" className="block w-full h-full">
          {item.poster_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w342${item.poster_path}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center p-2 text-center text-xs text-neutral-400">
              {title}
            </span>
          )}
        </Link>
        <div className="absolute right-1.5 bottom-1.5 flex gap-1.5">
          <QuickButton
            label={listed ? `Remove ${title} from watchlist` : `Add ${title} to watchlist`}
            pressed={listed}
            onClick={() => onSet("Want To Watch")}
          >
            {listed ? BOOKMARK : PLUS}
          </QuickButton>
          <QuickButton
            label={watched ? `Unmark ${title} as watched` : `Mark ${title} as watched`}
            pressed={watched}
            onClick={() => onSet("Watched")}
          >
            {CHECK}
          </QuickButton>
        </div>
      </div>
      <Link
        to={href}
        className={`mt-2 text-[13px] font-semibold leading-tight text-neutral-100 hover:text-primary-300 truncate rounded ${FOCUS}`}
      >
        {title}
      </Link>
      {(genre || !!item.vote_average) && (
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400 truncate">
          {genre}
          {genre && !!item.vote_average && <span aria-hidden="true">·</span>}
          <Score item={item} />
        </span>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mt-8 animate-pulse" aria-hidden="true">
      <div className={TOP_GRID}>
        {Array.from({ length: TOP_PICKS }).map((_, i) => (
          <div key={i} className={`rounded-2xl bg-neutral-800 ${TOP_SHAPE}`} />
        ))}
      </div>
      <div className={`${POSTER_GRID} mt-10`}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
            <div className="h-3 bg-neutral-800 rounded w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ForYou() {
  usePageTitle("For You");
  const currentUser = useAuthUser();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: Tab = searchParams.get("tab") === "movies" ? "movies" : "tv";
  function setActiveTab(tab: Tab) {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }

  const { data, isLoading } = useForYou();
  const updateWatchStatus = useUpdateWatchStatus();
  // What the visitor has done with each pick, so its buttons answer at once;
  // the pick itself drops out when the list refreshes.
  const [acted, setActed] = useState<Record<string, WatchStatus>>({});

  const movies = (data?.movies ?? []) as RecItem[];
  const shows = (data?.shows ?? []) as RecItem[];
  const seedCount = data?.seed_count ?? 0;

  const activeItems = activeTab === "tv" ? shows : movies;
  const contentType: MediaType = activeTab === "tv" ? "tv" : "movie";
  const noun = activeTab === "tv" ? "show" : "movie";

  const topPicks = activeItems.slice(0, TOP_PICKS);
  const morePicks = activeItems.slice(TOP_PICKS);

  async function setStatus(item: RecItem, target: WatchStatus) {
    const key = `${contentType}:${item.id}`;
    const current = acted[key] ?? "none";
    // Pressing the lit button again undoes it.
    const next: WatchStatus = current === target ? "none" : target;
    setActed((prev) => ({ ...prev, [key]: next }));
    try {
      await updateWatchStatus.mutateAsync({
        contentType,
        contentId: item.id,
        currentStatus: current,
        targetStatus: next,
      });
    } catch (err) {
      setActed((prev) => ({ ...prev, [key]: current }));
      toast.error(
        err instanceof TrackingLimitError
          ? "You've hit the free tracking limit. Upgrade to Premium for unlimited tracking."
          : `Couldn't update ${getTitle(item)}. Try again.`,
      );
    }
  }

  const pickProps = (item: RecItem): PickProps => ({
    item,
    contentType,
    status: acted[`${contentType}:${item.id}`] ?? "none",
    onSet: (target) => setStatus(item, target),
  });

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-4">
        <p className="text-neutral-300 font-medium mb-2">Sign in to see recommendations</p>
        <Link to="/signIn" className="text-primary-400 hover:text-primary-300 text-sm">
          Sign in →
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full px-6 sm:px-10 pt-8 pb-16">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
        <div className="flex-1 basis-72 min-w-0">
          <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-neutral-500">
            For you
            {seedCount > 0 &&
              ` · built from the ${seedCount} ${seedCount === 1 ? "title" : "titles"} on your lists`}
          </p>
          <h1
            className="mt-2 text-4xl font-normal leading-tight tracking-tight text-neutral-100"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Watch <em className="italic text-primary-400">next</em>
          </h1>
        </div>
        <Segmented
          label="Type"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: "tv", label: <>TV <span className="ml-1 tabular-nums opacity-70">{shows.length}</span></> },
            { value: "movies", label: <>Movies <span className="ml-1 tabular-nums opacity-70">{movies.length}</span></> },
          ]}
        />
      </div>

      {isLoading && <LoadingState />}

      {/* ── Empty: no history ── */}
      {!isLoading && seedCount === 0 && (
        <div className="py-24 text-center">
          <p className="text-neutral-200 font-medium mb-1">Nothing to go on yet</p>
          <p className="text-neutral-400 text-sm max-w-sm mx-auto">
            Add some movies or shows to your watched list or watchlist and we'll suggest things you might like.
          </p>
        </div>
      )}

      {/* ── Empty: no results for tab ── */}
      {!isLoading && seedCount > 0 && activeItems.length === 0 && (
        <p className="py-20 text-center text-neutral-400 text-sm">
          No {noun} picks right now. Try the other tab.
        </p>
      )}

      {!isLoading && topPicks.length > 0 && (
        <section aria-labelledby="top-picks" className="mt-8">
          <h2 id="top-picks" className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 mb-3">
            Top picks
          </h2>
          <div className={TOP_GRID}>
            {topPicks.map((item) => (
              <TopPick key={item.id} {...pickProps(item)} />
            ))}
          </div>
        </section>
      )}

      {!isLoading && morePicks.length > 0 && (
        <section aria-labelledby="more-picks" className="mt-10">
          <div className="flex items-baseline gap-3 pb-3 mb-4 border-b border-neutral-800">
            <h2 id="more-picks" className="text-lg font-semibold text-neutral-100">
              More picks
            </h2>
            <span className="text-[13px] text-neutral-400 tabular-nums">
              {morePicks.length} {morePicks.length === 1 ? noun : `${noun}s`}
            </span>
          </div>
          <div className={POSTER_GRID}>
            {morePicks.map((item) => (
              <PosterCard key={item.id} {...pickProps(item)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
