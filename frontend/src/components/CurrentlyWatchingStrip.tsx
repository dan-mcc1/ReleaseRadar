import { useState } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import type { Show, Movie } from "../types/calendar";

interface Props {
  shows: Show[];
  movies: Movie[];
}

export default function CurrentlyWatchingStrip({ shows, movies }: Props) {
  const [open, setOpen] = useState(false);
  const total = shows.length + movies.length;
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 sm:px-6 pb-4 pt-1">
        <div className="flex gap-4 overflow-x-auto pb-2">
        {shows.map((show) => (
          <Link
            key={`tv-${show.id}`}
            to={`/tv/${show.id}`}
            className="flex-shrink-0 group flex flex-col items-center gap-2"
          >
            {show.poster_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w154${show.poster_path}`}
                alt={show.name}
                className="w-16 h-24 rounded-xl object-cover border-2 border-purple-500 group-hover:border-purple-300 shadow-lg shadow-purple-900/30 transition-all duration-150 group-hover:scale-105"
              />
            ) : (
              <div className="w-16 h-24 rounded-xl bg-slate-700 border-2 border-purple-500 flex items-center justify-center shadow-lg">
                <span className="text-slate-400 text-[10px] text-center leading-tight px-1">{show.name}</span>
              </div>
            )}
            <span className="text-xs text-slate-300 group-hover:text-white transition-colors w-16 text-center truncate">
              {show.name}
            </span>
          </Link>
        ))}
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
                <span className="text-slate-400 text-[10px] text-center leading-tight px-1">{movie.title}</span>
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
