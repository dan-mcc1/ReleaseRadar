import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_IMAGE_URL } from "../../constants";
import { apiFetch } from "../../utils/apiFetch";
import { airInstant } from "../../utils/calendarUtils";
import { parseLocalDate, toLocalISODate } from "../../utils/date";
import type { Show, Movie } from "../../types/calendar.d";
import { useCurrentlyWatching } from "../../hooks/api/useLists";
import { useNextEpisodesBulk, useToggleEpisode } from "../../hooks/api/useEpisodes";
import { useAuthUser } from "../../hooks/useAuthUser";
import { queryKeys } from "../../hooks/api/queryKeys";

interface NextEpisode {
  finished?: boolean;
  season_number?: number;
  episode_number?: number;
  name?: string | null;
  still_path?: string | null;
  air_date?: string | null;
}

const airDayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const airTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** When the episode airs, on the viewer's clock, if it hasn't yet: "today
 * 9:00 PM" or "Fri, Nov 14". Null once it has aired or when it has no date. */
function upcomingAirLabel(show: Show, airDate: string | null | undefined): string | null {
  if (!airDate) return null;
  const today = toLocalISODate(new Date());
  const instant = airInstant(airDate, show.air_time, show.air_timezone);
  if (instant) {
    if (instant.getTime() <= Date.now()) return null;
    return toLocalISODate(instant) === today
      ? `today ${airTimeFormatter.format(instant)}`
      : airDayFormatter.format(instant);
  }
  if (airDate <= today) return null;
  return airDayFormatter.format(parseLocalDate(airDate));
}

/** TMDb names an untitled episode "Episode 5", which only repeats the code. */
function episodeTitle(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed && !/^episode \d+$/i.test(trimmed) ? trimmed : null;
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : "", m > 0 ? `${m}m` : ""].filter(Boolean).join(" ");
}

const focusRing =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";
// The two text lines split the poster's height, so each is a full-height
// target even though the type is small.
const lineOne = `flex-1 min-h-0 min-w-0 flex items-end pb-0.5 text-caption sm:text-label font-semibold leading-tight text-neutral-100 hover:text-primary-400 transition-colors ${focusRing}`;
const lineTwo =
  "flex-1 min-h-0 min-w-0 flex items-start pt-0.5 text-caption leading-tight text-neutral-400";

function Poster({ to, path }: { to: string; path: string | null | undefined }) {
  // The title beside it links to the same place, so this one stays out of
  // the tab order and the accessibility tree.
  return (
    <Link
      to={to}
      tabIndex={-1}
      aria-hidden="true"
      className="block w-9 h-[54px] sm:w-[44px] sm:h-[66px] rounded-md overflow-hidden flex-shrink-0 bg-neutral-800"
    >
      {path && (
        <img
          src={`${BASE_IMAGE_URL}/w185${path}`}
          alt=""
          className="w-full h-full object-cover"
        />
      )}
    </Link>
  );
}

