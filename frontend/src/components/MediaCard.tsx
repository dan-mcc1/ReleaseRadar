import { Movie, Show } from "../types/calendar";
import { BASE_IMAGE_URL } from "../constants";
import { Link } from "react-router-dom";
import { parseLocalDate } from "../utils/date";

type MediaCardProps =
  | {
      type: "movie";
      item: Movie;
      onRemove?: (type: "movie" | "tv", id: number) => void;
    }
  | {
      type: "tv";
      item: Show;
      onRemove?: (type: "movie" | "tv", id: number) => void;
    };

export default function MediaCard({ item, type, onRemove }: MediaCardProps) {
  const title = type === "tv" ? (item as Show).name : (item as Movie).title;
  const date =
    type === "tv"
      ? (item as Show).first_air_date
      : (item as Movie).release_date;
  const year = date ? parseLocalDate(date).getFullYear() : null;

  const genres: { id: number; name: string }[] = item.genres ?? [];

  return (
    <div className="group relative rounded-xl overflow-hidden bg-neutral-800 border border-neutral-700 hover:border-neutral-500 transition-all duration-200 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5 flex flex-col">
      <Link
        to={type === "tv" ? `/tv/${item.id}` : `/movie/${item.id}`}
        className="flex flex-col flex-1"
      >
        {/* Backdrop image */}
        <div className="relative aspect-video overflow-hidden">
          {item.backdrop_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w780${item.backdrop_path}`}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="h-full w-full bg-neutral-700 flex items-center justify-center">
              <svg
                className="w-12 h-12 text-neutral-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-800 via-transparent to-transparent" />

          {/* Logo overlay */}
          {item.logo_path && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center px-3">
              <img
                src={`${BASE_IMAGE_URL}/w300${item.logo_path}`}
                alt={title}
                className="max-h-8 object-contain drop-shadow-lg"
              />
            </div>
          )}

          {/* Type badge */}
          <div className="absolute top-2 left-2">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full backdrop-blur-sm ${
                type === "tv"
                  ? "bg-highlight-600/70 text-highlight-100"
                  : "bg-amber-600/70 text-amber-100"
              }`}
            >
              {type === "tv" ? "TV" : "Movie"}
            </span>
          </div>
        </div>

        {/* Info bar */}
        <div className="px-3 py-3 flex flex-col gap-1 flex-1">
          {!item.logo_path && (
            <div className="font-semibold text-neutral-100 line-clamp-1 group-hover:text-primary-300 transition-colors">
              {title}
            </div>
          )}
          {item.logo_path && (
            <div className="font-semibold text-neutral-100 line-clamp-1 group-hover:text-primary-300 transition-colors">
              {title}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {year && <span className="text-xs text-neutral-400">{year}</span>}
            {item.vote_average != null && item.vote_average > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-warning-400 font-medium">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                {item.vote_average.toFixed(1)}
              </span>
            )}
            {genres.slice(0, 2).map((g) => (
              <span
                key={g.id}
                className="text-xs text-neutral-500 bg-neutral-700/60 px-1.5 py-0.5 rounded"
              >
                {g.name}
              </span>
            ))}
          </div>
          {item.user_rating != null && (
            <div className="flex items-center gap-0.5 mt-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <svg
                  key={s}
                  className={`w-3.5 h-3.5 ${s <= item.user_rating! ? "text-warning-400" : "text-neutral-600"}`}
                  viewBox="0 0 24 24"
                  fill={s <= item.user_rating! ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={s <= item.user_rating! ? 0 : 1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                  />
                </svg>
              ))}
            </div>
          )}
        </div>
      </Link>

      {/* Remove button */}
      {onRemove && (
        <div className="px-3 pb-3">
          <button
            onClick={(e) => {
              e.preventDefault();
              onRemove(type, item.id);
            }}
            className="w-full py-1.5 text-xs font-medium text-neutral-400 bg-neutral-700/50 hover:bg-error-600/20 hover:text-error-400 border border-neutral-600 hover:border-error-600/40 rounded-lg transition-all duration-150"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
