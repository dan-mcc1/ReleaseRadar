import { Link, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { useBoxOffice } from "../hooks/api/useBoxOffice";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatMoney(amount: number): string {
  if (amount >= 1_000_000_000)
    return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount > 0) return `$${amount.toLocaleString()}`;
  return "—";
}

function formatProfit(
  revenue: number,
  budget: number,
): { text: string; color: string } {
  if (budget <= 0) return { text: "—", color: "text-neutral-400" };
  const profit = revenue - budget;
  const text = formatMoney(Math.abs(profit));
  if (profit >= 0) return { text: `+${text}`, color: "text-emerald-400" };
  return { text: `-${text}`, color: "text-error-400" };
}

const currentYear = new Date().getFullYear();
const years = Array.from(
  { length: currentYear - 1979 },
  (_, i) => currentYear - i,
);

export default function BoxOffice() {
  usePageTitle("Box Office");
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = (searchParams.get("mode") as "yearly" | "monthly") ?? "yearly";
  const year = Number(searchParams.get("year") ?? currentYear);
  const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);
  const MOVIE_LIMIT = 10;

  const { data: movies = [], isPending: loading, error } = useBoxOffice(mode, year, month, MOVIE_LIMIT);

  const subtitle =
    mode === "yearly"
      ? `Top-grossing movies released in ${year}`
      : `Top-grossing movies released in ${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-white">Box Office</h1>
          <span className="text-lg">🎬</span>
        </div>
        <p className="text-neutral-400">{subtitle}</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        {/* Mode toggle */}
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <button
            onClick={() =>
              setSearchParams({ mode: "yearly", year: String(year) })
            }
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === "yearly"
                ? "bg-primary-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            Yearly
          </button>
          <button
            onClick={() =>
              setSearchParams({
                mode: "monthly",
                year: String(year),
                month: String(month),
              })
            }
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === "monthly"
                ? "bg-primary-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            Monthly
          </button>
        </div>

        {/* Year selector */}
        <select
          value={year}
          onChange={(e) =>
            setSearchParams(
              mode === "monthly"
                ? { mode, year: e.target.value, month: String(month) }
                : { mode, year: e.target.value },
            )
          }
          className="bg-neutral-800 border border-white/10 text-neutral-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        {/* Month selector — only when monthly mode */}
        {mode === "monthly" && (
          <select
            value={month}
            onChange={(e) =>
              setSearchParams({
                mode,
                year: String(year),
                month: e.target.value,
              })
            }
            className="bg-neutral-800 border border-white/10 text-neutral-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-error-400">{error?.message}</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && movies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-400">
            No box office data available for this period.
          </p>
        </div>
      )}

      {/* Leaderboard */}
      {!loading && !error && movies.length > 0 && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2rem_2.5rem_1fr_auto] sm:grid-cols-[2.5rem_3rem_1fr_repeat(3,minmax(0,1fr))] gap-2 items-center px-3 sm:px-4 py-3 bg-neutral-800/60 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
            <span>#</span>
            <span></span>
            <span>Movie</span>
            <span className="text-right">Revenue</span>
            <span className="hidden sm:block text-right">Budget</span>
            <span className="hidden sm:block text-right">Profit / Loss</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-white/5">
            {movies.map((movie) => {
              const profit = formatProfit(movie.revenue, movie.budget);
              return (
                <Link
                  key={movie.id}
                  to={`/movie/${movie.id}`}
                  className="grid grid-cols-[2rem_2.5rem_1fr_auto] sm:grid-cols-[2.5rem_3rem_1fr_repeat(3,minmax(0,1fr))] gap-2 items-center px-3 sm:px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  {/* Rank */}
                  <span
                    className={`text-sm font-bold ${
                      movie.rank === 1
                        ? "text-warning-400"
                        : movie.rank === 2
                          ? "text-neutral-300"
                          : movie.rank === 3
                            ? "text-amber-600"
                            : "text-neutral-500"
                    }`}
                  >
                    {movie.rank}
                  </span>

                  {/* Poster */}
                  <div className="w-8 sm:w-9 h-[48px] sm:h-[54px] rounded overflow-hidden bg-neutral-700 flex-shrink-0">
                    {movie.poster_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w185${movie.poster_path}`}
                        alt={movie.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs">
                        ?
                      </div>
                    )}
                  </div>

                  {/* Title + date */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white line-clamp-2 sm:truncate leading-snug">
                      {movie.title}
                    </p>
                    {movie.release_date && (
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {new Date(
                          movie.release_date + "T00:00:00",
                        ).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    )}
                  </div>

                  {/* Revenue */}
                  <span className="text-sm text-white text-right font-medium">
                    {formatMoney(movie.revenue)}
                  </span>

                  {/* Budget — hidden on mobile */}
                  <span className="hidden sm:block text-sm text-neutral-400 text-right">
                    {formatMoney(movie.budget)}
                  </span>

                  {/* Profit — hidden on mobile */}
                  <span
                    className={`hidden sm:block text-sm text-right font-medium ${profit.color}`}
                  >
                    {profit.text}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-neutral-600 mt-6 text-center">
        Revenue data sourced from TMDB. Some titles may have incomplete figures.
      </p>
    </div>
  );
}
