import { useState, useRef } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { useWatchTimeStats, useUserStats, useUserMe } from "../hooks/api/useUser";
import { BASE_IMAGE_URL } from "../constants";
import { useSubscription } from "../hooks/api/useSubscription";
import { isPremiumFeature } from "../config/features";
import { useNavigate } from "react-router-dom";

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtHours(mins: number): string {
  const h = Math.round(mins / 60);
  return `${h.toLocaleString()}h`;
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`text-3xl font-bold ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-sm text-neutral-400">{sub}</p>}
    </div>
  );
}

/** The shareable card — designed to look great as a screenshot. */
function WrappedCard({
  stats,
  year,
  username,
}: {
  stats: NonNullable<ReturnType<typeof useWatchTimeStats>["data"]>;
  year: number | null;
  username: string | null;
}) {
  const topGenre = stats.top_genres[0]?.name ?? null;
  const topPlatform = stats.top_platforms[0]?.name ?? null;
  const totalHours = Math.round(stats.total_minutes / 60);
  const yearLabel = year ?? "All Time";

  return (
    <div
      className="relative overflow-hidden rounded-3xl select-none"
      style={{
        width: 360,
        background: "linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Gradient blobs */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 10% 20%, rgba(16,185,129,0.18) 0%, transparent 60%), radial-gradient(ellipse at 90% 80%, rgba(139,92,246,0.18) 0%, transparent 60%)",
        }}
      />

      <div className="relative z-10 p-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-primary-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-primary-400">
                ReleaseRadar
              </span>
            </div>
            <p className="text-2xl font-bold text-white leading-tight">
              {typeof yearLabel === "number" ? `${yearLabel} Wrapped` : "All-Time Stats"}
            </p>
            {username && (
              <p className="text-sm text-neutral-400 mt-0.5">@{username}</p>
            )}
          </div>
          {/* Big year badge */}
          <div
            className="text-4xl font-black text-neutral-800"
            style={{ letterSpacing: "-0.04em" }}
          >
            {yearLabel}
          </div>
        </div>

        {/* Hero stat */}
        <div
          className="rounded-2xl p-5 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(139,92,246,0.15))",
            border: "1px solid rgba(16,185,129,0.2)",
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">
            Total Watch Time
          </p>
          <p
            className="font-black text-white"
            style={{ fontSize: 52, lineHeight: 1, letterSpacing: "-0.04em" }}
          >
            {totalHours.toLocaleString()}
            <span className="text-3xl text-primary-400"> hrs</span>
          </p>
          <p className="text-sm text-neutral-400 mt-1">
            {stats.movies_count} movies · {stats.episodes_count} episodes
          </p>
        </div>

        {/* Grid stats */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p className="text-xs text-neutral-500 mb-1">Top Genre</p>
            <p className="text-base font-bold text-white truncate">
              {topGenre ?? "—"}
            </p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p className="text-xs text-neutral-500 mb-1">Top Platform</p>
            <p className="text-base font-bold text-white truncate">
              {topPlatform ?? "—"}
            </p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p className="text-xs text-neutral-500 mb-1">Movies</p>
            <p className="text-xl font-bold text-highlight-400">
              {fmtHours(stats.movie_minutes)}
            </p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p className="text-xs text-neutral-500 mb-1">TV Shows</p>
            <p className="text-xl font-bold text-primary-400">
              {fmtHours(stats.episode_minutes)}
            </p>
          </div>
        </div>

        {/* Longest binge */}
        {stats.longest_binge.minutes > 0 && (
          <div
            className="rounded-xl p-4 flex items-center gap-3"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-2xl">🍿</span>
            <div>
              <p className="text-xs text-neutral-500">Longest Binge Day</p>
              <p className="text-sm font-semibold text-white">
                {fmtMins(stats.longest_binge.minutes)}
                {stats.longest_binge.date && (
                  <span className="text-neutral-400 font-normal">
                    {" "}·{" "}
                    {new Date(stats.longest_binge.date + "T00:00:00").toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric" },
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Humor fact */}
        {stats.humor_fact && (
          <p className="text-xs text-neutral-500 text-center leading-relaxed italic">
            With that time, {stats.humor_fact}.
          </p>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-neutral-700 -mt-2">
          releaseradar.co
        </p>
      </div>
    </div>
  );
}

export default function StatsPage() {
  usePageTitle("Stats");
  const navigate = useNavigate();
  const userQuery = useUserMe();
  const username = userQuery.data?.username ?? null;
  const { isPremium, isLoading: subLoading } = useSubscription();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number | null>(currentYear);
  const [showWrapped, setShowWrapped] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const { data: stats, isPending, isError } = useWatchTimeStats(selectedYear);
  const { data: baseStats } = useUserStats();
  const streak = (baseStats as { streak?: { current: number; longest: number; today_logged: boolean } } | undefined)?.streak;

  if (subLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isPremiumFeature("watchTimeStats") && !isPremium) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-24 flex flex-col items-center text-center gap-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/15 border border-amber-400/30">
          <svg className="w-8 h-8 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.5 7.5L5 14h14l2.5-6.5L17 10l-5-6-5 6-4.5-2.5zm2.5 8h14v2H5v-2z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Watch Time Stats</h1>
          <p className="text-neutral-400 max-w-sm">
            See your total watch time, top genres, top platforms, your personal Wrapped card, and more — Premium only.
          </p>
        </div>
        <button
          onClick={() => navigate("/pricing")}
          className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
        >
          Upgrade to Premium
        </button>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-error-400">Could not load stats.</p>
      </div>
    );
  }

  const totalHours = Math.round(stats.total_minutes / 60);
  const totalDays = (stats.total_minutes / 1440).toFixed(1);

  const years = stats.available_years.length > 0
    ? stats.available_years
    : [currentYear];

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Your Stats</h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            Watch time, genres, platforms, and more
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Year picker */}
          <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-1 py-1">
            <button
              onClick={() => setSelectedYear(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedYear === null
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              All Time
            </button>
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedYear === y
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                {y}
              </button>
            ))}
          </div>

          {/* Wrapped button */}
          <button
            onClick={() => setShowWrapped(!showWrapped)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary-600 to-highlight-600 hover:from-primary-500 hover:to-highlight-500 text-white text-sm font-semibold transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 8h.01" />
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            </svg>
            {showWrapped ? "Hide Card" : "View Wrapped Card"}
          </button>
        </div>
      </div>

      {/* Wrapped card (shareable) */}
      {showWrapped && (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary-400" />
            <p className="text-sm text-neutral-400">
              Screenshot this card to share your{" "}
              {selectedYear ? `${selectedYear} Wrapped` : "all-time stats"}
            </p>
          </div>
          <div className="flex justify-center">
            <div ref={cardRef}>
              <WrappedCard stats={stats} year={selectedYear} username={username} />
            </div>
          </div>
        </div>
      )}

      {/* Watch streak */}
      {streak && (streak.current > 0 || streak.longest > 0) && (
        <div className="grid grid-cols-2 gap-4">
          <div
            className={`bg-neutral-900 border rounded-2xl p-5 flex items-center gap-4 ${
              streak.current > 0
                ? "border-orange-500/40"
                : "border-neutral-800"
            }`}
          >
            <span className="text-4xl flex-shrink-0" aria-hidden="true">
              {streak.current > 0 ? "🔥" : "💤"}
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Current Streak
              </p>
              <p className={`text-3xl font-bold ${streak.current > 0 ? "text-orange-400" : "text-white"}`}>
                {streak.current}
                <span className="text-base font-normal text-neutral-400 ml-1">
                  day{streak.current !== 1 ? "s" : ""}
                </span>
              </p>
              {streak.today_logged && (
                <p className="text-xs text-orange-400 mt-0.5">Logged today</p>
              )}
              {!streak.today_logged && streak.current > 0 && (
                <p className="text-xs text-neutral-500 mt-0.5">Log something to keep it going!</p>
              )}
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex items-center gap-4">
            <span className="text-4xl flex-shrink-0" aria-hidden="true">🏆</span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Longest Streak
              </p>
              <p className="text-3xl font-bold text-white">
                {streak.longest}
                <span className="text-base font-normal text-neutral-400 ml-1">
                  day{streak.longest !== 1 ? "s" : ""}
                </span>
              </p>
              {streak.current === streak.longest && streak.longest > 1 && (
                <p className="text-xs text-primary-400 mt-0.5">Personal best!</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total Hours"
          value={totalHours.toLocaleString() + "h"}
          sub={`${totalDays} days`}
          accent="text-primary-400"
        />
        <StatCard
          label="Movies"
          value={stats.movies_count.toLocaleString()}
          sub={fmtMins(stats.movie_minutes)}
          accent="text-highlight-400"
        />
        <StatCard
          label="Episodes"
          value={stats.episodes_count.toLocaleString()}
          sub={fmtMins(stats.episode_minutes)}
          accent="text-info-400"
        />
        <StatCard
          label="Binge Record"
          value={stats.longest_binge.minutes > 0 ? fmtMins(stats.longest_binge.minutes) : "—"}
          sub={
            stats.longest_binge.date
              ? new Date(stats.longest_binge.date + "T00:00:00").toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric", year: "numeric" },
                )
              : undefined
          }
          accent="text-warning-400"
        />
      </div>

      {/* Humor fact */}
      {stats.humor_fact && (
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">💡</span>
          <p className="text-sm text-neutral-300 leading-relaxed">
            With your {totalHours.toLocaleString()} hours of watch time,{" "}
            <span className="text-white font-medium">{stats.humor_fact}</span>.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Top Genres */}
        {stats.top_genres.length > 0 && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <h2 className="text-base font-semibold text-white mb-4">Top Genres</h2>
            <div className="space-y-3">
              {stats.top_genres.map((g, i) => {
                const maxMins = stats.top_genres[0].minutes;
                const pct = Math.round((g.minutes / maxMins) * 100);
                return (
                  <div key={g.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-neutral-200">{g.name}</span>
                      <span className="text-xs text-neutral-500">{fmtHours(g.minutes)}</span>
                    </div>
                    <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background:
                            i === 0
                              ? "linear-gradient(90deg, #10b981, #8b5cf6)"
                              : "rgba(16,185,129,0.4)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top Platforms */}
        {stats.top_platforms.length > 0 && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <h2 className="text-base font-semibold text-white mb-4">Top Platforms</h2>
            <div className="space-y-3">
              {stats.top_platforms.map((p, i) => {
                const maxMins = stats.top_platforms[0].minutes;
                const pct = Math.round((p.minutes / maxMins) * 100);
                return (
                  <div key={p.name} className="flex items-center gap-3">
                    {p.logo_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w45${p.logo_path}`}
                        alt={p.name}
                        className="w-7 h-7 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-neutral-700 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-neutral-200 truncate">{p.name}</span>
                        <span className="text-xs text-neutral-500 ml-2 flex-shrink-0">
                          {fmtHours(p.minutes)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background:
                              i === 0
                                ? "linear-gradient(90deg, #8b5cf6, #10b981)"
                                : "rgba(139,92,246,0.4)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* TV vs Movies breakdown */}
      {stats.total_minutes > 0 && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-white mb-4">TV vs Movies</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-primary-400 w-20 text-right">
              {fmtHours(stats.episode_minutes)} TV
            </span>
            <div className="flex-1 h-4 bg-neutral-800 rounded-full overflow-hidden flex">
              {stats.episode_minutes > 0 && (
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{
                    width: `${Math.round((stats.episode_minutes / stats.total_minutes) * 100)}%`,
                  }}
                />
              )}
              {stats.movie_minutes > 0 && (
                <div
                  className="h-full bg-highlight-500 transition-all"
                  style={{
                    width: `${Math.round((stats.movie_minutes / stats.total_minutes) * 100)}%`,
                  }}
                />
              )}
            </div>
            <span className="text-sm text-highlight-400 w-24">
              {fmtHours(stats.movie_minutes)} Movies
            </span>
          </div>
        </div>
      )}

      {stats.total_minutes === 0 && (
        <div className="text-center py-16 text-neutral-500">
          <p className="text-lg">No watch history yet</p>
          <p className="text-sm mt-1">
            {selectedYear ? `Nothing tracked in ${selectedYear}.` : "Start watching to see your stats."}
          </p>
        </div>
      )}
    </div>
  );
}