function MarkButton({
  label,
  busy,
  failed,
  onClick,
}: {
  label: string;
  busy: boolean;
  failed: boolean;
  onClick: () => void;
}) {
  const tone = busy
    ? "opacity-50 cursor-not-allowed border-neutral-700"
    : failed
      ? "border-error-500 text-error-400 hover:border-error-400 cursor-pointer"
      : "border-neutral-700 text-neutral-400 hover:border-primary-500 hover:text-primary-400 cursor-pointer";
  const text = failed ? `Couldn't save. ${label} again` : label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={text}
      aria-label={text}
      className={`w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${tone}`}
    >
      {busy ? (
        <span className="w-3 h-3 border border-neutral-500 border-t-white rounded-full animate-spin" />
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

const itemClass = "flex items-center gap-2 sm:gap-2.5 flex-shrink-0";
const textColumnClass =
  "flex flex-col h-[54px] sm:h-[66px] min-w-[96px] max-w-[150px] sm:min-w-[120px] sm:max-w-[210px]";

function ShowItem({
  show,
  next,
  loading,
}: {
  show: Show;
  next: NextEpisode | undefined;
  loading: boolean;
}) {
  const [marking, setMarking] = useState(false);
  const [failed, setFailed] = useState(false);
  const toggleEpisode = useToggleEpisode();

  const showUrl = `/tv/${show.id}`;
  const hasNext =
    !next?.finished && next?.season_number != null && next?.episode_number != null;
  const code = hasNext ? `S${next!.season_number}E${next!.episode_number}` : "";
  const airs = hasNext ? upcomingAirLabel(show, next!.air_date) : null;
  const title = hasNext ? episodeTitle(next!.name) : null;
  // What matters about an episode you can't watch yet is when it arrives.
  const detail = airs ? `Airs ${airs}` : title;

  async function handleMark() {
    if (marking || !hasNext) return;
    setMarking(true);
    setFailed(false);
    try {
      await toggleEpisode.mutateAsync({
        showId: show.id,
        seasonNumber: next!.season_number!,
        episodeNumber: next!.episode_number!,
        watched: false,
      });
    } catch {
      setFailed(true);
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className={itemClass}>
      <Poster to={showUrl} path={show.poster_path} />
      <div className={textColumnClass}>
        <Link to={showUrl} className={lineOne}>
          <span className="truncate">{show.name}</span>
        </Link>
        {hasNext ? (
          <Link
            to={`/tv/${show.id}/episode/${next!.season_number}/${next!.episode_number}`}
            title={detail ? `${code} · ${detail}` : code}
            className={`${lineTwo} hover:text-neutral-100 transition-colors ${focusRing}`}
          >
            <span className="truncate">
              <span className="font-mono text-neutral-200">{code}</span>
              {detail && ` · ${detail}`}
            </span>
          </Link>
        ) : loading ? (
          <div className={lineTwo} aria-hidden="true">
            <span className="mt-1 h-2 w-16 rounded bg-neutral-700 animate-pulse" />
          </div>
        ) : (
          <p className={lineTwo}>
            {next?.finished ? "Caught up" : "Next episode unavailable"}
          </p>
        )}
      </div>

      {hasNext && !airs && (
        <MarkButton
          label={`Mark ${code} of ${show.name} watched`}
          busy={marking}
          failed={failed}
          onClick={handleMark}
        />
      )}
    </div>
  );
}

function MovieItem({ movie }: { movie: Movie }) {
  const [marking, setMarking] = useState(false);
  const [failed, setFailed] = useState(false);
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const movieUrl = `/movie/${movie.id}`;

  async function handleMark() {
    if (marking) return;
    setMarking(true);
    setFailed(false);
    try {
      const body = JSON.stringify({ content_type: "movie", content_id: movie.id });
      const headers = { "Content-Type": "application/json" };
      const added = await apiFetch("/watched/add", { method: "POST", headers, body });
      if (!added.ok) throw new Error("watched/add failed");
      await apiFetch("/currently-watching/remove", { method: "DELETE", headers, body });
      if (user) {
        queryClient.invalidateQueries({ queryKey: queryKeys.currentlyWatching(user.uid) });
        queryClient.invalidateQueries({ queryKey: queryKeys.watched(user.uid) });
      }
    } catch {
      setFailed(true);
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className={itemClass}>
      <Poster to={movieUrl} path={movie.poster_path} />
      <div className={textColumnClass}>
        <Link to={movieUrl} className={lineOne}>
          <span className="truncate">{movie.title}</span>
        </Link>
        <p className={lineTwo}>
          <span className="truncate">
            Movie{movie.runtime > 0 && ` · ${formatRuntime(movie.runtime)}`}
          </span>
        </p>
      </div>

      <MarkButton
        label={`Mark ${movie.title} watched`}
        busy={marking}
        failed={failed}
        onClick={handleMark}
      />
    </div>
  );
}

type CWEntry =
  | { kind: "show"; show: Show; next: NextEpisode | undefined }
  | { kind: "movie"; movie: Movie };

/** What can be watched right now comes first: shows with an aired episode
 * waiting and movies, then shows waiting on an air date (soonest first), then
 * shows that are caught up. Ties keep the list's own order. */
function entryRank(entry: CWEntry): [number, string] {
  if (entry.kind === "movie") return [0, ""];
  const { show, next } = entry;
  if (!next || next.finished || next.season_number == null) return [2, ""];
  return upcomingAirLabel(show, next.air_date) ? [1, next.air_date ?? ""] : [0, ""];
}

export default function ContinueWatchingStrip() {
  const { data } = useCurrentlyWatching();
  const shows: Show[] = data?.shows ?? [];
  const movies: Movie[] = data?.movies ?? [];
  const total = shows.length + movies.length;

  const showIds = shows.map((s) => s.id);
  const { data: bulkNextData, isPending: nextPending } = useNextEpisodesBulk(showIds);

  const nextEpisodes: Record<number, NextEpisode> = {};
  if (bulkNextData) {
    for (const [k, v] of Object.entries(bulkNextData as Record<string, NextEpisode>)) {
      nextEpisodes[Number(k)] = v;
    }
  }

  if (total === 0) return (
    <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      <div className="flex-shrink-0 px-4 py-3 border-r border-neutral-800 self-stretch flex items-center">
        <p className="text-caption font-medium text-neutral-400 leading-tight">
          Continue<br />watching
        </p>
      </div>
      <p className="px-4 text-sm text-neutral-600">
        Shows and movies you're watching will appear here.
      </p>
    </div>
  );

  const listed: CWEntry[] = [
    ...shows.map((s): CWEntry => ({ kind: "show", show: s, next: nextEpisodes[s.id] })),
    ...movies.map((m): CWEntry => ({ kind: "movie", movie: m })),
  ];
  // The titles never wait on the next-episode request: they show in list order
  // straight away and are put in watch order once it answers. If it fails
  // they stay in list order.
  const entries = bulkNextData
    ? listed
        .map((entry, index) => ({ entry, index, rank: entryRank(entry) }))
        .sort(
          (a, b) =>
            a.rank[0] - b.rank[0] ||
            a.rank[1].localeCompare(b.rank[1]) ||
            a.index - b.index,
        )
        .map(({ entry }) => entry)
    : listed;

  return (
    <div data-tour="continue-watching" className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      {/* Label */}
      <div className="flex-shrink-0 px-3 sm:px-4 py-2 sm:py-3 border-r border-neutral-800 self-stretch flex items-center">
        <p className="text-caption font-medium text-neutral-400 leading-tight">
          Continue<br />watching
        </p>
      </div>

      {/* Items */}
      <div className="flex items-center gap-4 sm:gap-5 flex-1 px-3 sm:px-4 py-2 sm:py-3 overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.neutral.700)_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-neutral-700 [&::-webkit-scrollbar-thumb]:rounded-full">
        {entries.map((entry) =>
          entry.kind === "show" ? (
            <ShowItem
              key={`tv-${entry.show.id}`}
              show={entry.show}
              next={entry.next}
              loading={nextPending}
            />
          ) : (
            <MovieItem key={`movie-${entry.movie.id}`} movie={entry.movie} />
          ),
        )}
      </div>
    </div>
  );
}
