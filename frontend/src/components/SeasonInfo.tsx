import { BASE_IMAGE_URL } from "../constants";
import { Season, Episode } from "../types/calendar";
import { useState } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import { apiFetch } from "../utils/apiFetch";
import { Link } from "react-router-dom";
import {
  useWatchedEpisodes,
  useToggleEpisode,
  useToggleSeason,
} from "../hooks/api/useEpisodes";

type FullSeason = Season & { episodes?: Episode[] };

interface SeasonInfoProps {
  showId: number;
  seasons: Season[];
  onEpisodeToggle?: () => void;
}

function getEpisodeTag(
  episodeType: string | null | undefined,
): { label: string; classes: string } | null {
  switch (episodeType) {
    case "show_premiere":
      return {
        label: "Series Premiere",
        classes:
          "bg-highlight-600/20 text-highlight-300 border border-highlight-500/40",
      };
    case "season_premiere":
      return {
        label: "Season Premiere",
        classes:
          "bg-primary-600/20 text-primary-300 border border-primary-500/40",
      };
    case "season_finale":
      return {
        label: "Season Finale",
        classes:
          "bg-warning-600/20 text-warning-300 border border-warning-500/40",
      };
    case "series_finale":
      return {
        label: "Series Finale",
        classes: "bg-error-700/20 text-error-300 border border-error-500/40",
      };
    case "mid_season":
      return {
        label: "Mid-Season Finale",
        classes:
          "bg-warning-600/20 text-warning-300 border border-warning-500/40",
      };
    default:
      return null;
  }
}

function epKey(seasonNumber: number, episodeNumber: number) {
  return `${seasonNumber}_${episodeNumber}`;
}

