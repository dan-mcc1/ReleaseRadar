import { Link, useParams } from "react-router-dom";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { BASE_IMAGE_URL } from "../constants";
import type { Movie } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatLocalDate, toLocalISODate } from "../utils/date";
import BackdropCard from "../components/media/BackdropCard";
import FavoriteButton from "../components/FavoriteButton";
import StarRating from "../components/StarRating";
import {
  Button,
  ButtonLink,
  Card,
  CheckIcon,
  EmptyState,
  PageState,
  IconButton,
  SectionHeader,
  StarIcon,
  buttonClass,
  focusRing,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type { WatchStatus } from "../components/WatchButton";
import { useAuthUser } from "../hooks/useAuthUser";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import { useRateItem, useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import { TrackingLimitError } from "../hooks/api/useSubscription";
import {
  useCollectionInfo,
  useCollectionStats,
  useCollectionRanking,
  useSetCollectionRanking,
  isNotFoundError,
} from "../hooks/api/useCollectionInfo";
import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null]
    .filter(Boolean)
    .join(" ");
}

function formatMoney(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function CollectionInfo() {
  const { id } = useParams<{ id: string }>();
  const {
    data: rawCollection,
    isPending: loading,
    error,
  } = useCollectionInfo(id);
  const { data: stats } = useCollectionStats(id);
  const user = useAuthUser();
  usePageTitle(rawCollection?.name);

  // ── Hooks must run unconditionally — keep these above any early returns. ──
  const sortedParts = useMemo<Movie[]>(
    () =>
      [...(rawCollection?.parts ?? [])].sort((a: Movie, b: Movie) =>
        (a.release_date ?? "").localeCompare(b.release_date ?? ""),
      ),
    [rawCollection?.parts],
  );
  const partItems = useMemo(
    () =>
      sortedParts.map((p) => ({
        content_type: "movie",
        content_id: p.id,
      })),
    [sortedParts],
  );
  const { data: statusMap } = useBulkWatchStatus(user ? partItems : []);
  const { data: rankingData } = useCollectionRanking(id);
  const setRanking = useSetCollectionRanking(id);
  const rankingArray = rankingData?.ranking ?? [];

  // Watched films in user-rank order (unranked watched films fall to the end,
  // sorted by title so they're deterministic).
  const rankedWatched = useMemo<Movie[]>(() => {
    if (!user) return [];
    const watched = sortedParts.filter(
      (p) => statusMap?.[`movie:${p.id}`]?.status === "Watched",
    );
    const rankMap = new Map(rankingArray.map((r) => [r.movie_id, r.rank]));
    return [...watched].sort((a, b) => {
      const ra = rankMap.get(a.id);
      const rb = rankMap.get(b.id);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
  }, [user, sortedParts, statusMap, rankingArray]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleRankDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rankedWatched.findIndex((m) => m.id === active.id);
    const newIndex = rankedWatched.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(rankedWatched, oldIndex, newIndex);
    setRanking.mutate(reordered.map((m) => m.id));
  }

  const today = toLocalISODate(new Date());
  const isReleased = (p: Movie) => !!p.release_date && p.release_date <= today;

  // "Watched of released", matching the browse cards and My Collections:
  // upcoming parts don't count until they're out.
  const progress = useMemo(() => {
    if (!user || sortedParts.length === 0) return null;
    const released = sortedParts.filter(
      (p) => p.release_date && p.release_date <= today,
    );
    let watched = 0;
    let watching = 0;
    let watchlisted = 0;
    let minutesLeft = 0;
    let upNextId: number | null = null;
    for (const part of released) {
      const status = statusMap?.[`movie:${part.id}`]?.status;
      if (status === "Watched") {
        watched++;
        continue;
      }
      if (status === "Currently Watching") watching++;
      else if (status === "Want To Watch") watchlisted++;
      minutesLeft += part.runtime ?? 0;
      // The earliest release you haven't watched.
      if (upNextId === null) upNextId = part.id;
    }
    const total = released.length;
    return {
      total,
      watched,
      watching,
      watchlisted,
      unseen: total - watched - watching - watchlisted,
      pct: total === 0 ? 0 : Math.round((watched / total) * 100),
      minutesLeft,
      // Nothing is "next" until the statuses have loaded.
      upNextId: statusMap ? upNextId : null,
    };
  }, [user, sortedParts, statusMap, today]);

  if (loading) return <PageState status="loading" label="Loading collection…" />;
  if (error && !isNotFoundError(error))
    return (
      <PageState
        status="error"
        error={error}
        subject="collection"
        back={{ to: "/collections", label: "Browse collections" }}
      />
    );
  if (!rawCollection)
    return (
      <EmptyState
        title="Collection not found"
        action={
          <ButtonLink to="/collections" variant="primary">
            Browse collections
          </ButtonLink>
        }
      />
    );

  const collection = {
    ...rawCollection,
    parts: sortedParts,
  };
  const filmCount = collection.parts.length;

  const yearRange =
    stats?.min_year != null && stats?.max_year != null
      ? stats.min_year === stats.max_year
        ? String(stats.min_year)
        : `${stats.min_year}–${stats.max_year}`
      : null;

  const topGenres = (stats?.genres ?? []).slice(0, 3).map((g) => g.name);
  const complete = !!progress && progress.total > 0 && progress.watched === progress.total;
  // The ranking gets a column of its own, for signed-in visitors.
  const hasRail = !!user;

  const keyFacts = stats && stats.count > 0 && (
    <>
      <SectionHeader title="Key facts" className="mb-3" />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-body">
        <Fact label="Films">{stats.count}</Fact>
        {yearRange && <Fact label="Years">{yearRange}</Fact>}
        {stats.total_runtime != null && stats.total_runtime > 0 && (
          <Fact label="Total runtime">{formatRuntime(stats.total_runtime)}</Fact>
        )}
        {stats.avg_runtime != null && stats.avg_runtime > 0 && (
          <Fact label="Average runtime">{formatRuntime(Math.round(stats.avg_runtime))}</Fact>
        )}
        {stats.avg_rating != null && <Fact label="Average score">{stats.avg_rating.toFixed(2)}</Fact>}
        {stats.highest_rating != null && <Fact label="Highest score">{stats.highest_rating.toFixed(1)}</Fact>}
        {stats.lowest_rating != null && <Fact label="Lowest score">{stats.lowest_rating.toFixed(1)}</Fact>}
        {stats.total_budget != null && stats.total_budget > 0 && (
          <Fact label="Total budget">{formatMoney(stats.total_budget)}</Fact>
        )}
        {stats.total_revenue != null && stats.total_revenue > 0 && (
          <Fact label="Total revenue">{formatMoney(stats.total_revenue)}</Fact>
        )}
        {stats.avg_budget != null && stats.avg_budget > 0 && (
          <Fact label="Average budget">{formatMoney(stats.avg_budget)}</Fact>
        )}
        {stats.avg_revenue != null && stats.avg_revenue > 0 && (
          <Fact label="Average revenue">{formatMoney(stats.avg_revenue)}</Fact>
        )}
      </dl>
    </>
  );

  return (
    <div className="pb-16 w-full">
      {/* Phones: one column. lg: side panel + main. 2xl: a third column for the ranking. */}
      <div
        className={`mx-auto max-w-[1920px] px-6 sm:px-10 pt-6 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] gap-x-10 gap-y-6 items-start ${
          hasRail ? "2xl:grid-cols-[280px_minmax(0,1fr)_320px]" : ""
        }`}
      >
        <BackdropCard
          backdropPath={collection.backdrop_path}
          className="lg:col-start-2 lg:row-start-1"
          title={
            <h1 className="text-display font-semibold leading-tight text-white text-balance drop-shadow-lg">
              {collection.name}
            </h1>
          }
        />

        {/* Side panel. It stays in view while the page scrolls, on windows tall enough to fit it. */}
        <aside className="lg:col-start-1 lg:row-start-1 lg:row-span-2 flex flex-col gap-4 min-w-0 lg:[@media(min-height:1250px)]:sticky lg:[@media(min-height:1250px)]:top-20">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 lg:block">
            {collection.poster_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w342${collection.poster_path}`}
                srcSet={`${BASE_IMAGE_URL}/w342${collection.poster_path} 342w, ${BASE_IMAGE_URL}/w500${collection.poster_path} 500w`}
                sizes="(min-width: 1024px) 280px, 96px"
                alt={`${collection.name} poster`}
                className="w-24 lg:w-full rounded-surface shadow-2xl border border-white/10"
              />
            ) : (
              <div className="w-24 lg:w-full aspect-[2/3] rounded-surface bg-neutral-800 border border-white/10" />
            )}

            <div className="min-w-0 lg:mt-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-neutral-300">
                {stats?.avg_rating != null && (
                  <span className="flex items-center gap-1.5">
                    <StarIcon className="w-3.5 h-3.5 text-warning-400" />
                    {stats.avg_rating.toFixed(1)} average
                  </span>
                )}
                {filmCount > 0 && (
                  <span>
                    {filmCount} {filmCount === 1 ? "film" : "films"}
                  </span>
                )}
                {yearRange && <span>{yearRange}</span>}
              </div>
              {topGenres.length > 0 && (
                <div className="mt-1.5 text-body text-neutral-400">{topGenres.join(" · ")}</div>
              )}
            </div>
          </div>

          {user && (
            <FavoriteButton
              contentType="collection"
              contentId={collection.id}
              variant="row"
              className={`${buttonClass("secondary")} w-full`}
            />
          )}

          {progress && progress.total > 0 && (
            <Card as="section" aria-label="Your progress" padding="sm">
              <div className="flex items-center justify-between">
                <SectionHeader title="Your progress" as="h3" />
                {complete && <span className="text-label font-semibold text-primary-300">Complete</span>}
              </div>

              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="text-heading font-semibold text-neutral-100 tabular">{progress.watched}</span>
                <span className="text-body text-neutral-300">of {progress.total} watched</span>
                <span className="ml-auto text-body text-neutral-300 tabular">{progress.pct}%</span>
              </div>

              <div
                role="img"
                aria-label={`${progress.pct} percent watched`}
                className="mt-2.5 h-2 w-full bg-neutral-800 rounded-full overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-primary-500 transition-[width] duration-300"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>

              <dl className="mt-3.5 grid grid-cols-3 gap-2 text-center">
                <Count label="Watching" value={progress.watching} />
                <Count label="Watchlist" value={progress.watchlisted} />
                <Count label="Not seen" value={progress.unseen} />
              </dl>

              <p className="mt-3.5 text-label text-neutral-300 leading-snug">
                {complete ? (
                  "You've seen every film in this collection."
                ) : (
                  <>
                    {progress.total - progress.watched}{" "}
                    {progress.total - progress.watched === 1 ? "film" : "films"} left
                    {progress.minutesLeft > 0 && `, about ${formatRuntime(progress.minutesLeft)} to finish`}.
                  </>
                )}
              </p>
            </Card>
          )}

          {keyFacts && <div className="hidden lg:block pt-4 border-t border-neutral-800">{keyFacts}</div>}
        </aside>

        {/* Main column */}
        <div className="lg:col-start-2 lg:row-start-2 min-w-0 space-y-8">
          {collection.overview && (
            <p className="text-title leading-relaxed text-neutral-200 max-w-3xl">
              {collection.overview}
            </p>
          )}

          <section aria-label="Films">
            <SectionHeader title="Films" note="in release order" divider className="mb-4" />
            {filmCount === 0 ? (
              <p className="py-6 text-neutral-400">No films are listed for this collection yet.</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {collection.parts.map((movie, i) => (
                  <FilmRow
                    key={movie.id}
                    movie={movie}
                    number={i + 1}
                    released={isReleased(movie)}
                    upNext={progress?.upNextId === movie.id}
                    // No buttons until the statuses are in, so a click can't act on a stale one.
                    entry={user ? statusMap?.[`movie:${movie.id}`] : undefined}
                  />
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Below lg the key facts leave the side panel and sit under the main column. */}
        {keyFacts && (
          <Card padding="sm" className="lg:hidden">
            {keyFacts}
          </Card>
        )}

        {/* Rail: under the main column until 2xl, then a column of its own. */}
        {hasRail && (
          <Card
            as="aside"
            padding="sm"
            aria-label="Your ranking"
            className="lg:col-start-2 2xl:col-start-3 2xl:row-start-1 2xl:row-span-2 min-w-0"
          >
            <SectionHeader title="Your ranking" />
            {rankedWatched.length === 0 ? (
              <p className="mt-2 text-label text-neutral-400 leading-snug">
                Mark films as watched and they'll appear here for you to put in order.
              </p>
            ) : (
              <>
                <p className="mt-2 mb-3.5 text-label text-neutral-400 leading-snug">
                  Drag to reorder. Only films you've watched appear here.
                </p>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRankDragEnd}>
                  <SortableContext items={rankedWatched.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                    <ol className="flex flex-col gap-2">
                      {rankedWatched.map((m, i) => (
                        <SortableRankRow key={m.id} movie={m} rank={i + 1} />
                      ))}
                    </ol>
                  </SortableContext>
                </DndContext>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-neutral-400">{label}</dt>
      <dd className="text-neutral-100 tabular">{children}</dd>
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-caption text-neutral-400">{label}</dt>
      <dd className="text-title font-semibold text-neutral-100 tabular">{value}</dd>
    </div>
  );
}

function FilmRow({
  movie,
  number,
  released,
  upNext,
  entry,
}: {
  movie: Movie;
  number: number;
  released: boolean;
  upNext: boolean;
  /** The visitor's status and rating for this film; undefined when signed out or still loading. */
  entry?: { status: WatchStatus; rating: number | null };
}) {
  const toast = useToast();
  const update = useUpdateWatchStatus();
  const rate = useRateItem();
  const status = entry?.status ?? "none";
  const thumb = movie.backdrop_path || movie.poster_path;

  async function setStatus(targetStatus: WatchStatus) {
    try {
      await update.mutateAsync({
        contentType: "movie",
        contentId: movie.id,
        currentStatus: status,
        targetStatus,
      });
    } catch (err) {
      if (err instanceof TrackingLimitError) {
        toast.error("You've hit the free tracking limit. Upgrade to Premium for unlimited tracking.");
      }
    }
  }

  const meta: ReactNode[] = [];
  if (!movie.release_date) meta.push("Date to be announced");
  else if (released) meta.push(movie.release_date.slice(0, 4));
  else meta.push(`Out ${formatLocalDate(movie.release_date, { month: "short", day: "numeric", year: "numeric" })}`);
  if (movie.runtime > 0) meta.push(formatRuntime(movie.runtime));
  if (released && movie.vote_average != null && movie.vote_average > 0) {
    meta.push(
      <span className="inline-flex items-center gap-1">
        <StarIcon className="w-3 h-3 text-warning-400" />
        {movie.vote_average.toFixed(1)}
      </span>,
    );
  }

  return (
    <li
      className={`@container rounded-surface border bg-neutral-900/60 ${
        upNext ? "border-primary-400" : "border-neutral-800"
      }`}
    >
      <div className="grid grid-cols-[1.25rem_6rem_minmax(0,1fr)] @2xl:grid-cols-[1.75rem_11.5rem_minmax(0,1fr)_auto] items-center gap-x-3 @2xl:gap-x-5 gap-y-3 p-3.5">
        <span className="text-label text-neutral-400 text-center tabular">{number}</span>

        <Link to={`/movie/${movie.id}`} tabIndex={-1} aria-hidden="true" className="block">
          {thumb ? (
            <img
              src={`${BASE_IMAGE_URL}/w300${thumb}`}
              alt=""
              loading="lazy"
              className="w-full aspect-video object-cover rounded-lg border border-white/10 bg-neutral-800"
            />
          ) : (
            <div className="w-full aspect-video rounded-lg border border-white/10 bg-neutral-800" />
          )}
        </Link>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Link
              to={`/movie/${movie.id}`}
              className={`text-base font-semibold leading-snug text-neutral-100 hover:text-primary-300 rounded ${focusRing}`}
            >
              {movie.title}
            </Link>
            {upNext && (
              <span className="px-2 py-0.5 rounded-full bg-primary-400 text-primary-950 text-caption font-semibold">
                Up next
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-label text-neutral-400">
            {meta.map((part, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                {i > 0 && <span aria-hidden="true">·</span>}
                {part}
              </span>
            ))}
          </div>
          {movie.overview && (
            <p className="mt-1.5 text-label leading-snug text-neutral-300 line-clamp-2">{movie.overview}</p>
          )}
        </div>

        {entry && (
          <div className="col-start-2 col-span-2 @2xl:col-start-4 @2xl:col-span-1 flex flex-wrap items-center gap-x-4 gap-y-2 @2xl:justify-end">
            {status === "Watched" && (
              <StarRating
                rating={entry.rating}
                saving={rate.isPending}
                onRate={(rating) => rate.mutate({ contentType: "movie", contentId: movie.id, rating })}
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {status === "Watched" ? (
                <Button
                  aria-pressed="true"
                  title="Remove from watched"
                  disabled={update.isPending}
                  onClick={() => setStatus("none")}
                  icon={<CheckIcon className="w-4 h-4 text-primary-300" />}
                >
                  Watched
                </Button>
              ) : (
                <>
                  {status === "none" ? (
                    <Button disabled={update.isPending} onClick={() => setStatus("Want To Watch")}>
                      Add to watchlist
                    </Button>
                  ) : (
                    <Button
                      aria-pressed="true"
                      title={status === "Want To Watch" ? "Remove from watchlist" : "Stop watching"}
                      disabled={update.isPending}
                      onClick={() => setStatus("none")}
                    >
                      {status === "Want To Watch" ? "On watchlist" : "Watching"}
                    </Button>
                  )}
                  {released && (
                    <Button disabled={update.isPending} onClick={() => setStatus("Watched")}>
                      Mark watched
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function SortableRankRow({ movie, rank }: { movie: Movie; rank: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: movie.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 pl-2.5 bg-neutral-950 border border-neutral-800 hover:border-neutral-700 rounded-control"
    >
      <span className="w-6 shrink-0 text-title font-semibold text-neutral-300 text-center tabular">
        {rank}
      </span>
      {movie.poster_path ? (
        <img
          src={`${BASE_IMAGE_URL}/w92${movie.poster_path}`}
          alt=""
          className="w-9 my-2 aspect-[2/3] object-cover rounded-md shrink-0"
        />
      ) : (
        <div className="w-9 my-2 aspect-[2/3] rounded-md bg-neutral-800 shrink-0" />
      )}
      <span className="flex-1 min-w-0 text-body font-medium leading-snug text-neutral-100 line-clamp-2">{movie.title}</span>
      <IconButton
        {...attributes}
        {...listeners}
        label={`Move ${movie.title}`}
        icon={<Bars3Icon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
        size="touch"
        shape="square"
        className="cursor-grab active:cursor-grabbing touch-none"
      />
    </li>
  );
}
