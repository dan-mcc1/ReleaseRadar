import { useParams, Link } from "react-router-dom";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { queryFetch } from "../hooks/api/queryFetch";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  useWatchedEpisodes,
  useEpisodeGaps,
  useToggleEpisode,
  useToggleSeason,
  useWatchThrough,
} from "../hooks/api/useEpisodes";
import { useNotificationPrefs } from "../hooks/api/useNotifications";
import {
  useMySeasonRating,
  useSeasonRatingAggregate,
  useUpsertSeasonRating,
  useDeleteSeasonRating,
} from "../hooks/api/useSeasonRating";
import EpisodeRow, { epKey } from "../components/EpisodeRow";
import StarRating from "../components/StarRating";
import WatchedTogetherButton from "../components/WatchedTogetherButton";
import { useToast } from "../components/Toast";
import {
  Button,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PageHeader,
  PageState,
  SectionHeader,
  cx,
  focusRing,
} from "../components/ui";
import type { Episode } from "../types/calendar";
import { formatAirDate, hasUnwatchedBefore, seasonLabel } from "../utils/episodes";

interface TmdbSeason {
  id: number;
  air_date: string | null;
  name: string;
  overview: string | null;
  poster_path: string | null;
  season_number: number;
  episodes: Episode[];
}

interface ShowSummary {
  id: number;
  name: string;
  in_production?: boolean | null;
  seasons?: { season_number: number; name?: string | null; episode_count: number }[];
}

function formatDate(iso: string | null | undefined): string | null {
  return iso ? formatAirDate(iso) : null;
}

