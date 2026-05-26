import { BASE_IMAGE_URL } from "../constants";
import { Season, Episode } from "../types/calendar";
import { memo, useState, useMemo, useCallback, useRef } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import { apiFetch } from "../utils/apiFetch";
import { Link } from "react-router-dom";
import {
  useWatchedEpisodes,
  useToggleEpisode,
  useToggleSeason,
} from "../hooks/api/useEpisodes";
import { useNotificationPrefs } from "../hooks/api/useNotifications";
import {
  useMySeasonRating,
  useUpsertSeasonRating,
  useDeleteSeasonRating,
} from "../hooks/api/useSeasonRating";
import StarRating from "./StarRating";
import EpisodeRow, { epKey } from "./EpisodeRow";
import { useToast } from "./Toast";

type FullSeason = Season & { episodes?: Episode[] };

interface SeasonInfoProps {
  showId: number;
  seasons: Season[];
  onEpisodeToggle?: () => void;
}

function formatSeasonDateRange(
  airDate: string | null | undefined,
  endDate: string | null | undefined,
): string {
  const fmt = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  if (airDate && endDate && airDate !== endDate) {
    return `${fmt(airDate)} – ${fmt(endDate)}`;
  }
  if (airDate) return fmt(airDate);
  return "No date";
}

interface SeasonRatingBlockProps {
  showId: number;
  seasonNumber: number;
  enabled: boolean;
}

const SeasonRatingBlock = memo(function SeasonRatingBlock({
  showId,
  seasonNumber,
  enabled,
}: SeasonRatingBlockProps) {
  const { data: myRating } = useMySeasonRating(showId, seasonNumber);
  const upsert = useUpsertSeasonRating();
  const remove = useDeleteSeasonRating();
  const toast = useToast();

  const handleRate = async (next: number | null) => {
    try {
      if (next === null) {
        await remove.mutateAsync({ showId, seasonNumber });
      } else {
        await upsert.mutateAsync({ showId, seasonNumber, rating: next });
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to save rating");
    }
  };

  const saving = upsert.isPending || remove.isPending;

  if (!enabled) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <StarRating
        rating={myRating?.rating ?? null}
        onRate={handleRate}
        saving={saving}
      />
    </div>
  );
});

