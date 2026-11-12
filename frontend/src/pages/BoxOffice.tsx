import { Link, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageMeta } from "../hooks/usePageMeta";
import { useBoxOffice, useAllTimeBoxOffice, type BoxOfficeMovie } from "../hooks/api/useBoxOffice";
import {
  Button,
  ButtonLink,
  ChevronLeftIcon,
  ChevronRightIcon,
  Chip,
  EmptyState,
  PageHeader,
  Segmented,
  selectClass,
} from "../components/ui";

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
  usePageMeta({ title: "Box Office", description: "See which movies are leading the box office, and track the ones you want to watch." });
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = (searchParams.get("mode") as "yearly" | "monthly" | "all-time") ?? "yearly";
  const year = Number(searchParams.get("year") ?? currentYear);
  const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);
  const allTimePage = Number(searchParams.get("page") ?? 1);

  const periodicQuery = useBoxOffice(
    mode === "all-time" ? "yearly" : mode,
    year,
    month,
    10,
  );
  const allTimeQuery = useAllTimeBoxOffice(allTimePage);

  const { data: movies = [], isPending: loading, error } =
    mode === "all-time" ? allTimeQuery : periodicQuery;

  const subtitle =
    mode === "yearly"
      ? `Top-grossing movies released in ${year}`
      : mode === "monthly"
      ? `Top-grossing movies released in ${MONTH_NAMES[month - 1]} ${year}`
      : "Highest-grossing movies of all time";

  const yearWindow = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];
  const showMoreYears = !yearWindow.includes(year);

  const hero = movies[0] ?? null;
  const kpis = calcKpis(movies);

  function setMode(m: "yearly" | "monthly" | "all-time") {
    if (m === "all-time") {
      setSearchParams({ mode: m });
    } else if (m === "monthly") {
      setSearchParams({ mode: m, year: String(year), month: String(month) });
    } else {
      setSearchParams({ mode: m, year: String(year) });
    }
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
  function setAllTimePage(p: number) {
    setSearchParams({ mode: "all-time", page: String(p) });
  }

  return (
    <div className="w-full px-4 sm:px-8 lg:px-10 py-8 pb-20">
      <div data-tour="box-office-header">
        <PageHeader title="Box office" description={subtitle} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mt-6 mb-7">
        {/* Mode toggle */}
        <Segmented
          label="Period"
          value={mode}
          onChange={setMode}
          options={[
            { value: "yearly", label: "Yearly" },
            { value: "monthly", label: "Monthly" },
            { value: "all-time", label: "All time" },
          ]}
        />

        {/* Year selector — hidden in all-time mode */}
        {mode !== "all-time" && (
          <>
            <Segmented
              label="Year"
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={[...(showMoreYears ? [year] : []), ...yearWindow].map((y) => ({
                value: String(y),
                label: <span className="tabular">{y}</span>,
              }))}
            />
            <select
              value={yearWindow.includes(year) ? "" : year}
              onChange={(e) => e.target.value && setYear(Number(e.target.value))}
              className={selectClass}
              aria-label="More years"
            >
              <option value="">More years</option>
              {Array.from({ length: currentYear - 1979 }, (_, i) => currentYear - i)
                .filter((y) => !yearWindow.includes(y))
                .map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
            </select>
          </>
        )}
      </div>

      {/* Month selector */}
      {mode === "monthly" && (
        <div role="group" aria-label="Month" className="flex flex-wrap gap-2 mb-7">
          {MONTH_NAMES.map((name, i) => (
            <Chip key={i + 1} pressed={i + 1 === month} onClick={() => setMonth(i + 1)}>
              {name.slice(0, 3)}
            </Chip>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-32">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-400 text-body">Loading…</p>
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <EmptyState title="Couldn't load box office data" description={error?.message} />
      )}

      {/* Empty */}
      {!loading && !error && movies.length === 0 && (
        <EmptyState title="No box office data" description="Nothing is available for this period." />
      )}

      {/* Content */}
      {!loading && !error && movies.length > 0 && (
        <>
          {/* Totals */}
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 mb-6">
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
              <div key={k.label} className="min-w-0">
                <dt className="text-caption text-neutral-400">{k.label}</dt>
                <dd
                  className={`tabular text-heading font-semibold leading-tight mt-1 ${k.highlight ? "text-success-400" : "text-neutral-50"}`}
                >
                  {k.value}
                </dd>
                <dd className="text-caption text-neutral-400 mt-1 truncate">{k.sub}</dd>
              </div>
            ))}
          </dl>

          {/* Hero + leaderboard */}
          <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] items-start gap-5">
            {/* #1 hero card */}
            {hero && <HeroCard movie={hero} year={year} mode={mode} month={month} />}

            {/* Leaderboard table */}
            <div className="bg-neutral-800/60 border border-white/8 rounded-surface overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[36px_52px_1fr_100px] sm:grid-cols-[44px_64px_1fr_110px_96px_120px] gap-0 items-center px-4 sm:px-5 py-3 border-b border-white/8 text-caption text-neutral-400">
                <span>#</span>
                <span></span>
                <span>Movie</span>
                <span className="text-right">Revenue</span>
                <span className="text-right hidden sm:block">Budget</span>
                <span className="text-right hidden sm:block">Profit / loss</span>
              </div>

              {/* Rows */}
              {movies.map((movie) => {
                const profit = movie.revenue - movie.budget;
                const positive = profit >= 0;
                const ratio = movie.budget > 0 ? movie.revenue / movie.budget : 0;
                const rankColor =
                  movie.rank === 1 ? "text-warning-400" :
                  movie.rank === 2 ? "text-neutral-200" :
                  movie.rank === 3 ? "text-warning-700" :
                  "text-neutral-500";
                const rankSize =
                  movie.rank <= 3 ? "text-heading" : "text-title";

                const revenueClass =
                  movie.rank === 1
                    ? "tabular text-body font-bold text-white text-right"
                    : movie.rank <= 3
                      ? "tabular text-body font-semibold text-white text-right"
                      : "tabular text-body text-neutral-300 text-right";

                return (
                  <Link
                    key={movie.id}
                    to={`/movie/${movie.id}`}
                    className="grid grid-cols-[36px_52px_1fr_100px] sm:grid-cols-[44px_64px_1fr_110px_96px_120px] gap-0 items-center px-4 sm:px-5 py-3 hover:bg-white/[0.03] transition-colors border-b border-white/5 last:border-0"
                  >
                    <span
                      className={`tabular font-semibold leading-none ${rankColor} ${rankSize}`}
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
                        <div className="w-full h-full flex items-center justify-center text-neutral-500 text-caption">?</div>
                      )}
                    </div>

                    <div className="min-w-0 px-2 sm:px-3">
                      <p className="text-body font-semibold text-white line-clamp-1 leading-snug">
                        {movie.title}
                      </p>
                      {movie.release_date && (
                        <p className="text-caption text-neutral-400 mt-1">
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

                    <span className="hidden sm:block tabular text-body text-neutral-400 text-right">
                      {movie.budget > 0 ? formatMoney(movie.budget) : "—"}
                    </span>

                    <div className="hidden sm:block text-right">
                      {movie.budget > 0 ? (
                        <>
                          <div className={`tabular text-body font-semibold ${positive ? "text-success-400" : "text-error-400"}`}>
                            {positive ? "+" : "-"}{formatMoney(Math.abs(profit))}
                          </div>
                          <div className="tabular text-caption text-neutral-500 mt-0.5">
                            {ratio.toFixed(1)}× return
                          </div>
                        </>
                      ) : (
                        <span className="text-body text-neutral-500">—</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Pagination — all-time only */}
          {mode === "all-time" && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                icon={<ChevronLeftIcon />}
                onClick={() => setAllTimePage(allTimePage - 1)}
                disabled={allTimePage <= 1}
              >
                Previous
              </Button>
              <span className="tabular text-label text-neutral-300 px-2">
                Page {allTimePage} · #{(allTimePage - 1) * 20 + 1}–{allTimePage * 20}
              </span>
              <Button
                onClick={() => setAllTimePage(allTimePage + 1)}
                disabled={allTimePage >= 20}
              >
                Next
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </>
      )}

      <p className="text-caption text-neutral-500 mt-8 text-center">
        Revenue and budget figures sourced from TMDB. Some titles may have incomplete data.
      </p>
    </div>
  );
}

function HeroCard({ movie, year, mode, month }: { movie: BoxOfficeMovie; year: number; mode: "yearly" | "monthly" | "all-time"; month: number }) {
  const profit = movie.revenue - movie.budget;
  const ratio = movie.budget > 0 ? movie.revenue / movie.budget : 0;
  const genreLabel = movie.genres?.slice(0, 2).map((g) => g.name).join(" · ") ?? "";
  const runtime = movie.runtime
    ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`
    : "";

  return (
    <div className="bg-neutral-800/60 border border-white/8 rounded-surface overflow-hidden flex flex-col">
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
          <div className="w-full h-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />

        {/* Badge */}
        <div className="absolute top-3.5 left-3.5 text-caption bg-black/60 backdrop-blur-sm text-white px-2.5 py-1 rounded">
          #{movie.rank} of {mode === "all-time" ? "all time" : mode === "monthly" ? `${MONTH_NAMES[month - 1]} ${year}` : year}
        </div>

        {/* Title overlay */}
        <div className="absolute left-4 right-4 bottom-4 text-white">
          <div className="text-heading font-semibold leading-tight">
            {movie.title}
          </div>
          {(genreLabel || runtime) && (
            <div className="text-caption text-white/75 mt-1.5">
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
            label="TMDb rating"
            value={`${movie.vote_average.toFixed(1)}`}
            sub="audience score"
          />
        )}
      </div>

      {/* View button */}
      <div className="px-5 pb-5">
        <ButtonLink to={`/movie/${movie.id}`} className="w-full">
          <span className="truncate">View {movie.title}</span>
          <ChevronRightIcon />
        </ButtonLink>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-caption text-neutral-400">{label}</div>
      <div
        className={`tabular text-heading font-semibold leading-tight mt-0.5 ${highlight ? "text-success-400" : "text-white"}`}
      >
        {value}
      </div>
      <div className="text-caption text-neutral-400 mt-0.5">{sub}</div>
    </div>
  );
}
