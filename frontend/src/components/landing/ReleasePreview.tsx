import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../../constants";
import type { Movie } from "../../types/calendar";
import { toLocalISODate } from "../../utils/date";
import { cx, focusRing } from "../ui";
import { useComingSoonMonth } from "./useComingSoonMonth";

const DAYS = 14;
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/**
 * The next two weeks as the app's calendar draws them, filled with the
 * movies actually opening on each day. It's the product, shown with real
 * data, in place of a decorative hero image.
 */
export default function ReleasePreview() {
  const { movies, loading } = useComingSoonMonth();

  const byDay = new Map<string, Movie[]>();
  for (const movie of movies) {
    if (!movie.release_date) continue;
    const list = byDay.get(movie.release_date) ?? [];
    list.push(movie);
    byDay.set(movie.release_date, list);
  }

  const today = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const key = toLocalISODate(date);
    return { date, key, movies: byDay.get(key) ?? [] };
  });

  return (
    <figure className="min-w-0">
      <div
        className="grid grid-cols-7 gap-px overflow-hidden rounded-surface border border-neutral-800 bg-neutral-800"
        aria-busy={loading || undefined}
      >
        {days.map(({ date, key, movies: dayMovies }, i) => {
          const shown = dayMovies.slice(0, 2);
          const more = dayMovies.length - shown.length;
          return (
            <div
              key={key}
              className={cx(
                "min-h-28 sm:min-h-36 p-1.5 sm:p-2 flex flex-col gap-1.5",
                i === 0 ? "bg-primary-500/10" : "bg-neutral-900",
              )}
            >
              <div className="flex items-baseline justify-between gap-1 text-caption tabular">
                <span className={i === 0 ? "font-semibold text-primary-300" : "text-neutral-400"}>
                  {i === 0 ? "Today" : weekdayFormatter.format(date)}
                </span>
                <time dateTime={key} className={i === 0 ? "text-primary-300" : "text-neutral-500"}>
                  {date.getDate()}
                </time>
              </div>
              {loading ? (
                i % 3 === 1 && <div className="aspect-[2/3] w-full rounded-md bg-neutral-800 animate-pulse" />
              ) : (
                <div className="flex flex-col gap-1">
                  {shown.map((movie) => (
                    <Link
                      key={movie.id}
                      to={`/movie/${movie.id}`}
                      title={movie.title}
                      className={cx("block overflow-hidden rounded-md", focusRing)}
                    >
                      {movie.poster_path ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w185${movie.poster_path}`}
                          alt={movie.title}
                          loading="lazy"
                          className="aspect-[2/3] w-full object-cover"
                        />
                      ) : (
                        <span className="flex aspect-[2/3] items-center justify-center bg-neutral-800 p-1 text-center text-caption text-neutral-400">
                          {movie.title}
                        </span>
                      )}
                    </Link>
                  ))}
                  {more > 0 && (
                    <span className="text-caption text-neutral-400 tabular">+{more} more</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <figcaption className="mt-3 text-label text-neutral-400">
        Movies opening in the next two weeks. Track the titles you care about and this becomes
        your calendar, with every new episode on its air date.
      </figcaption>
    </figure>
  );
}
