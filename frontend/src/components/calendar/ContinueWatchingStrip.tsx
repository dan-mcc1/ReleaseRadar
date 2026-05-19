import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_IMAGE_URL } from "../../constants";
import { apiFetch } from "../../utils/apiFetch";
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
}

function ShowItem({ show, next }: { show: Show; next: NextEpisode | undefined }) {
  const [marking, setMarking] = useState(false);
  const toggleEpisode = useToggleEpisode();

  const isCaughtUp = next?.finished;
  const hasNext = !isCaughtUp && next?.season_number != null && next?.episode_number != null;
  const episodeUrl = hasNext
    ? `/tv/${show.id}/episode/${next!.season_number}/${next!.episode_number}`
    : `/tv/${show.id}`;

  async function handleMark(e: React.MouseEvent) {
    e.preventDefault();
    if (marking || !hasNext) return;
    setMarking(true);
    try {
      await toggleEpisode.mutateAsync({
        showId: show.id,
        seasonNumber: next!.season_number!,
        episodeNumber: next!.episode_number!,
        watched: false,
      });
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="flex items-center gap-2.5 flex-shrink-0 group">
      <Link to={episodeUrl} className="flex items-center gap-2.5">
        <div className="w-[44px] h-[66px] rounded-md overflow-hidden flex-shrink-0 bg-neutral-800">
          {show.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w185${show.poster_path}`}
              alt={show.name}
              className="w-full h-full object-cover"
            />
          )}
        </div>
        <div style={{ minWidth: 110, maxWidth: 140 }}>
          <p className="text-[12.5px] font-semibold text-neutral-100 truncate leading-tight group-hover:text-primary-400 transition-colors">
            {show.name}
          </p>
          <p className="font-mono text-[10px] text-neutral-500 mt-0.5">
            {isCaughtUp
              ? "Caught up"
              : hasNext
                ? `S${next!.season_number}E${next!.episode_number}`
                : "—"}
          </p>
        </div>
      </Link>

      {hasNext && (
        <button
          onClick={handleMark}
          disabled={marking}
          title="Mark as watched"
          className={`w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
            marking
              ? "opacity-50 cursor-not-allowed border-neutral-700"
              : "border-neutral-700 text-neutral-500 hover:border-primary-500 hover:text-primary-400 cursor-pointer"
          }`}
        >
          {marking ? (
            <span className="w-3 h-3 border border-neutral-500 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

function MovieItem({ movie }: { movie: Movie }) {
  const [marking, setMarking] = useState(false);
  const user = useAuthUser();
  const queryClient = useQueryClient();

  async function handleMark(e: React.MouseEvent) {
    e.preventDefault();
    if (marking) return;
    setMarking(true);
    try {
      await apiFetch("/watched/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: "movie", content_id: movie.id }),
      });
      await apiFetch("/currently-watching/remove", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: "movie", content_id: movie.id }),
      });
      if (user) {
        queryClient.invalidateQueries({ queryKey: queryKeys.currentlyWatching(user.uid) });
        queryClient.invalidateQueries({ queryKey: queryKeys.watched(user.uid) });
      }
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="flex items-center gap-2.5 flex-shrink-0 group">
      <Link to={`/movie/${movie.id}`} className="flex items-center gap-2.5">
        <div className="w-[44px] h-[66px] rounded-md overflow-hidden flex-shrink-0 bg-neutral-800">
          {movie.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w185${movie.poster_path}`}
              alt={movie.title}
              className="w-full h-full object-cover"
            />
          )}
        </div>
        <div style={{ minWidth: 110, maxWidth: 140 }}>
          <p className="text-[12.5px] font-semibold text-neutral-100 truncate leading-tight group-hover:text-primary-400 transition-colors">
            {movie.title}
          </p>
          <p className="font-mono text-[10px] text-neutral-500 mt-0.5">Movie</p>
        </div>
      </Link>

      <button
        onClick={handleMark}
        disabled={marking}
        title="Mark as watched"
        className={`w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
          marking
            ? "opacity-50 cursor-not-allowed border-neutral-700"
            : "border-neutral-700 text-neutral-500 hover:border-primary-500 hover:text-primary-400 cursor-pointer"
        }`}
      >
        {marking ? (
          <span className="w-3 h-3 border border-neutral-500 border-t-white rounded-full animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
    </div>
  );
}

type CWEntry =
  | { kind: "show"; show: Show }
  | { kind: "movie"; movie: Movie };

export default function ContinueWatchingStrip() {
  const { data } = useCurrentlyWatching();
  const shows = ((data as any)?.shows ?? []) as Show[];
  const movies = ((data as any)?.movies ?? []) as Movie[];

  const allEntries: CWEntry[] = [
    ...shows.map((s): CWEntry => ({ kind: "show", show: s })),
    ...movies.map((m): CWEntry => ({ kind: "movie", movie: m })),
  ];
  const total = allEntries.length;

  const showIds = shows.map((s) => s.id);
  const { data: bulkNextData } = useNextEpisodesBulk(showIds);

  const nextEpisodes: Record<number, NextEpisode> = {};
  if (bulkNextData) {
    for (const [k, v] of Object.entries(bulkNextData as Record<string, NextEpisode>)) {
      nextEpisodes[Number(k)] = v;
    }
  }

  if (total === 0) return (
    <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      <div className="flex-shrink-0 px-4 py-3 border-r border-neutral-800 self-stretch flex items-center">
        <p className="font-mono text-[10.5px] tracking-[0.1em] uppercase text-neutral-500 leading-tight">
          Continue<br />watching
        </p>
      </div>
      <p className="px-4 text-sm text-neutral-600">
        Shows and movies you're watching will appear here.
      </p>
    </div>
  );

  return (
    <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      {/* Label */}
      <div className="flex-shrink-0 px-4 py-3 border-r border-neutral-800 self-stretch flex items-center">
        <p className="font-mono text-[10.5px] tracking-[0.1em] uppercase text-neutral-500 leading-tight">
          Continue<br />watching
        </p>
      </div>

      {/* Items */}
      <div className="flex items-center gap-5 flex-1 px-4 py-3 overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.neutral.700)_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-neutral-700 [&::-webkit-scrollbar-thumb]:rounded-full">
        {allEntries.map((entry) =>
          entry.kind === "show" ? (
            <ShowItem key={`tv-${entry.show.id}`} show={entry.show} next={nextEpisodes[entry.show.id]} />
          ) : (
            <MovieItem key={`movie-${entry.movie.id}`} movie={entry.movie} />
          )
        )}
      </div>
    </div>
  );
}