export default function SeasonInfoPage() {
  const { showId, seasonNumber } = useParams<{
    showId: string;
    seasonNumber: string;
  }>();
  const showIdNum = Number(showId ?? 0);
  const seasonNum = Number(seasonNumber ?? "");
  // Season 0 is Specials, so 0 is a real season.
  const validParams =
    showIdNum > 0 && Number.isInteger(seasonNum) && seasonNum >= 0;

  const user = useAuthUser();
  const isLoggedIn = !!user;
  const toast = useToast();

  const showQuery = useQuery<ShowSummary>({
    queryKey: ["media", "tv", String(showIdNum)],
    queryFn: ({ signal }) =>
      queryFetch<ShowSummary>(`/tv/${showIdNum}`, { signal }),
    enabled: showIdNum > 0,
  });

  const seasonQuery = useQuery<TmdbSeason>({
    queryKey: ["season", "info", showIdNum, seasonNum],
    queryFn: ({ signal }) =>
      queryFetch<TmdbSeason>(
        `/tv/${showIdNum}/season/${seasonNum}/info`,
        { signal },
      ),
    enabled: validParams,
  });

  usePageTitle(
    showQuery.data
      ? `${showQuery.data.name} · ${seasonLabel(seasonNum, seasonQuery.data?.name)}`
      : "Season",
  );

  const { data: watchedEpisodesData } = useWatchedEpisodes(showIdNum);
  const { data: gaps } = useEpisodeGaps(showIdNum);
  const rawWatched =
    (watchedEpisodesData as
      | { season_number: number; episode_number: number }[]
      | undefined) ?? [];

  const { watchedSet, lastWatched, watchedCountBySeason } = useMemo(() => {
    const set = new Set<string>();
    const counts = new Map<number, number>();
    let last: { s: number; e: number } | null = null;
    for (const e of rawWatched) {
      set.add(epKey(e.season_number, e.episode_number));
      counts.set(e.season_number, (counts.get(e.season_number) ?? 0) + 1);
      if (
        !last ||
        e.season_number > last.s ||
        (e.season_number === last.s && e.episode_number > last.e)
      ) {
        last = { s: e.season_number, e: e.episode_number };
      }
    }
    return { watchedSet: set, lastWatched: last, watchedCountBySeason: counts };
  }, [rawWatched]);

  // Seasons in order, for the previous/next links and the series-finale tag.
  const showSeasons = useMemo(
    () =>
      [...(showQuery.data?.seasons ?? [])].sort(
        (a, b) => a.season_number - b.season_number,
      ),
    [showQuery.data?.seasons],
  );
  const seasonIndex = showSeasons.findIndex((s) => s.season_number === seasonNum);
  const prevSeason = seasonIndex > 0 ? showSeasons[seasonIndex - 1] : null;
  const nextSeason =
    seasonIndex >= 0 && seasonIndex < showSeasons.length - 1
      ? showSeasons[seasonIndex + 1]
      : null;
  const lastSeason = showSeasons.length
    ? showSeasons[showSeasons.length - 1].season_number
    : null;

  const { data: prefs } = useNotificationPrefs();
  const hideSpoilers = prefs?.hide_spoilers ?? true;

  const episodes = seasonQuery.data?.episodes ?? [];
  const totalCount = episodes.length;
  const watchedCount = useMemo(
    () =>
      episodes.reduce(
        (n, ep) =>
          watchedSet.has(epKey(ep.season_number, ep.episode_number)) ? n + 1 : n,
        0,
      ),
    [episodes, watchedSet],
  );
  const allWatched = totalCount > 0 && watchedCount === totalCount;

  const endDate = useMemo(() => {
    let max: string | null = null;
    for (const ep of episodes) {
      if (ep.air_date && (!max || ep.air_date > max)) max = ep.air_date;
    }
    return max;
  }, [episodes]);

  const nextUpKey = useMemo<string | null>(() => {
    if (!lastWatched) return null;
    if (lastWatched.s === seasonNum && lastWatched.e < totalCount) {
      return epKey(lastWatched.s, lastWatched.e + 1);
    }
    if (lastWatched.s + 1 === seasonNum) {
      return epKey(seasonNum, 1);
    }
    return null;
  }, [lastWatched, seasonNum, totalCount]);

  const toggleEpisodeMutation = useToggleEpisode();
  const toggleSeasonMutation = useToggleSeason();
  const watchThroughMutation = useWatchThrough();
  const [togglingEpisodes, setTogglingEpisodes] = useState<Set<string>>(
    new Set(),
  );
  const [togglingSeason, setTogglingSeason] = useState(false);

  const watchedRef = useRef(watchedSet);
  watchedRef.current = watchedSet;

  const onToggleEpisode = useCallback(
    async (sn: number, en: number) => {
      if (!user) return;
      const key = epKey(sn, en);
      const watched = watchedRef.current.has(key);
      setTogglingEpisodes((prev) => new Set(prev).add(key));
      try {
        await toggleEpisodeMutation.mutateAsync({
          showId: showIdNum,
          seasonNumber: sn,
          episodeNumber: en,
          watched,
        });
      } finally {
        setTogglingEpisodes((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [user, toggleEpisodeMutation, showIdNum],
  );

  const onWatchThrough = useCallback(
    async (sn: number, en: number) => {
      if (!user) return;
      const key = epKey(sn, en);
      setTogglingEpisodes((prev) => new Set(prev).add(key));
      try {
        const { added } = await watchThroughMutation.mutateAsync({
          showId: showIdNum,
          seasonNumber: sn,
          episodeNumber: en,
        });
        toast.success(`Marked ${added} episode${added === 1 ? "" : "s"} watched`);
      } catch (err) {
        console.error(err);
        toast.error("Couldn't mark those episodes. Try again.");
      } finally {
        setTogglingEpisodes((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [user, watchThroughMutation, showIdNum, toast],
  );

  const onToggleSeason = useCallback(async () => {
    if (!user) return;
    setTogglingSeason(true);
    try {
      await toggleSeasonMutation.mutateAsync({
        showId: showIdNum,
        seasonNumber: seasonNum,
        allWatched,
      });
    } finally {
      setTogglingSeason(false);
    }
  }, [user, toggleSeasonMutation, showIdNum, seasonNum, allWatched]);

  // Season rating
  const { data: myRating } = useMySeasonRating(showIdNum, seasonNum);
  const { data: aggregate } = useSeasonRatingAggregate(showIdNum, seasonNum);
  const upsertRating = useUpsertSeasonRating();
  const deleteRating = useDeleteSeasonRating();
  const savingRating = upsertRating.isPending || deleteRating.isPending;
  const handleRate = async (next: number | null) => {
    try {
      if (next === null) {
        await deleteRating.mutateAsync({
          showId: showIdNum,
          seasonNumber: seasonNum,
        });
      } else {
        await upsertRating.mutateAsync({
          showId: showIdNum,
          seasonNumber: seasonNum,
          rating: next,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to save rating");
    }
  };

  const backToShow =
    showIdNum > 0 ? { to: `/tv/${showIdNum}`, label: "Back to show" } : undefined;

  if (!validParams) {
    return <PageState status="error" subject="season" back={backToShow} />;
  }

  if (seasonQuery.isPending) {
    return <PageState status="loading" label="Loading season…" />;
  }

  if (seasonQuery.isError || !seasonQuery.data) {
    return (
      <PageState
        status="error"
        error={seasonQuery.error}
        subject="season"
        back={backToShow}
        onRetry={() => seasonQuery.refetch()}
      />
    );
  }

  const season = seasonQuery.data;
  const startStr = formatDate(season.air_date);
  const endStr = formatDate(endDate);
  const dateRange =
    startStr && endStr && startStr !== endStr
      ? `${startStr} – ${endStr}`
      : startStr ?? "Dates TBA";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Breadcrumb */}
      <div className="px-6 md:px-10 pt-6 pb-3 flex items-center gap-2.5 text-label flex-wrap">
        {showQuery.data && (
          <>
            <Link
              to={`/tv/${showIdNum}`}
              className="text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              {showQuery.data.name}
            </Link>
            <span className="text-neutral-500">/</span>
          </>
        )}
        <span className="text-neutral-200 font-medium">
          {seasonLabel(season.season_number, season.name)}
        </span>
      </div>

      {/* Header */}
      <div className="px-6 md:px-10 pb-6 flex flex-col sm:flex-row gap-6">
        {season.poster_path && (
          <img
            src={`${BASE_IMAGE_URL}/w342${season.poster_path}`}
            alt={season.name}
            className="w-40 sm:w-48 flex-shrink-0 h-auto rounded-surface object-cover self-start"
          />
        )}
        <div className="flex-1 min-w-0">
          <PageHeader
            title={seasonLabel(season.season_number, season.name)}
            description={`${dateRange} · ${totalCount} episode${totalCount === 1 ? "" : "s"}`}
            className="mb-3"
          />

          {isLoggedIn && totalCount > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 max-w-[200px] h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-success-500 rounded-full transition-all duration-300"
                  style={{ width: `${(watchedCount / totalCount) * 100}%` }}
                />
              </div>
              <span className="text-caption text-neutral-400 tabular">
                {watchedCount}/{totalCount}
              </span>
              <Button
                size="sm"
                onClick={onToggleSeason}
                disabled={togglingSeason}
                icon={allWatched ? <CheckIcon /> : undefined}
                className="ml-2"
              >
                {allWatched ? "Watched" : "Mark season watched"}
              </Button>
              <WatchedTogetherButton
                size="sm"
                target={{
                  contentType: "tv",
                  contentId: showIdNum,
                  seasonNumber: seasonNum,
                  label: `${showQuery.data?.name ?? "Show"} · ${seasonLabel(seasonNum, season.name)}`,
                }}
              />
            </div>
          )}

          {/* Rating. Specials can't be rated: ratings are per numbered season. */}
          {seasonNum > 0 && (isLoggedIn || (aggregate && aggregate.count > 0)) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
              {isLoggedIn && (
                <div className="flex items-center gap-2">
                  <span className="text-caption text-neutral-400">Your rating:</span>
                  <StarRating
                    rating={myRating?.rating ?? null}
                    onRate={handleRate}
                    saving={savingRating}
                  />
                </div>
              )}
              {aggregate && aggregate.count > 0 && (
                <span className="text-caption text-neutral-400">
                  Community: {aggregate.average?.toFixed(1)}/5 (
                  {aggregate.count} rating{aggregate.count === 1 ? "" : "s"})
                </span>
              )}
            </div>
          )}

          {season.overview && (
            <p className="text-neutral-300 leading-relaxed">{season.overview}</p>
          )}
        </div>
      </div>

      {/* Episodes */}
      <div className="px-6 md:px-10 pb-12">
        <SectionHeader title="Episodes" className="mb-4" />
        {episodes.length === 0 ? (
          <p className="text-neutral-500 text-sm">No episodes available yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {episodes.map((ep) => {
              const key = epKey(ep.season_number, ep.episode_number);
              const isFuture =
                !!lastWatched &&
                (ep.season_number > lastWatched.s ||
                  (ep.season_number === lastWatched.s &&
                    ep.episode_number > lastWatched.e));
              const hideOverview =
                hideSpoilers &&
                isLoggedIn &&
                !watchedSet.has(key) &&
                isFuture &&
                key !== nextUpKey;
              return (
                <EpisodeRow
                  key={ep.id}
                  episode={ep}
                  showId={showIdNum}
                  isWatched={watchedSet.has(key)}
                  isToggling={togglingEpisodes.has(key)}
                  isLoggedIn={isLoggedIn}
                  hideOverview={hideOverview}
                  onToggle={onToggleEpisode}
                  inProduction={showQuery.data?.in_production}
                  lastSeason={lastSeason}
                  canWatchThrough={
                    isLoggedIn &&
                    hasUnwatchedBefore(
                      ep,
                      episodes,
                      (sn, en) => watchedSet.has(epKey(sn, en)),
                      showSeasons,
                      watchedCountBySeason,
                      gaps,
                    )
                  }
                  onWatchThrough={onWatchThrough}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Previous / next season */}
      {(prevSeason || nextSeason) && (
        <nav aria-label="Seasons" className="px-6 md:px-10 pb-10">
          <div className="h-px w-full bg-neutral-800 mb-5" />
          <div className="grid grid-cols-2 gap-3.5">
            {prevSeason ? (
              <Link
                to={`/tv/${showIdNum}/season/${prevSeason.season_number}`}
                className={cx(
                  "flex items-center gap-4 p-4 rounded-surface border bg-neutral-900 border-neutral-800 hover:border-neutral-600 transition-colors",
                  focusRing,
                )}
              >
                <ChevronLeftIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-caption text-neutral-400 mb-1">Previous season</div>
                  <div className="text-title text-neutral-200 truncate">
                    {seasonLabel(prevSeason.season_number, prevSeason.name)}
                  </div>
                </div>
              </Link>
            ) : (
              <span />
            )}
            {nextSeason && (
              <Link
                to={`/tv/${showIdNum}/season/${nextSeason.season_number}`}
                className={cx(
                  "flex items-center gap-4 p-4 rounded-surface border bg-neutral-900 border-neutral-800 hover:border-neutral-600 text-right justify-end transition-colors",
                  focusRing,
                )}
              >
                <div className="min-w-0">
                  <div className="text-caption text-neutral-400 mb-1">Next season</div>
                  <div className="text-title text-neutral-200 truncate">
                    {seasonLabel(nextSeason.season_number, nextSeason.name)}
                  </div>
                </div>
                <ChevronRightIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
