import { useParams, Link } from "react-router-dom";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { queryFetch } from "../hooks/api/queryFetch";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  useWatchedEpisodes,
  useToggleEpisode,
  useToggleSeason,
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
import { useToast } from "../components/Toast";
import { Button, ButtonLink, CheckIcon, ChevronLeftIcon, PageHeader, SectionHeader } from "../components/ui";
import type { Episode } from "../types/calendar";

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
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SeasonInfoPage() {
  const { showId, seasonNumber } = useParams<{
    showId: string;
    seasonNumber: string;
  }>();
  const showIdNum = Number(showId ?? 0);
  const seasonNum = Number(seasonNumber ?? 0);

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
    enabled: showIdNum > 0 && seasonNum > 0,
  });

  usePageTitle(
    showQuery.data
      ? `${showQuery.data.name} · Season ${seasonNum}`
      : "Season",
  );

  const { data: watchedEpisodesData } = useWatchedEpisodes(showIdNum);
  const rawWatched =
    (watchedEpisodesData as
      | { season_number: number; episode_number: number }[]
      | undefined) ?? [];

  const { watchedSet, lastWatched } = useMemo(() => {
    const set = new Set<string>();
    let last: { s: number; e: number } | null = null;
    for (const e of rawWatched) {
      set.add(epKey(e.season_number, e.episode_number));
      if (
        !last ||
        e.season_number > last.s ||
        (e.season_number === last.s && e.episode_number > last.e)
      ) {
        last = { s: e.season_number, e: e.episode_number };
      }
    }
    return { watchedSet: set, lastWatched: last };
  }, [rawWatched]);

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

  if (seasonQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (seasonQuery.isError || !seasonQuery.data) {
    return (
      <div className="w-full max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-error-400 text-title">
          {seasonQuery.error?.message ?? "Season not found."}
        </p>
        {showIdNum > 0 && (
          <ButtonLink to={`/tv/${showIdNum}`} icon={<ChevronLeftIcon />} className="mt-4">
            Back to show
          </ButtonLink>
        )}
      </div>
    );
  }

  const season = seasonQuery.data;
  const startStr = formatDate(season.air_date);
  const endStr = formatDate(endDate);
  const dateRange =
    startStr && endStr && startStr !== endStr
      ? `${startStr} – ${endStr}`
      : startStr ?? "No date";

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
            <span className="text-neutral-600">/</span>
          </>
        )}
        <span className="text-neutral-200 font-medium">
          {season.name || `Season ${season.season_number}`}
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
            title={season.name || `Season ${season.season_number}`}
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
            </div>
          )}

          {/* Rating */}
          {(isLoggedIn || (aggregate && aggregate.count > 0)) && (
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
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
