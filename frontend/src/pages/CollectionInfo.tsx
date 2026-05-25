import { useParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import type { Movie } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import MediaList from "../components/MediaList";
import FavoriteButton from "../components/FavoriteButton";
import StarIcon from "../components/icons/StarIcon";
import { useAuthUser } from "../hooks/useAuthUser";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import {
  useCollectionInfo,
  useCollectionStats,
  useCollectionRanking,
  useSetCollectionRanking,
} from "../hooks/api/useCollectionInfo";
import { useMemo, useState } from "react";
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
  const [viewMode, setViewMode] = useState<"browse" | "rank">("browse");
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

  const progress = useMemo(() => {
    if (!user || sortedParts.length === 0) return null;
    let watched = 0;
    let watching = 0;
    let watchlisted = 0;
    for (const part of sortedParts) {
      const status = statusMap?.[`movie:${part.id}`]?.status;
      if (status === "Watched") watched++;
      else if (status === "Currently Watching") watching++;
      else if (status === "Want To Watch") watchlisted++;
    }
    const total = sortedParts.length;
    return {
      total,
      watched,
      watching,
      watchlisted,
      unseen: total - watched - watching - watchlisted,
      pct: total === 0 ? 0 : Math.round((watched / total) * 100),
    };
  }, [user, sortedParts, statusMap]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">Loading collection…</p>
        </div>
      </div>
    );
  if (error) return <p className="text-error-400 p-6">{error?.message}</p>;
  if (!rawCollection)
    return <p className="text-neutral-400 p-6">Collection not found.</p>;

  const collection = {
    ...rawCollection,
    parts: sortedParts,
  };

  const yearRange =
    stats?.min_year != null && stats?.max_year != null
      ? stats.min_year === stats.max_year
        ? String(stats.min_year)
        : `${stats.min_year}–${stats.max_year}`
      : null;

  const topGenres = (stats?.genres ?? []).slice(0, 3).map((g) => g.name);

  return (
    <div className="pb-16 w-full overflow-x-clip">
      {/* Hero */}
      <div className="relative h-[380px] md:h-[460px]">
        <div className="absolute inset-0 overflow-hidden">
          {collection.backdrop_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w1280${collection.backdrop_path}`}
              srcSet={`${BASE_IMAGE_URL}/w780${collection.backdrop_path} 780w, ${BASE_IMAGE_URL}/w1280${collection.backdrop_path} 1280w`}
              sizes="100vw"
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-[center_25%]"
              loading="eager"
              fetchPriority="high"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-neutral-950/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/80 via-neutral-950/30 to-transparent" />
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-6 sm:px-10 pb-8 flex items-end gap-8 z-10">
          {collection.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w342${collection.poster_path}`}
              alt={collection.name}
              className="hidden md:block w-32 lg:w-40 flex-shrink-0 rounded-xl shadow-2xl border border-white/10 self-end"
            />
          )}

          <div className="flex-1 min-w-0">
            <p className="text-white/55 text-[11px] font-mono tracking-[0.15em] uppercase mb-2">
              Collection
              {collection.parts.length > 0 &&
                ` · ${collection.parts.length} ${
                  collection.parts.length === 1 ? "film" : "films"
                }`}
            </p>

            <h1 className="text-4xl md:text-5xl font-bold text-white drop-shadow-lg mb-3">
              {collection.name}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75 mb-4">
              {stats?.avg_rating != null && (
                <span className="flex items-center gap-1.5">
                  <StarIcon filled className="w-3.5 h-3.5 text-yellow-400" />
                  {stats.avg_rating.toFixed(1)} avg
                </span>
              )}
              {yearRange && <span>{yearRange}</span>}
              {topGenres.length > 0 && <span>{topGenres.join(" · ")}</span>}
              {stats?.total_runtime != null && stats.total_runtime > 0 && (
                <span>{formatRuntime(stats.total_runtime)} total</span>
              )}
            </div>

            {user && (
              <div className="flex flex-wrap items-center gap-2">
                <FavoriteButton contentType="collection" contentId={collection.id} />
                {progress && progress.total > 0 && progress.watched === progress.total && (
                  <span className="inline-flex items-center gap-1.5 bg-success-500/15 border border-success-500/40 text-success-300 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Completed
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-10 mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10 min-w-0">
          {/* Left column: synopsis + films */}
          <div className="space-y-10 min-w-0">
            {collection.overview && (
              <p className="text-[1.25rem] leading-relaxed text-neutral-100 tracking-tight max-w-2xl font-light">
                {collection.overview}
              </p>
            )}

            {(stats?.genres?.length ?? 0) > 0 && (
              <div>
                <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-3">
                  Genres
                </div>
                <div className="flex flex-wrap gap-2">
                  {stats!.genres.map((g) => (
                    <span
                      key={g.id}
                      className="inline-flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 rounded-full px-3 py-1 text-xs text-neutral-200"
                    >
                      {g.name}
                      <span className="text-neutral-500 font-mono">
                        {g.count}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase">
                  {viewMode === "rank" ? "Your ranking" : "Films in this collection"}
                </div>
                {user && (
                  <div className="inline-flex rounded-lg border border-neutral-800 overflow-hidden text-xs font-medium">
                    <button
                      onClick={() => setViewMode("browse")}
                      className={`px-3 py-1.5 transition-colors ${
                        viewMode === "browse"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
                      }`}
                    >
                      Browse
                    </button>
                    <button
                      onClick={() => setViewMode("rank")}
                      className={`px-3 py-1.5 border-l border-neutral-800 transition-colors ${
                        viewMode === "rank"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
                      }`}
                    >
                      Rank
                    </button>
                  </div>
                )}
              </div>

              {viewMode === "browse" ? (
                <MediaList
                  results={{
                    movies: collection.parts,
                    shows: [],
                    people: [],
                  }}
                  paginated
                />
              ) : rankedWatched.length === 0 ? (
                <p className="text-sm text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-xl p-6 text-center">
                  Mark films in this collection as watched to start ranking them.
                </p>
              ) : (
                <>
                  <p className="text-xs text-neutral-500 mb-3">
                    Drag to reorder · only films you've watched appear here.
                  </p>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleRankDragEnd}
                  >
                    <SortableContext
                      items={rankedWatched.map((m) => m.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="flex flex-col gap-2">
                        {rankedWatched.map((m, i) => (
                          <SortableRankRow
                            key={m.id}
                            movie={m}
                            rank={i + 1}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </>
              )}
            </div>
          </div>

          {/* Right column: progress + key facts */}
          <div className="flex flex-col gap-4">
            {progress && progress.total > 0 && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase">
                    Your progress
                  </div>
                  {progress.watched === progress.total && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-success-400">
                      ★ Complete
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-3xl font-semibold text-white tabular-nums">
                    {progress.watched}
                  </span>
                  <span className="text-sm text-neutral-500">
                    of {progress.total} watched
                  </span>
                  <span className="ml-auto text-sm font-mono text-neutral-400 tabular-nums">
                    {progress.pct}%
                  </span>
                </div>

                <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      progress.watched === progress.total
                        ? "bg-success-500"
                        : "bg-primary-500"
                    }`}
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[11px] text-neutral-500 font-mono uppercase tracking-wider">
                      Watching
                    </div>
                    <div className="text-sm font-semibold text-primary-300 mt-0.5">
                      {progress.watching}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500 font-mono uppercase tracking-wider">
                      Watchlist
                    </div>
                    <div className="text-sm font-semibold text-neutral-200 mt-0.5">
                      {progress.watchlisted}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500 font-mono uppercase tracking-wider">
                      Untracked
                    </div>
                    <div className="text-sm font-semibold text-neutral-400 mt-0.5">
                      {progress.unseen}
                    </div>
                  </div>
                </div>

                {progress.watched === progress.total ? (
                  <p className="mt-3 text-[12.5px] text-success-300 leading-snug">
                    Nice — you've seen every film in this collection.
                  </p>
                ) : progress.watched === 0 ? (
                  <p className="mt-3 text-[12.5px] text-neutral-500 leading-snug">
                    You haven't watched any films in this collection yet.
                  </p>
                ) : (
                  <p className="mt-3 text-[12.5px] text-neutral-500 leading-snug">
                    {progress.total - progress.watched}{" "}
                    {progress.total - progress.watched === 1 ? "film" : "films"} left
                    to go.
                  </p>
                )}
              </div>
            )}

            {stats && stats.count > 0 && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 self-start">
              <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">
                Key facts
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                <span className="text-neutral-500">Films</span>
                <span className="font-medium">{stats.count}</span>

                {yearRange && (
                  <>
                    <span className="text-neutral-500">Years</span>
                    <span className="font-medium">{yearRange}</span>
                  </>
                )}
                {stats.total_runtime != null && stats.total_runtime > 0 && (
                  <>
                    <span className="text-neutral-500">Total runtime</span>
                    <span className="font-medium">
                      {formatRuntime(stats.total_runtime)}
                    </span>
                  </>
                )}
                {stats.avg_runtime != null && stats.avg_runtime > 0 && (
                  <>
                    <span className="text-neutral-500">Avg runtime</span>
                    <span className="font-medium">
                      {formatRuntime(Math.round(stats.avg_runtime))}
                    </span>
                  </>
                )}
                {stats.avg_rating != null && (
                  <>
                    <span className="text-neutral-500">Avg rating</span>
                    <span className="font-medium flex items-center gap-1">
                      <StarIcon filled className="w-3 h-3 text-yellow-400" />
                      {stats.avg_rating.toFixed(2)}
                    </span>
                  </>
                )}
                {stats.highest_rating != null && (
                  <>
                    <span className="text-neutral-500">Highest rated</span>
                    <span className="font-medium">
                      {stats.highest_rating.toFixed(1)}
                    </span>
                  </>
                )}
                {stats.lowest_rating != null && (
                  <>
                    <span className="text-neutral-500">Lowest rated</span>
                    <span className="font-medium">
                      {stats.lowest_rating.toFixed(1)}
                    </span>
                  </>
                )}
                {stats.total_budget != null && stats.total_budget > 0 && (
                  <>
                    <span className="text-neutral-500">Total budget</span>
                    <span className="font-medium">
                      {formatMoney(stats.total_budget)}
                    </span>
                  </>
                )}
                {stats.total_revenue != null && stats.total_revenue > 0 && (
                  <>
                    <span className="text-neutral-500">Total revenue</span>
                    <span className="font-medium text-success-400">
                      {formatMoney(stats.total_revenue)}
                    </span>
                  </>
                )}
                {stats.avg_budget != null && stats.avg_budget > 0 && (
                  <>
                    <span className="text-neutral-500">Avg budget</span>
                    <span className="font-medium">
                      {formatMoney(stats.avg_budget)}
                    </span>
                  </>
                )}
                {stats.avg_revenue != null && stats.avg_revenue > 0 && (
                  <>
                    <span className="text-neutral-500">Avg revenue</span>
                    <span className="font-medium">
                      {formatMoney(stats.avg_revenue)}
                    </span>
                  </>
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 sm:gap-4 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl px-3 sm:px-4 py-3"
    >
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        aria-label="Drag to reorder"
        className="text-neutral-600 hover:text-neutral-400 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
      </div>
      <span className="font-mono text-base sm:text-lg font-bold text-neutral-300 w-7 sm:w-8 text-right tabular-nums">
        #{rank}
      </span>
      {movie.poster_path ? (
        <img
          src={`${BASE_IMAGE_URL}/w92${movie.poster_path}`}
          alt={movie.title}
          className="w-10 sm:w-12 h-auto rounded shadow-sm flex-shrink-0"
        />
      ) : (
        <div className="w-10 sm:w-12 aspect-[2/3] rounded bg-neutral-800 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{movie.title}</p>
        {movie.release_date && (
          <p className="text-xs text-neutral-500 mt-0.5">
            {movie.release_date.slice(0, 4)}
          </p>
        )}
      </div>
    </div>
  );
}
