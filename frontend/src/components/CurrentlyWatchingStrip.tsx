import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import type { Show, Movie } from "../types/calendar";
import { useCurrentlyWatching } from "../hooks/api/useLists";
import { useNextEpisodesBulk, useToggleEpisode } from "../hooks/api/useEpisodes";

interface NextEpisode {
  finished: boolean;
  season_number?: number;
  episode_number?: number;
  name?: string | null;
  still_path?: string | null;
  overview?: string | null;
  air_date?: string | null;
}

function formatAirDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatToLocalTime(time24: string, sourceTimeZone: string): string {
  const [hour, minute] = time24.split(":").map(Number);
  const now = new Date();
  const sourceDate = new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: sourceTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now),
  );
  sourceDate.setHours(hour, minute, 0, 0);
  return sourceDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface ShowCardProps {
  show: Show;
  initialNext: NextEpisode | null;
}

function ShowCard({ show, initialNext }: ShowCardProps) {
  const [marking, setMarking] = useState(false);
  const navigate = useNavigate();
  const toggleEpisodeMutation = useToggleEpisode();
  const todayStr = new Date().toLocaleDateString("en-CA");

  const next = initialNext;

  async function markWatched() {
    if (!next || next.finished || marking) return;
    setMarking(true);
    try {
      await toggleEpisodeMutation.mutateAsync({
        showId: show.id,
        seasonNumber: next.season_number!,
        episodeNumber: next.episode_number!,
        watched: false,
      });
    } finally {
      setMarking(false);
    }
  }

  const isUnreleased = (() => {
    if (!next || next.finished || !next.air_date) return false;
    if (next.air_date > todayStr) return true;
    if (next.air_date < todayStr) return false;
    const airTime = show.air_time;
    const airTimezone = show.air_timezone;
    if (!airTime) return false;
    try {
      const [h, m] = airTime.split(":").map(Number);
      const tz = airTimezone ?? "UTC";
      const nowInTZ = new Date(
        new Date().toLocaleString("en-US", { timeZone: tz }),
      );
      const airInTZ = new Date(
        new Date().toLocaleString("en-US", { timeZone: tz }),
      );
      airInTZ.setHours(h, m, 0, 0);
      return nowInTZ < airInTZ;
    } catch {
      return false;
    }
  })();

  const episodeUrl =
    next && !next.finished && !isUnreleased
      ? `/tv/${show.id}/episode/${next.season_number}/${next.episode_number}`
      : null;

  return (
    <div
      onClick={() => episodeUrl && navigate(episodeUrl)}
      className={`flex-shrink-0 w-72 flex flex-col bg-neutral-700/50 rounded-xl overflow-hidden border border-neutral-600/50 ${episodeUrl ? "cursor-pointer hover:border-neutral-500 transition-colors" : ""}`}
    >
      <div className="flex gap-3 p-3 flex-1">
        <Link
          to={`/tv/${show.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        >
          {show.poster_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w342${show.poster_path}`}
              alt={show.name}
              className="w-12 h-18 rounded-lg object-cover border border-highlight-500/50"
              style={{ height: "72px" }}
            />
          ) : (
            <div
              className="w-12 rounded-lg bg-neutral-600 flex items-center justify-center"
              style={{ height: "72px" }}
            >
              <span className="text-neutral-400 text-[9px] text-center px-0.5">
                {show.name}
              </span>
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <Link
              to={`/tv/${show.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-semibold text-white hover:text-highlight-300 transition-colors line-clamp-1"
            >
              {show.name}
            </Link>

            {next === null && (
              <p className="text-xs text-neutral-500 mt-0.5">Loading…</p>
            )}

            {next?.finished && (
              <p className="text-xs text-success-400 mt-0.5 font-medium">
                All caught up!
              </p>
            )}

            {next && !next.finished && (
              <p className="text-xs text-neutral-400 mt-0.5 line-clamp-1">
                <span className="text-highlight-300 font-medium">
                  S{next.season_number}E{next.episode_number}
                </span>
                {next.name && (
                  <span className="text-neutral-400"> — {next.name}</span>
                )}
              </p>
            )}
          </div>

          {next &&
            !next.finished &&
            (isUnreleased ? (
              todayStr === next.air_date ? (
                <span className="mt-2 self-start inline-flex items-center gap-1 text-xs text-neutral-400 bg-neutral-600/50 border border-neutral-600 px-2.5 py-1 rounded-md">
                  <svg
                    className="w-3 h-3 text-neutral-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  Airs{" "}
                  {show.air_time && show.air_timezone
                    ? formatToLocalTime(show.air_time, show.air_timezone)
                    : "soon"}
                </span>
              ) : (
                <span className="mt-2 self-start inline-flex items-center gap-1 text-xs text-neutral-400 bg-neutral-600/50 border border-neutral-600 px-2.5 py-1 rounded-md">
                  <svg
                    className="w-3 h-3 text-neutral-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  Airs {next.air_date ? formatAirDate(next.air_date) : "soon"}
                </span>
              )
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  markWatched();
                }}
                disabled={marking}
                className="mt-2 self-start inline-flex items-center gap-1.5 bg-highlight-600 hover:bg-highlight-500 disabled:opacity-50 text-white text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
              >
                {marking ? (
                  <span className="w-3 h-3 border border-white/50 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-3 h-3"
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
                )}
                {marking ? "Saving…" : "Mark Watched"}
              </button>
            ))}
        </div>
      </div>

      {next &&
        !next.finished &&
        (next.still_path ?? show.backdrop_path ?? show.poster_path) && (
          <div className="aspect-video w-full overflow-hidden">
            <img
              src={`${BASE_IMAGE_URL}/w780${next.still_path ?? show.backdrop_path ?? show.poster_path}`}
              alt={next.name ?? show.name}
              className="w-full aspect-video object-cover opacity-60"
            />
          </div>
        )}
    </div>
  );
}

export default function CurrentlyWatchingStrip() {
  const [open, setOpen] = useState(false);

  const { data } = useCurrentlyWatching();
  const shows = ((data as any)?.shows ?? []) as Show[];
  const movies = ((data as any)?.movies ?? []) as Movie[];
  const total = shows.length + movies.length;

  const showIds = shows.map((s) => s.id);
  const { data: bulkNextData } = useNextEpisodesBulk(open ? showIds : []);
  const nextEpisodes: Record<number, NextEpisode> = {};
  if (bulkNextData) {
    for (const [k, v] of Object.entries(bulkNextData as Record<string, NextEpisode>)) {
      nextEpisodes[Number(k)] = v;
    }
  }

  if (total === 0) return null;

  return (
    <div className="flex flex-col border-b border-neutral-700 bg-neutral-800/60 max-w-7xl mx-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 sm:px-6 py-3 hover:bg-neutral-700/40 transition-colors"
      >
        <span className="flex items-center justify-center w-2 h-2 rounded-full bg-highlight-400 animate-pulse flex-shrink-0" />
        <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">
          Currently Watching
        </h2>
        <span className="text-xs text-neutral-500 font-normal normal-case tracking-normal">
          — {total} title{total !== 1 ? "s" : ""}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className={`w-4 h-4 ml-auto text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="px-4 sm:px-6 pb-4 pt-1">
          <div className="flex gap-4 overflow-x-auto pb-2">
            {shows.map((show) => (
              <ShowCard
                key={`tv-${show.id}`}
                show={show}
                initialNext={nextEpisodes[show.id] ?? null}
              />
            ))}

            {movies.map((movie) => (
              <Link
                key={`movie-${movie.id}`}
                to={`/movie/${movie.id}`}
                className="flex-shrink-0 w-72 flex flex-col bg-neutral-700/50 rounded-xl overflow-hidden border border-neutral-600/50 hover:border-neutral-500 transition-colors"
              >
                <div className="flex gap-3 p-3 flex-1">
                  <div className="flex-shrink-0">
                    {movie.poster_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w342${movie.poster_path}`}
                        alt={movie.title}
                        className="w-12 rounded-lg object-cover border border-highlight-500/50"
                        style={{ height: "72px" }}
                      />
                    ) : (
                      <div
                        className="w-12 rounded-lg bg-neutral-600 flex items-center justify-center"
                        style={{ height: "72px" }}
                      >
                        <span className="text-neutral-400 text-[9px] text-center px-0.5">
                          {movie.title}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white hover:text-highlight-300 transition-colors line-clamp-1">
                        {movie.title}
                      </p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {movie.release_date
                          ? new Date(
                              movie.release_date + "T00:00:00",
                            ).getFullYear()
                          : ""}
                        {movie.runtime
                          ? ` · ${Math.floor(movie.runtime / 60) > 0 ? `${Math.floor(movie.runtime / 60)}h ` : ""}${movie.runtime % 60 > 0 ? `${movie.runtime % 60}m` : ""}`
                          : ""}
                      </p>
                    </div>
                    <span className="mt-2 self-start inline-flex items-center gap-1 text-xs text-neutral-400 bg-neutral-600/50 border border-neutral-600 px-2.5 py-1 rounded-md">
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                        />
                      </svg>
                      Movie
                    </span>
                  </div>
                </div>

                {(movie.backdrop_path ?? movie.poster_path) && (
                  <div className="aspect-video w-full overflow-hidden">
                    <img
                      src={`${BASE_IMAGE_URL}/w780${movie.backdrop_path ?? movie.poster_path}`}
                      alt={movie.title}
                      className="w-full aspect-video object-cover opacity-60"
                    />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
