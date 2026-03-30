import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BASE_IMAGE_URL, API_URL } from "../constants";
import type { Show, Movie } from "../types/calendar";
import type { User } from "firebase/auth";

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

  // Create a date in the SOURCE timezone
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

  // Set correct time
  sourceDate.setHours(hour, minute, 0, 0);

  // Convert to user's local timezone automatically
  return sourceDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface ShowCardProps {
  show: Show;
  token: string;
  onEpisodeWatched: (showId: number, season: number, episode: number) => void;
}

function ShowCard({ show, token, onEpisodeWatched }: ShowCardProps) {
  const [next, setNext] = useState<NextEpisode | null>(null);
  const [marking, setMarking] = useState(false);
  const navigate = useNavigate();
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/watched-episode/${show.id}/next`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setNext(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [show.id, token]);

  async function markWatched() {
    if (!next || next.finished || marking) return;
    setMarking(true);
    try {
      await fetch(
        `${API_URL}/watched-episode/add?show_id=${show.id}&season_number=${next.season_number}&episode_number=${next.episode_number}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      onEpisodeWatched(show.id, next.season_number!, next.episode_number!);
      // Fetch next episode after marking
      const r = await fetch(`${API_URL}/watched-episode/${show.id}/next`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNext(await r.json());
    } catch {
      // ignore
    } finally {
      setMarking(false);
    }
  }

  const isUnreleased = (() => {
    if (!next || next.finished || !next.air_date) return false;
    if (next.air_date > todayStr) return true;
    if (next.air_date < todayStr) return false;
    // Same day — check air time in show's timezone if available
    const airTime = show.air_time;
    const airTimezone = show.air_timezone;
    if (!airTime) return false; // no time info, assume it's aired
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
      className={`flex-shrink-0 w-72 flex flex-col bg-slate-700/50 rounded-xl overflow-hidden border border-slate-600/50 ${episodeUrl ? "cursor-pointer hover:border-slate-500 transition-colors" : ""}`}
    >
      <div className="flex gap-3 p-3 flex-1">
        {/* Poster — links to show, not episode */}
        <Link
          to={`/tv/${show.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        >
          {show.poster_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w154${show.poster_path}`}
              alt={show.name}
              className="w-12 h-18 rounded-lg object-cover border border-purple-500/50"
              style={{ height: "72px" }}
            />
          ) : (
            <div
              className="w-12 rounded-lg bg-slate-600 flex items-center justify-center"
              style={{ height: "72px" }}
            >
              <span className="text-slate-400 text-[9px] text-center px-0.5">
                {show.name}
              </span>
            </div>
          )}
        </Link>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            {/* Show name — links to show, not episode */}
            <Link
              to={`/tv/${show.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-semibold text-white hover:text-purple-300 transition-colors line-clamp-1"
            >
              {show.name}
            </Link>

            {next === null && (
              <p className="text-xs text-slate-500 mt-0.5">Loading…</p>
            )}

            {next?.finished && (
              <p className="text-xs text-green-400 mt-0.5 font-medium">
                All caught up!
              </p>
            )}

            {next && !next.finished && (
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                <span className="text-purple-300 font-medium">
                  S{next.season_number}E{next.episode_number}
                </span>
                {next.name && (
                  <span className="text-slate-400"> — {next.name}</span>
                )}
              </p>
            )}
          </div>

          {next &&
            !next.finished &&
            (isUnreleased ? (
              todayStr === next.air_date ? (
                <span className="mt-2 self-start inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-600/50 border border-slate-600 px-2.5 py-1 rounded-md">
                  <svg
                    className="w-3 h-3 text-slate-500"
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
                <span className="mt-2 self-start inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-600/50 border border-slate-600 px-2.5 py-1 rounded-md">
                  <svg
                    className="w-3 h-3 text-slate-500"
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
                className="mt-2 self-start inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
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

      {/* Episode still — falls back to show backdrop then poster */}
      {next &&
        !next.finished &&
        (next.still_path ?? show.backdrop_path ?? show.poster_path) && (
          <div className="aspect-video w-full overflow-hidden">
            <img
              src={`${BASE_IMAGE_URL}/w300${next.still_path ?? show.backdrop_path ?? show.poster_path}`}
              alt={next.name ?? show.name}
              className="w-full aspect-video object-cover opacity-60"
            />
          </div>
        )}
    </div>
  );
}

interface Props {
  shows: Show[];
  movies: Movie[];
  user: User | null;
  onEpisodeWatched?: (showId: number, season: number, episode: number) => void;
}

export default function CurrentlyWatchingStrip({
  shows,
  movies,
  user,
  onEpisodeWatched,
}: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const total = shows.length + movies.length;

  useEffect(() => {
    if (!user) return;
    user
      .getIdToken()
      .then(setToken)
      .catch(() => {});
  }, [user]);

  if (total === 0) return null;

  return (
    <div className="border-b border-slate-700 bg-slate-800/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 sm:px-6 py-3 hover:bg-slate-700/40 transition-colors"
      >
        <span className="flex items-center justify-center w-2 h-2 rounded-full bg-purple-400 animate-pulse flex-shrink-0" />
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Currently Watching
        </h2>
        <span className="text-xs text-slate-500 font-normal normal-case tracking-normal">
          — {total} title{total !== 1 ? "s" : ""}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className={`w-4 h-4 ml-auto text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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
            {/* TV shows with next-episode info */}
            {token &&
              shows.map((show) => (
                <ShowCard
                  key={`tv-${show.id}`}
                  show={show}
                  token={token}
                  onEpisodeWatched={onEpisodeWatched ?? (() => {})}
                />
              ))}

            {/* Movies — simple poster cards unchanged */}
            {movies.map((movie) => (
              <Link
                key={`movie-${movie.id}`}
                to={`/movie/${movie.id}`}
                className="flex-shrink-0 group flex flex-col items-center gap-2"
              >
                {movie.poster_path ? (
                  <img
                    src={`${BASE_IMAGE_URL}/w154${movie.poster_path}`}
                    alt={movie.title}
                    className="w-16 h-24 rounded-xl object-cover border-2 border-purple-500 group-hover:border-purple-300 shadow-lg shadow-purple-900/30 transition-all duration-150 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-16 h-24 rounded-xl bg-slate-700 border-2 border-purple-500 flex items-center justify-center shadow-lg">
                    <span className="text-slate-400 text-[10px] text-center leading-tight px-1">
                      {movie.title}
                    </span>
                  </div>
                )}
                <span className="text-xs text-slate-300 group-hover:text-white transition-colors w-16 text-center truncate">
                  {movie.title}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
