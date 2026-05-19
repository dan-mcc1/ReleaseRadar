import { Link, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { useBoxOffice, BoxOfficeMovie } from "../hooks/api/useBoxOffice";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMoney(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount > 0) return `$${amount.toLocaleString()}`;
  return "—";
}

function calcKpis(movies: BoxOfficeMovie[]) {
  const totalRevenue = movies.reduce((s, m) => s + m.revenue, 0);
  const budgeted = movies.filter((m) => m.budget > 0);
  const avgBudget = budgeted.length
    ? budgeted.reduce((s, m) => s + m.budget, 0) / budgeted.length
    : 0;
  const totalProfit = budgeted.reduce((s, m) => s + (m.revenue - m.budget), 0);
  const bestMargin = budgeted.reduce<{ movie: BoxOfficeMovie | null; ratio: number }>(
    (best, m) => {
      const r = m.revenue / m.budget;
      return r > best.ratio ? { movie: m, ratio: r } : best;
    },
    { movie: null, ratio: 0 }
  );
  return { totalRevenue, avgBudget, totalProfit, bestMargin };
}

const currentYear = new Date().getFullYear();

export default function BoxOffice() {
  usePageTitle("Box Office");
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = (searchParams.get("mode") as "yearly" | "monthly") ?? "yearly";
  const year = Number(searchParams.get("year") ?? currentYear);
  const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);

  const { data: movies = [], isPending: loading, error } = useBoxOffice(mode, year, month, 10);

  const subtitle =
    mode === "yearly"
      ? `Top-grossing movies released in ${year}`
      : `Top-grossing movies released in ${MONTH_NAMES[month - 1]} ${year}`;

  const yearWindow = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];
  const showMoreYears = !yearWindow.includes(year);

  const hero = movies[0] ?? null;
  const kpis = calcKpis(movies);

  function setMode(m: "yearly" | "monthly") {
    setSearchParams(m === "monthly"
      ? { mode: m, year: String(year), month: String(month) }
      : { mode: m, year: String(year) }
    );
  }
  function setYear(y: number) {
    setSearchParams(mode === "monthly"
      ? { mode, year: String(y), month: String(month) }
      : { mode, year: String(y) }
    );
  }
  function setMonth(m: number) {
    setSearchParams({ mode, year: String(year), month: String(m) });
  }

  return (
    <div className="w-full px-4 sm:px-8 lg:px-10 py-8 pb-20">
      {/* Page header */}
      <div className="mb-2" data-tour="box-office-header">
        <div className="font-mono text-[10px] tracking-widest text-neutral-500 uppercase mb-2">
          Discover · {subtitle}
        </div>
        <h1 className="text-4xl sm:text-5xl font-light tracking-tight leading-none" style={{ fontFamily: "'Georgia', serif" }}>
          The <em className="italic text-primary-400 not-italic" style={{ fontStyle: "italic" }}>box office</em>
        </h1>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mt-6 mb-7">
        {/* Mode toggle */}
        <div className="flex bg-neutral-800/80 border border-white/10 rounded-xl p-1 gap-0.5">
          {(["Yearly", "Monthly"] as const).map((l) => {
            const v = l.toLowerCase() as "yearly" | "monthly";
            return (
              <button
                key={v}
                onClick={() => setMode(v)}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  v === mode
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>

        {/* Year pill selector */}
        <div className="flex items-center bg-neutral-800/80 border border-white/10 rounded-xl p-1 gap-0.5">
          {yearWindow.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`px-2 py-1 sm:px-3.5 sm:py-1.5 text-xs sm:text-sm font-mono font-medium rounded-lg transition-colors ${
                y === year
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {y}
            </button>
          ))}
          {/* Overflow year — show selected year if outside window */}
          {showMoreYears && (
            <button className="px-2 py-1 sm:px-3.5 sm:py-1.5 text-xs sm:text-sm font-mono font-medium rounded-lg bg-neutral-700 text-white">
              {year}
            </button>
          )}
          <select
            value={yearWindow.includes(year) ? "" : year}
            onChange={(e) => e.target.value && setYear(Number(e.target.value))}
            className="appearance-none bg-neutral-800 text-neutral-200 text-xs pl-1 pr-2 cursor-pointer focus:outline-none"
            aria-label="More years"
          >
            <option value="">…</option>
            {Array.from({ length: currentYear - 1979 }, (_, i) => currentYear - i)
              .filter((y) => !yearWindow.includes(y))
              .map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
          </select>
        </div>

        {/* Month selector */}
        {mode === "monthly" && (
          <div className="flex bg-neutral-800/80 border border-white/10 rounded-xl p-1 gap-0.5 flex-wrap">
            {MONTH_NAMES.map((name, i) => (
              <button
                key={i + 1}
                onClick={() => setMonth(i + 1)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  i + 1 === month
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        )}

        <span className="flex-1" />
        <span className="font-mono text-[10px] tracking-wider text-neutral-600 uppercase">Source: TMDB</span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-32">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <p className="text-red-400">{error?.message}</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && movies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <p className="text-neutral-400">No box office data available for this period.</p>
        </div>
      )}

      {/* Content */}
      {!loading && !error && movies.length > 0 && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {[
              {
                label: "Top 10 revenue",
                value: formatMoney(kpis.totalRevenue),
                sub: `across ${movies.length} releases`,
              },
              {
                label: "Average budget",
                value: formatMoney(kpis.avgBudget),
                sub: "per top-10 title",
              },
              {
                label: "Top 10 profit",
                value: kpis.totalProfit >= 0
                  ? `+${formatMoney(kpis.totalProfit)}`
                  : `-${formatMoney(Math.abs(kpis.totalProfit))}`,
                sub: "after production budget",
                highlight: kpis.totalProfit >= 0,
              },
              {
                label: "Best margin",
                value: kpis.bestMargin.movie
                  ? `${kpis.bestMargin.ratio.toFixed(1)}×`
                  : "—",
                sub: kpis.bestMargin.movie
                  ? `${kpis.bestMargin.movie.title.split(":")[0]} · ${formatMoney(kpis.bestMargin.movie.revenue)} on ${formatMoney(kpis.bestMargin.movie.budget)}`
                  : "",
              },
            ].map((k) => (
              <div key={k.label} className="bg-neutral-800/60 border border-white/8 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3.5">
                <div className="font-mono text-[9.5px] tracking-widest text-neutral-500 uppercase">{k.label}</div>
                <div
                  className={`text-xl sm:text-3xl font-light tracking-tight leading-tight mt-1 ${k.highlight ? "text-primary-400" : "text-white"}`}
                  style={{ fontFamily: "'Georgia', serif" }}
                >
                  {k.value}
                </div>
                <div className="text-[11px] text-neutral-500 mt-1 truncate">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Hero + leaderboard */}
          <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5">
            {/* #1 hero card */}
            {hero && <HeroCard movie={hero} year={year} mode={mode} month={month} />}

            {/* Leaderboard table */}
            <div className="bg-neutral-800/60 border border-white/8 rounded-2xl overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[36px_52px_1fr_100px] sm:grid-cols-[44px_64px_1fr_110px_96px_120px] gap-0 items-center px-4 sm:px-5 py-3 border-b border-white/8 font-mono text-[9.5px] text-neutral-500 tracking-widest uppercase">
                <span>#</span>
                <span></span>
                <span>Movie</span>
                <span className="text-right">Revenue</span>
                <span className="text-right hidden sm:block">Budget</span>
                <span className="text-right hidden sm:block">Profit / Loss</span>
              </div>

              {/* Rows */}
              {movies.map((movie, i) => {
                const profit = movie.revenue - movie.budget;
                const positive = profit >= 0;
                const ratio = movie.budget > 0 ? movie.revenue / movie.budget : 0;
                const rankColor =
                  movie.rank === 1 ? "text-amber-400" :
                  movie.rank === 2 ? "text-neutral-200" :
                  movie.rank === 3 ? "text-amber-700" :
                  "text-neutral-500";
                const rankSize =
                  movie.rank <= 3 ? "text-3xl" : "text-2xl";

                const revenueClass =
                  movie.rank === 1
                    ? "font-mono text-base font-bold text-primary-400 text-right"
                    : movie.rank <= 3
                      ? "font-mono text-sm font-semibold text-white text-right"
                      : "font-mono text-sm text-neutral-300 text-right";

                return (
                  <Link
                    key={movie.id}
                    to={`/movie/${movie.id}`}
                    className="grid grid-cols-[36px_52px_1fr_100px] sm:grid-cols-[44px_64px_1fr_110px_96px_120px] gap-0 items-center px-4 sm:px-5 py-3 hover:bg-white/[0.03] transition-colors border-b border-white/5 last:border-0"
                  >
                    <span
                      className={`font-light tracking-tight leading-none ${rankColor} ${rankSize}`}
                      style={{ fontFamily: "'Georgia', serif", fontStyle: movie.rank === 1 ? "italic" : "normal" }}
                    >
                      {movie.rank}
                    </span>

                    <div className="w-10 h-[60px] sm:w-12 sm:h-[72px] rounded overflow-hidden bg-neutral-700 flex-shrink-0">
                      {movie.poster_path ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w92${movie.poster_path}`}
                          alt={movie.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs">?</div>
                      )}
                    </div>

                    <div className="min-w-0 px-2 sm:px-3">
                      <p className="text-sm font-semibold text-white line-clamp-1 leading-snug tracking-tight">
                        {movie.title}
                      </p>
                      {movie.release_date && (
                        <p className="font-mono text-[10.5px] text-neutral-500 mt-1 tracking-wide">
                          {new Date(movie.release_date + "T00:00:00").toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      )}
                    </div>

                    <span className={revenueClass}>
                      {formatMoney(movie.revenue)}
                    </span>

                    <span className="hidden sm:block font-mono text-sm text-neutral-400 text-right">
                      {movie.budget > 0 ? formatMoney(movie.budget) : "—"}
                    </span>

                    <div className="hidden sm:block text-right">
                      {movie.budget > 0 ? (
                        <>
                          <div className={`font-mono text-sm font-semibold ${positive ? "text-emerald-400" : "text-red-400"}`}>
                            {positive ? "+" : "-"}{formatMoney(Math.abs(profit))}
                          </div>
                          <div className="font-mono text-[9.5px] text-neutral-600 mt-0.5">
                            {ratio.toFixed(1)}× return
                          </div>
                        </>
                      ) : (
                        <span className="font-mono text-sm text-neutral-600">—</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      <p className="text-[11px] text-neutral-600 mt-8 text-center italic">
        Revenue and budget figures sourced from TMDB. Some titles may have incomplete data.
      </p>
    </div>
  );
}

function HeroCard({ movie, year, mode, month }: { movie: BoxOfficeMovie; year: number; mode: "yearly" | "monthly"; month: number }) {
  const profit = movie.revenue - movie.budget;
  const ratio = movie.budget > 0 ? movie.revenue / movie.budget : 0;
  const genreLabel = movie.genres?.slice(0, 2).map((g) => g.name).join(" · ") ?? "";
  const runtime = movie.runtime
    ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`
    : "";

  return (
    <div className="bg-neutral-800/60 border border-white/8 rounded-2xl overflow-hidden flex flex-col">
      {/* Backdrop */}
      <div className="relative aspect-video overflow-hidden bg-neutral-900">
        {movie.backdrop_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w780${movie.backdrop_path}`}
            alt={movie.title}
            className="w-full h-full object-cover"
          />
        ) : movie.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w500${movie.poster_path}`}
            alt={movie.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600 text-4xl">🎬</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />

        {/* Badge */}
        <div className="absolute top-3.5 left-3.5 font-mono text-[9.5px] tracking-widest bg-black/50 backdrop-blur-sm text-white px-2.5 py-1 rounded uppercase">
          ◉ #1 of {mode === "monthly" ? `${MONTH_NAMES[month - 1]} ${year}` : year}
        </div>

        {/* Title overlay */}
        <div className="absolute left-4 right-4 bottom-4 text-white">
          <div
            className="text-3xl leading-tight tracking-tight"
            style={{ fontFamily: "'Georgia', serif", fontWeight: 400 }}
          >
            {movie.title}
          </div>
          {(genreLabel || runtime) && (
            <div className="text-xs text-white/75 mt-1.5">
              {[genreLabel, runtime].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 px-5 pt-4 pb-3">
        <Kpi label="Revenue" value={formatMoney(movie.revenue)} sub="worldwide gross" />
        <Kpi label="Budget" value={movie.budget > 0 ? formatMoney(movie.budget) : "—"} sub="production only" />
        {movie.budget > 0 && (
          <Kpi
            label="Profit"
            value={`${profit >= 0 ? "+" : "-"}${formatMoney(Math.abs(profit))}`}
            sub={`${ratio.toFixed(1)}× return`}
            highlight={profit >= 0}
          />
        )}
        {movie.vote_average > 0 && (
          <Kpi
            label="TMDb Rating"
            value={`${movie.vote_average.toFixed(1)}`}
            sub="audience score"
          />
        )}
      </div>

      {/* View button */}
      <div className="px-5 pb-5">
        <Link
          to={`/movie/${movie.id}`}
          className="block w-full text-center py-2 text-sm font-semibold bg-primary-600/20 hover:bg-primary-600/30 text-primary-400 border border-primary-600/30 rounded-lg transition-colors"
        >
          View {movie.title} →
        </Link>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] tracking-widest text-neutral-500 uppercase">{label}</div>
      <div
        className={`text-2xl font-light tracking-tight leading-tight mt-0.5 ${highlight ? "text-primary-400" : "text-white"}`}
        style={{ fontFamily: "'Georgia', serif" }}
      >
        {value}
      </div>
      <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>
    </div>
  );
}
