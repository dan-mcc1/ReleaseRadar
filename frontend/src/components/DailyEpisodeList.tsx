import type { Episode, Movie, Show } from "../types/calendar";
import { BASE_IMAGE_URL } from "../constants";
import { Link } from "react-router-dom";

export type CalendarItem =
  | (Episode & { type: "tv"; showData: Show })
  | {
      id: number;
      title: string;
      poster_path: string | null;
      overview: string;
      release_date: string;
      bg_color?: string;
      showData: Movie;
      type: "movie";
      runtime: number;
    };

interface DailyItemListProps {
  dailyItems: CalendarItem[];
}

function RuntimeBadge({ minutes }: { minutes: number | null | undefined }) {
  if (!minutes) return <span className="text-neutral-500">Runtime N/A</span>;
  return (
    <span>
      {Math.floor(minutes / 60) > 0 && `${Math.floor(minutes / 60)}h `}
      {minutes % 60 > 0 && `${minutes % 60}m`}
    </span>
  );
}

function TypeBadge({ type }: { type: "tv" | "movie" }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        type === "tv"
          ? "bg-highlight-600/20 text-highlight-400 border border-highlight-600/30"
          : "bg-amber-600/20 text-amber-400 border border-amber-600/30"
      }`}
    >
      {type === "tv" ? "TV" : "Movie"}
    </span>
  );
}

export default function DailyEpisodeList({ dailyItems }: DailyItemListProps) {
  const showEpisodes = dailyItems.filter((e) => e.type === "tv") as (Episode & {
    type: "tv";
    showData: Show;
  })[];
  const movies = dailyItems.filter(
    (e) => e.type === "movie",
  ) as (CalendarItem & { type: "movie" })[];

  const episodesWithStill = showEpisodes.filter((e) => e.still_path);
  const episodesWithoutStill = showEpisodes.filter((e) => !e.still_path);

  const groupedByShow: Record<
    string,
    (Episode & { type: "tv"; showData: Show })[]
  > = {};
  episodesWithoutStill.forEach((episode) => {
    const showId = episode.showData?.id;
    if (!showId) return;
    if (!groupedByShow[showId]) groupedByShow[showId] = [];
    groupedByShow[showId].push(episode);
  });

  const TZ_ABBR: Record<string, string> = {
    "America/New_York": "ET",
    "America/Chicago": "CT",
    "America/Denver": "MT",
    "America/Los_Angeles": "PT",
    "America/Phoenix": "MT",
    "Europe/London": "GMT",
    "Europe/Paris": "CET",
    "Europe/Berlin": "CET",
    "Australia/Sydney": "AEST",
    "Australia/Melbourne": "AEST",
    "Asia/Tokyo": "JST",
  };

  function formatAirTime(
    time: string | null | undefined,
    timezone: string | null | undefined,
  ): string | null {
    if (!time) return null;
    const [hourStr, minuteStr] = time.split(":");
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    const period = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    const timeStr =
      minute > 0
        ? `${h12}:${String(minute).padStart(2, "0")} ${period}`
        : `${h12} ${period}`;
    const tzAbbr = timezone ? TZ_ABBR[timezone] : null;
    return tzAbbr ? `${timeStr} ${tzAbbr}` : timeStr;
  }

  const formatDate = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-us", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Episodes with their own still image */}
      {episodesWithStill.map((episode, idx) => (
        <Link
          key={`still-${idx}`}
          to={`/tv/${episode.showData.id}`}
          className="group flex gap-0 bg-neutral-800 rounded-xl overflow-hidden border border-neutral-700 hover:border-neutral-500 transition-all duration-200 hover:shadow-lg hover:shadow-black/30"
        >
          <div className="relative w-48 sm:w-56 flex-shrink-0 aspect-video">
            <img
              src={`${BASE_IMAGE_URL}/w500${episode.still_path}`}
              alt={episode.name}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-neutral-800/20" />
          </div>

          <div className="flex flex-col justify-center px-4 py-3 min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <TypeBadge type="tv" />
              <span className="text-neutral-500 text-xs">
                S{episode.season_number}E{episode.episode_number}
              </span>
            </div>
            <div className="font-semibold text-neutral-100 group-hover:text-primary-300 transition-colors line-clamp-1">
              {episode.showData?.name}
            </div>
            <div className="text-neutral-400 text-sm mt-0.5 line-clamp-1">
              {episode.name}
            </div>
            {episode.overview && (
              <p className="text-neutral-500 text-xs mt-1.5 line-clamp-2 hidden sm:block">
                {episode.overview}
              </p>
            )}
            <div className="flex items-center gap-3 text-neutral-500 text-xs mt-2">
              <span>{formatDate(episode.air_date)}</span>
              {formatAirTime(
                episode.showData?.air_time,
                episode.showData?.air_timezone,
              ) && (
                <>
                  <span>·</span>
                  <span>
                    {formatAirTime(
                      episode.showData?.air_time,
                      episode.showData?.air_timezone,
                    )}
                  </span>
                </>
              )}
              <span>·</span>
              <RuntimeBadge minutes={episode.runtime} />
            </div>
          </div>
        </Link>
      ))}

      {/* Grouped episodes without stills */}
      {Object.values(groupedByShow).map((episodes, idx) => {
        const show = episodes[0].showData;
        if (!show) return null;

        return (
          <Link
            key={`group-${idx}`}
            to={`/tv/${show.id}`}
            className="group flex gap-0 bg-neutral-800 rounded-xl overflow-hidden border border-neutral-700 hover:border-neutral-500 transition-all duration-200 hover:shadow-lg hover:shadow-black/30"
          >
            <div className="relative w-24 sm:w-32 flex-shrink-0">
              {show.poster_path ? (
                <img
                  src={`${BASE_IMAGE_URL}/w342${show.poster_path}`}
                  alt={show.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-neutral-700 flex items-center justify-center">
                  <span className="text-neutral-400 text-xs text-center px-2">
                    {show.name}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-center px-4 py-3 min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <TypeBadge type="tv" />
              </div>
              <div className="font-semibold text-neutral-100 group-hover:text-primary-300 transition-colors">
                {show.name}
              </div>
              {formatAirTime(
                episodes[0].showData?.air_time,
                episodes[0].showData?.air_timezone,
              ) && (
                <div className="text-xs text-neutral-500 mt-0.5">
                  {formatAirTime(
                    episodes[0].showData?.air_time,
                    episodes[0].showData?.air_timezone,
                  )}
                </div>
              )}
              <div className="mt-1.5 flex flex-col gap-1">
                {episodes.map((episode, eIdx) => (
                  <div key={eIdx} className="text-sm text-neutral-400">
                    <span className="text-neutral-500 text-xs mr-1.5">
                      S{episode.season_number}E{episode.episode_number}
                    </span>
                    {episode.name}
                    <span className="text-neutral-600 mx-1.5">·</span>
                    <span className="text-neutral-500 text-xs">
                      <RuntimeBadge minutes={episode.runtime} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Link>
        );
      })}

      {/* Movies */}
      {movies.map((movie) => (
        <Link
          key={movie.id}
          to={`/movie/${movie.id}`}
          className="group flex gap-0 bg-neutral-800 rounded-xl overflow-hidden border border-neutral-700 hover:border-neutral-500 transition-all duration-200 hover:shadow-lg hover:shadow-black/30"
        >
          <div className="relative w-24 sm:w-32 flex-shrink-0">
            {movie.poster_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w342${movie.poster_path}`}
                alt={movie.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-neutral-700 flex items-center justify-center">
                <span className="text-neutral-400 text-xs text-center px-2">
                  {movie.title}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col justify-center px-4 py-3 min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <TypeBadge type="movie" />
            </div>
            <div className="font-semibold text-neutral-100 group-hover:text-primary-300 transition-colors line-clamp-1">
              {movie.title}
            </div>
            {movie.overview && (
              <p className="text-neutral-500 text-xs mt-1.5 line-clamp-2 hidden sm:block">
                {movie.overview}
              </p>
            )}
            <div className="flex items-center gap-3 text-neutral-500 text-xs mt-2">
              <span>{formatDate(movie.release_date)}</span>
              <span>·</span>
              <RuntimeBadge minutes={movie.runtime} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
