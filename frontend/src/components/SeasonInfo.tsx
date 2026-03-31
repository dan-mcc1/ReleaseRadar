import { API_URL, BASE_IMAGE_URL } from "../constants";
import { Season, Episode } from "../types/calendar";
import { useState, useEffect, useRef } from "react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { Link } from "react-router-dom";

type FullSeason = Season & { episodes?: Episode[] };

interface SeasonInfoProps {
  showId: number;
  seasons: Season[];
  refreshKey?: number;
}

function getEpisodeTag(
  episodeType: string | null | undefined,
): { label: string; classes: string } | null {
  switch (episodeType) {
    case "show_premiere":
      return {
        label: "Series Premiere",
        classes: "bg-purple-600/20 text-purple-300 border border-purple-500/40",
      };
    case "season_premiere":
      return {
        label: "Season Premiere",
        classes: "bg-blue-600/20 text-blue-300 border border-blue-500/40",
      };
    case "season_finale":
      return {
        label: "Season Finale",
        classes: "bg-orange-600/20 text-orange-300 border border-orange-500/40",
      };
    case "series_finale":
      return {
        label: "Series Finale",
        classes: "bg-red-700/20 text-red-300 border border-red-500/40",
      };
    case "mid_season":
      return {
        label: "Mid-Season Finale",
        classes: "bg-yellow-600/20 text-yellow-300 border border-yellow-500/40",
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
  refreshKey,
}: SeasonInfoProps) {
  const auth = getAuth(firebaseApp);

  const [expandedSeasons, setExpandedSeasons] = useState<
    Record<number, FullSeason | null>
  >({});
  const [loadingSeasons, setLoadingSeasons] = useState<Record<number, boolean>>(
    {},
  );

  // Set of "season_episode" keys for watched episodes
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(
    new Set(),
  );
  const [togglingEpisodes, setTogglingEpisodes] = useState<Set<string>>(
    new Set(),
  );
  const [togglingSeasons, setTogglingSeasons] = useState<Set<number>>(
    new Set(),
  );
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const authUserRef = useRef<{ getIdToken: () => Promise<string> } | null>(
    null,
  );

  async function fetchWatchedEpisodes(user: {
    getIdToken: () => Promise<string>;
  }) {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/watched-episode/${showId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: { season_number: number; episode_number: number }[] =
        await res.json();
      setWatchedEpisodes(
        new Set(data.map((e) => epKey(e.season_number, e.episode_number))),
      );
    } catch (err) {
      console.error("Failed to load watched episodes", err);
    }
  }

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      authUserRef.current = user;
      if (!user) {
        setIsLoggedIn(false);
        setWatchedEpisodes(new Set());
        return;
      }
      setIsLoggedIn(true);
      fetchWatchedEpisodes(user);
    });
    return unsubscribe;
  }, [showId]);

  useEffect(() => {
    if (refreshKey === undefined || refreshKey === 0) return;
    if (authUserRef.current) fetchWatchedEpisodes(authUserRef.current);
  }, [refreshKey]);

  const toggleSeason = async (season: Season) => {
    if (expandedSeasons[season.season_number]) {
      setExpandedSeasons((prev) => ({ ...prev, [season.season_number]: null }));
      return;
    }
    try {
      setLoadingSeasons((prev) => ({ ...prev, [season.season_number]: true }));
      const res = await fetch(
        `${API_URL}/tv/${showId}/season/${season.season_number}/info`,
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
    const user = auth.currentUser;
    if (!user) return;

    const key = epKey(seasonNumber, episodeNumber);
    const alreadyWatched = watchedEpisodes.has(key);

    setTogglingEpisodes((prev) => new Set(prev).add(key));
    // Optimistic update
    setWatchedEpisodes((prev) => {
      const next = new Set(prev);
      if (alreadyWatched) next.delete(key);
      else next.add(key);
      return next;
    });

    try {
      const token = await user.getIdToken();
      const url = alreadyWatched
        ? `${API_URL}/watched-episode/remove`
        : `${API_URL}/watched-episode/add`;
      const method = alreadyWatched ? "DELETE" : "POST";
      const res = await fetch(
        `${url}?show_id=${showId}&season_number=${seasonNumber}&episode_number=${episodeNumber}`,
        { method, headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("Request failed");
    } catch (err) {
      console.error(err);
      // Revert optimistic update on failure
      setWatchedEpisodes((prev) => {
        const next = new Set(prev);
        if (alreadyWatched) next.add(key);
        else next.delete(key);
        return next;
      });
    } finally {
      setTogglingEpisodes((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const toggleSeasonWatched = async (season: Season, allWatched: boolean) => {
    const user = auth.currentUser;
    if (!user) return;

    setTogglingSeasons((prev) => new Set(prev).add(season.season_number));
    try {
      const token = await user.getIdToken();
      const url = allWatched
        ? `${API_URL}/watched-episode/season/remove`
        : `${API_URL}/watched-episode/season/add`;
      const method = allWatched ? "DELETE" : "POST";
      const res = await fetch(
        `${url}?show_id=${showId}&season_number=${season.season_number}`,
        { method, headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("Request failed");
      await fetchWatchedEpisodes(user);
    } catch (err) {
      console.error(err);
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

          // Count how many episodes in this season are watched
          const watchedCount = Array.from(watchedEpisodes).filter((key) => {
            const [s] = key.split("_").map(Number);
            return s === season.season_number;
          }).length;
          const totalCount = season.episode_count;
          const allWatched = totalCount > 0 && watchedCount === totalCount;

          return (
            <div
              key={season.id}
              className="border border-slate-700 rounded-md p-2"
            >
              <div className="flex items-start gap-4">
                {season.poster_path && (
                  <img
                    src={`${BASE_IMAGE_URL}/w154${season.poster_path}`}
                    alt={season.name}
                    className="w-24 h-auto rounded-md object-cover"
                  />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold">{season.name}</h3>
                  <p className="text-slate-400 text-sm">
                    Air date:{" "}
                    {season.air_date
                      ? new Date(
                          season.air_date + "T00:00:00",
                        ).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "N/A"}{" "}
                    | Episodes: {season.episode_count}
                  </p>
                  {isLoggedIn && totalCount > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 max-w-[120px] h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${(watchedCount / totalCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">
                        {watchedCount}/{totalCount}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {isLoggedIn && (
                    <button
                      onClick={() => toggleSeasonWatched(season, allWatched)}
                      disabled={seasonToggling}
                      title={
                        allWatched ? "Unwatch season" : "Mark season as watched"
                      }
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-50 ${
                        allWatched
                          ? "bg-green-700/40 border border-green-600/60 text-green-400 hover:bg-red-900/30 hover:border-red-600/40 hover:text-red-400"
                          : "bg-slate-700 border border-slate-600 text-slate-400 hover:bg-green-900/30 hover:border-green-600/40 hover:text-green-400"
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
                    className="text-slate-400 hover:text-slate-200 focus:outline-none"
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
                <div className="mt-4 pl-2 border-t border-slate-700">
                  {expandedSeason.overview && (
                    <p className="mb-3 mt-2 text-slate-300 text-sm">
                      {expandedSeason.overview}
                    </p>
                  )}
                  {expandedSeason.episodes &&
                    expandedSeason.episodes.length === 0 && (
                      <p className="text-slate-500 text-sm mt-2">
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
                                      src={`${BASE_IMAGE_URL}/w300${ep.still_path}`}
                                      alt={ep.name}
                                      className="w-40 h-auto rounded-md object-cover"
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
                                    <p className="font-medium text-slate-100 hover:text-blue-300 transition-colors">
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
                                  <p className="text-slate-400 text-sm">
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
                                  <p className="text-sm text-slate-300 mt-1">
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
                                      ? "bg-green-700/40 border border-green-600/60 text-green-400 hover:bg-red-900/30 hover:border-red-600/40 hover:text-red-400"
                                      : "bg-slate-700 border border-slate-600 text-slate-400 hover:bg-green-900/30 hover:border-green-600/40 hover:text-green-400"
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
