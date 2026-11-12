import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuthUser } from "../hooks/useAuthUser";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { useForYou } from "../hooks/api/useRecommendations";
import { useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import { TrackingLimitError } from "../hooks/api/useSubscription";
import type { WatchStatus } from "../components/WatchButton";
import {
  BookmarkIcon,
  Button,
  ButtonLink,
  CheckIcon,
  EmptyState,
  IconButton,
  PageHeader,
  PlusIcon,
  PosterCard,
  PosterCardSkeleton,
  SectionHeader,
  Segmented,
  StarIcon,
} from "../components/ui";
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
      <StarIcon className="w-3 h-3 text-warning-400" />
      <span className="tabular">{item.vote_average.toFixed(1)}</span>
    </span>
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
    <article className={`@container group relative rounded-surface overflow-hidden bg-neutral-900 ${TOP_SHAPE}`}>
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
          <h3 className="text-title @md:text-heading @2xl:text-display font-semibold leading-tight text-white text-balance">
            {/* The link covers the whole card; the buttons sit above it. */}
            <Link
              to={`/${contentType}/${item.id}`}
              className="after:absolute after:inset-0 after:rounded-surface focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary-400"
            >
              {title}
            </Link>
          </h3>
          {because.length > 0 && (
            <p className="mt-1.5 text-body text-neutral-100 line-clamp-1">
              Because you watched {listTitles(because)}
            </p>
          )}
          {meta.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-label text-neutral-300">
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
          <Button
            variant={listed ? "secondary" : "primary"}
            aria-pressed={listed}
            onClick={() => onSet("Want To Watch")}
            icon={listed ? <BookmarkIcon filled className="w-4 h-4 text-primary-300" /> : <PlusIcon />}
          >
            {listed ? "On watchlist" : "Add to watchlist"}
          </Button>
          <Button
            aria-pressed={watched}
            onClick={() => onSet("Watched")}
            icon={<CheckIcon className={watched ? "w-4 h-4 text-primary-300" : "w-4 h-4"} />}
          >
            {watched ? "Watched" : "Mark watched"}
          </Button>
        </div>
      </div>
    </article>
  );
}

function PickCard({ item, contentType, status, onSet }: PickProps) {
  const title = getTitle(item);
  const genre = getGenre(item);
  const listed = status === "Want To Watch";
  const watched = status === "Watched";

  return (
    <PosterCard
      to={`/${contentType}/${item.id}`}
      title={title}
      posterPath={item.poster_path}
      subtitle={
        (genre || !!item.vote_average) && (
          <span className="inline-flex items-center gap-1.5">
            {genre}
            {genre && !!item.vote_average && <span aria-hidden="true">·</span>}
            <Score item={item} />
          </span>
        )
      }
      actions={
        <>
          <IconButton
            label={listed ? `Remove ${title} from watchlist` : `Add ${title} to watchlist`}
            icon={listed ? <BookmarkIcon filled /> : <PlusIcon />}
            variant="overlay"
            size="touch"
            pressed={listed}
            onClick={() => onSet("Want To Watch")}
          />
          <IconButton
            label={watched ? `Unmark ${title} as watched` : `Mark ${title} as watched`}
            icon={<CheckIcon />}
            variant="overlay"
            size="touch"
            pressed={watched}
            onClick={() => onSet("Watched")}
          />
        </>
      }
    />
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-10" aria-hidden="true">
      <div className={`${TOP_GRID} animate-pulse`}>
        {Array.from({ length: TOP_PICKS }).map((_, i) => (
          <div key={i} className={`rounded-surface bg-neutral-800 ${TOP_SHAPE}`} />
        ))}
      </div>
      <div className={POSTER_GRID}>
        {Array.from({ length: 12 }).map((_, i) => (
          <PosterCardSkeleton key={i} />
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
      <EmptyState
        className="py-32"
        title="Sign in to see recommendations"
        action={
          <ButtonLink to="/signIn" variant="primary">
            Sign in
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-8">
      <PageHeader
        title="Watch next"
        description={
          seedCount > 0
            ? `Built from the ${seedCount} ${seedCount === 1 ? "title" : "titles"} on your lists`
            : undefined
        }
        actions={
          <Segmented
            label="Type"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: "tv", label: <>TV <span className="ml-1 tabular text-neutral-400">{shows.length}</span></> },
              { value: "movies", label: <>Movies <span className="ml-1 tabular text-neutral-400">{movies.length}</span></> },
            ]}
          />
        }
      />

      {isLoading && <LoadingState />}

      {/* ── Empty: no history ── */}
      {!isLoading && seedCount === 0 && (
        <EmptyState
          title="Nothing to go on yet"
          description="Add some movies or shows to your watched list or watchlist and we'll suggest things you might like."
          action={
            <ButtonLink to="/trending" variant="primary">
              Browse trending
            </ButtonLink>
          }
        />
      )}

      {/* ── Empty: no results for tab ── */}
      {!isLoading && seedCount > 0 && activeItems.length === 0 && (
        <EmptyState
          title={`No ${noun} picks right now`}
          action={
            <Button onClick={() => setActiveTab(activeTab === "tv" ? "movies" : "tv")}>
              {activeTab === "tv" ? "See movie picks" : "See TV picks"}
            </Button>
          }
        />
      )}

      {!isLoading && topPicks.length > 0 && (
        <section aria-labelledby="top-picks" className="flex flex-col gap-3">
          <SectionHeader id="top-picks" title="Top picks" />
          <div className={TOP_GRID}>
            {topPicks.map((item) => (
              <TopPick key={item.id} {...pickProps(item)} />
            ))}
          </div>
        </section>
      )}

      {!isLoading && morePicks.length > 0 && (
        <section aria-labelledby="more-picks" className="flex flex-col gap-4">
          <SectionHeader
            id="more-picks"
            title="More picks"
            note={`${morePicks.length} ${morePicks.length === 1 ? noun : `${noun}s`}`}
            divider
          />
          <div className={POSTER_GRID}>
            {morePicks.map((item) => (
              <PickCard key={item.id} {...pickProps(item)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