export default function SeasonInfo({
  showId,
  seasons,
  onEpisodeToggle,
}: SeasonInfoProps) {
  const user = useAuthUser();
  const toast = useToast();

  const [expandedSeasons, setExpandedSeasons] = useState<
    Record<number, FullSeason | null>
  >({});
  const [loadingSeasons, setLoadingSeasons] = useState<Record<number, boolean>>(
    {},
  );

  const { data: watchedEpisodesData } = useWatchedEpisodes(showId);
  const rawEpisodes =
    (watchedEpisodesData as
      | { season_number: number; episode_number: number }[]
      | undefined) ?? [];
  const { watchedEpisodes, watchedCountBySeason, lastWatched } = useMemo(() => {
    const set = new Set<string>();
    const countMap = new Map<number, number>();
    let last: { s: number; e: number } | null = null;
    for (const e of rawEpisodes) {
      set.add(epKey(e.season_number, e.episode_number));
      countMap.set(e.season_number, (countMap.get(e.season_number) ?? 0) + 1);
      if (
        !last ||
        e.season_number > last.s ||
        (e.season_number === last.s && e.episode_number > last.e)
      ) {
        last = { s: e.season_number, e: e.episode_number };
      }
    }
    return { watchedEpisodes: set, watchedCountBySeason: countMap, lastWatched: last };
  }, [rawEpisodes]);

  const { data: prefs } = useNotificationPrefs();
  const hideSpoilers = prefs?.hide_spoilers ?? true;

  // The very next episode after lastWatched is exempt from spoiler hiding —
  // the user is about to watch it next anyway. Crosses a season boundary
  // when lastWatched was the finale of its season.
  const nextUpKey = useMemo<string | null>(() => {
    if (!lastWatched) return null;
    const lastSeason = seasons.find((s) => s.season_number === lastWatched.s);
    if (lastSeason && lastWatched.e < lastSeason.episode_count) {
      return epKey(lastWatched.s, lastWatched.e + 1);
    }
    return epKey(lastWatched.s + 1, 1);
  }, [lastWatched, seasons]);

  const toggleEpisodeMutation = useToggleEpisode();
  const toggleSeasonMutation = useToggleSeason();

  const [togglingEpisodes, setTogglingEpisodes] = useState<Set<string>>(
    new Set(),
  );
  const [togglingSeasons, setTogglingSeasons] = useState<Set<number>>(
    new Set(),
  );

  const isLoggedIn = !!user;

  // Ref so toggleEpisodeWatched stays stable without watchedEpisodes in its dep array
  const watchedEpisodesRef = useRef(watchedEpisodes);
  watchedEpisodesRef.current = watchedEpisodes;

  const toggleSeason = async (season: Season) => {
    if (expandedSeasons[season.season_number]) {
      setExpandedSeasons((prev) => ({ ...prev, [season.season_number]: null }));
      return;
    }
    try {
      setLoadingSeasons((prev) => ({ ...prev, [season.season_number]: true }));
      const res = await apiFetch(
        `/tv/${showId}/season/${season.season_number}/info`,
      );
      if (!res.ok) throw new Error("Failed to fetch season info");
      const data: FullSeason = await res.json();
      setExpandedSeasons((prev) => ({ ...prev, [season.season_number]: data }));
    } catch (err) {
      console.error(err);
      toast.error("Failed to fetch season info");
    } finally {
      setLoadingSeasons((prev) => ({ ...prev, [season.season_number]: false }));
    }
  };

  const toggleEpisodeWatched = useCallback(
    async (seasonNumber: number, episodeNumber: number) => {
      if (!user) return;
      const key = epKey(seasonNumber, episodeNumber);
      const watched = watchedEpisodesRef.current.has(key);
      setTogglingEpisodes((prev) => new Set(prev).add(key));
      try {
        await toggleEpisodeMutation.mutateAsync({
          showId,
          seasonNumber,
          episodeNumber,
          watched,
        });
        onEpisodeToggle?.();
      } finally {
        setTogglingEpisodes((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [user, toggleEpisodeMutation, showId, onEpisodeToggle],
  );

  const toggleSeasonWatched = useCallback(
    async (season: Season, allWatched: boolean) => {
      if (!user) return;
      setTogglingSeasons((prev) => new Set(prev).add(season.season_number));
      try {
        await toggleSeasonMutation.mutateAsync({
          showId,
          seasonNumber: season.season_number,
          allWatched,
        });
        onEpisodeToggle?.();
      } finally {
        setTogglingSeasons((prev) => {
          const next = new Set(prev);
          next.delete(season.season_number);
          return next;
        });
      }
    },
    [user, toggleSeasonMutation, showId, onEpisodeToggle],
  );

  return (
    <div className="mt-6">
      <h2 className="text-2xl font-semibold mb-2">Seasons</h2>
      <div className="flex flex-col gap-4">
        {seasons.map((season: Season) => {
          const expandedSeason = expandedSeasons[season.season_number];
          const loadingSeason = loadingSeasons[season.season_number];
          const seasonToggling = togglingSeasons.has(season.season_number);

          const watchedCount = watchedCountBySeason.get(season.season_number) ?? 0;
          const totalCount = season.episode_count;
          const allWatched = totalCount > 0 && watchedCount === totalCount;

          return (
            <div
              key={season.id}
              className="border border-neutral-700 rounded-md p-2"
            >
              <div className="flex items-start gap-3">
                {season.poster_path && (
                  <Link
                    to={`/tv/${showId}/season/${season.season_number}`}
                    className="flex-shrink-0 hover:opacity-90 transition-opacity"
                  >
                    <img
                      src={`${BASE_IMAGE_URL}/w342${season.poster_path}`}
                      alt={season.name}
                      className="w-16 sm:w-24 h-auto rounded-md object-cover"
                    />
                  </Link>
                )}
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/tv/${showId}/season/${season.season_number}`}
                    className="font-semibold hover:text-primary-300 transition-colors"
                  >
                    {season.name}
                  </Link>
                  <p className="text-neutral-400 text-sm">
                    {formatSeasonDateRange(season.air_date, season.end_date)} ·{" "}
                    {season.episode_count} eps
                  </p>
                  {isLoggedIn && totalCount > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 max-w-[120px] h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-success-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${(watchedCount / totalCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-neutral-400">
                        {watchedCount}/{totalCount}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                  {isLoggedIn && (
                    <button
                      onClick={() => toggleSeasonWatched(season, allWatched)}
                      disabled={seasonToggling}
                      title={
                        allWatched ? "Unwatch season" : "Mark season as watched"
                      }
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-50 ${
                        allWatched
                          ? "bg-success-700/40 border border-success-600/60 text-success-400 hover:bg-error-900/30 hover:border-error-600/40 hover:text-error-400"
                          : "bg-neutral-700 border border-neutral-600 text-neutral-400 hover:bg-success-900/30 hover:border-success-600/40 hover:text-success-400"
                      }`}
                    >
                      {seasonToggling ? (
                        <svg
                          className="w-3.5 h-3.5 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      ) : allWatched ? (
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <circle cx="12" cy="12" r="9" />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                      {allWatched ? "Watched" : "Mark watched"}
                    </button>
                  )}
                  <button
                    onClick={() => toggleSeason(season)}
                    className="text-neutral-400 hover:text-neutral-200 focus:outline-none"
                    title={expandedSeason ? "Collapse" : "Expand"}
                  >
                    {loadingSeason ? (
                      <svg
                        className="w-4 h-4 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <span
                        className={`transition-transform inline-block ${expandedSeason ? "rotate-180" : ""}`}
                      >
                        ▼
                      </span>
                    )}
                  </button>
                  </div>
                  <SeasonRatingBlock
                    showId={showId}
                    seasonNumber={season.season_number}
                    enabled={isLoggedIn && allWatched}
                  />
                </div>
              </div>

              {/* Expanded season info */}
              {expandedSeason && (
                <div className="mt-4 pl-2 border-t border-neutral-700">
                  {expandedSeason.overview && (
                    <p className="mb-3 mt-2 text-neutral-300 text-sm">
                      {expandedSeason.overview}
                    </p>
                  )}
                  {expandedSeason.episodes &&
                    expandedSeason.episodes.length === 0 && (
                      <p className="text-neutral-500 text-sm mt-2">
                        No episodes available yet.
                      </p>
                    )}
                  {expandedSeason.episodes &&
                    expandedSeason.episodes.length > 0 && (
                      <div className="flex flex-col gap-3 mt-2">
                        {expandedSeason.episodes.map((ep) => {
                          const key = epKey(ep.season_number, ep.episode_number);
                          const isFuture =
                            !!lastWatched &&
                            (ep.season_number > lastWatched.s ||
                              (ep.season_number === lastWatched.s &&
                                ep.episode_number > lastWatched.e));
                          const hideOverview =
                            hideSpoilers &&
                            isLoggedIn &&
                            !watchedEpisodes.has(key) &&
                            isFuture &&
                            key !== nextUpKey;
                          return (
                            <EpisodeRow
                              key={ep.id}
                              episode={ep}
                              showId={showId}
                              isWatched={watchedEpisodes.has(key)}
                              isToggling={togglingEpisodes.has(key)}
                              isLoggedIn={isLoggedIn}
                              hideOverview={hideOverview}
                              onToggle={toggleEpisodeWatched}
                            />
                          );
                        })}
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