export default function SeasonInfo({
  showId,
  seasons,
  onEpisodeToggle,
}: SeasonInfoProps) {
  const user = useAuthUser();

  const [expandedSeasons, setExpandedSeasons] = useState<
    Record<number, FullSeason | null>
  >({});
  const [loadingSeasons, setLoadingSeasons] = useState<Record<number, boolean>>(
    {},
  );

  const { data: watchedEpisodesData } = useWatchedEpisodes(showId);
  const rawEpisodes = (watchedEpisodesData as { season_number: number; episode_number: number }[] | undefined) ?? [];
  const watchedEpisodes = new Set(rawEpisodes.map((e) => epKey(e.season_number, e.episode_number)));

  const toggleEpisodeMutation = useToggleEpisode();
  const toggleSeasonMutation = useToggleSeason();

  const [togglingEpisodes, setTogglingEpisodes] = useState<Set<string>>(new Set());
  const [togglingSeasons, setTogglingSeasons] = useState<Set<number>>(new Set());

  const isLoggedIn = !!user;

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
      alert("Failed to fetch season info");
    } finally {
      setLoadingSeasons((prev) => ({ ...prev, [season.season_number]: false }));
    }
  };

  const toggleEpisodeWatched = async (
    seasonNumber: number,
    episodeNumber: number,
  ) => {
    if (!user) return;
    const key = epKey(seasonNumber, episodeNumber);
    const watched = watchedEpisodes.has(key);
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
  };

  const toggleSeasonWatched = async (season: Season, allWatched: boolean) => {
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
  };

  return (
    <div className="mt-6">
      <h2 className="text-2xl font-semibold mb-2">Seasons</h2>
      <div className="flex flex-col gap-4">
        {seasons.map((season: Season) => {
          const expandedSeason = expandedSeasons[season.season_number];
          const loadingSeason = loadingSeasons[season.season_number];
          const seasonToggling = togglingSeasons.has(season.season_number);

          const watchedCount = Array.from(watchedEpisodes).filter((key) => {
            const [s] = key.split("_").map(Number);
            return s === season.season_number;
          }).length;
          const totalCount = season.episode_count;
          const allWatched = totalCount > 0 && watchedCount === totalCount;

          return (
            <div
              key={season.id}
              className="border border-neutral-700 rounded-md p-2"
            >
              <div className="flex items-start gap-3">
                {season.poster_path && (
                  <img
                    src={`${BASE_IMAGE_URL}/w342${season.poster_path}`}
                    alt={season.name}
                    className="w-16 sm:w-24 flex-shrink-0 h-auto rounded-md object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold">{season.name}</h3>
                  <p className="text-neutral-400 text-sm">
                    {season.air_date
                      ? new Date(
                          season.air_date + "T00:00:00",
                        ).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "No date"}{" "}
                    · {season.episode_count} eps
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
                <div className="flex items-center gap-2 flex-shrink-0">
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
                          const key = epKey(
                            ep.season_number,
                            ep.episode_number,
                          );
                          const watched = watchedEpisodes.has(key);
                          const toggling = togglingEpisodes.has(key);

                          return (
                            <div key={ep.id} className="flex gap-3 items-start">
                              <Link
                                to={`/tv/${showId}/episode/${ep.season_number}/${ep.episode_number}`}
                                className="flex gap-3 items-start flex-1 min-w-0 hover:opacity-90 transition-opacity"
                              >
                                {ep.still_path ? (
                                  <div className="relative flex-shrink-0">
                                    <img
                                      src={`${BASE_IMAGE_URL}/w500${ep.still_path}`}
                                      alt={ep.name}
                                      className="w-28 sm:w-40 h-auto rounded-md object-cover"
                                    />
                                    {(() => {
                                      const tag = getEpisodeTag(
                                        (ep as any).episode_type,
                                      );
                                      return tag ? (
                                        <span
                                          className={`absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded backdrop-blur-sm ${tag.classes}`}
                                        >
                                          {tag.label}
                                        </span>
                                      ) : null;
                                    })()}
                                  </div>
                                ) : null}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <p className="font-medium text-neutral-100 hover:text-primary-300 transition-colors">
                                      {ep.episode_number}. {ep.name}
                                    </p>
                                    {(() => {
                                      const tag = getEpisodeTag(
                                        (ep as any).episode_type,
                                      );
                                      return tag ? (
                                        <span
                                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tag.classes}`}
                                        >
                                          {tag.label}
                                        </span>
                                      ) : null;
                                    })()}
                                  </div>
                                  <p className="text-neutral-400 text-sm">
                                    {ep.air_date
                                      ? new Date(
                                          ep.air_date + "T00:00:00",
                                        ).toLocaleDateString(undefined, {
                                          year: "numeric",
                                          month: "long",
                                          day: "numeric",
                                        })
                                      : "N/A"}{" "}
                                    | Runtime:{" "}
                                    {ep.runtime ? (
                                      <>
                                        {Math.floor(ep.runtime / 60) > 0 &&
                                          `${Math.floor(ep.runtime / 60)}h `}
                                        {ep.runtime % 60 > 0 &&
                                          `${ep.runtime % 60}m`}
                                      </>
                                    ) : (
                                      "N/A"
                                    )}
                                  </p>
                                  <p className="text-sm text-neutral-300 mt-1">
                                    {ep.overview}
                                  </p>
                                </div>
                              </Link>
                              {isLoggedIn && (
                                <button
                                  onClick={() =>
                                    toggleEpisodeWatched(
                                      ep.season_number,
                                      ep.episode_number,
                                    )
                                  }
                                  disabled={toggling}
                                  title={
                                    watched
                                      ? "Mark as unwatched"
                                      : "Mark as watched"
                                  }
                                  className={`flex-shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 disabled:opacity-50 ${
                                    watched
                                      ? "bg-success-700/40 border border-success-600/60 text-success-400 hover:bg-error-900/30 hover:border-error-600/40 hover:text-error-400"
                                      : "bg-neutral-700 border border-neutral-600 text-neutral-400 hover:bg-success-900/30 hover:border-success-600/40 hover:text-success-400"
                                  }`}
                                >
                                  {toggling ? (
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
                                  ) : watched ? (
                                    <svg
                                      className="w-4 h-4"
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
                                      className="w-4 h-4"
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
                                </button>
                              )}
                            </div>
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
