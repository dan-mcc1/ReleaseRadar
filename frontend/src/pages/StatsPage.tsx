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
  return `${Math.round(mins / 60).toLocaleString()}h`;
}

const PLATFORM_HUES = [160, 200, 285, 250, 30, 300, 180, 50];

function StatBlock({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
      <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 mb-5">
        <h3
          className="m-0 font-normal tracking-tight text-[22px] leading-none text-white"
          style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontStyle: "italic" }}
        >
          {title}
        </h3>
        <span className="text-xs text-neutral-500 sm:ml-auto shrink-0">{sub}</span>
      </div>
      {children}
    </div>
  );
}

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
      className="relative overflow-hidden rounded-3xl select-none w-full max-w-[360px]"
      style={{
        background: "linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 10% 20%, rgba(16,185,129,0.18) 0%, transparent 60%), radial-gradient(ellipse at 90% 80%, rgba(139,92,246,0.18) 0%, transparent 60%)",
        }}
      />
      <div className="relative z-10 p-8 flex flex-col gap-6">
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
          <div className="text-4xl font-black text-neutral-800" style={{ letterSpacing: "-0.04em" }}>
            {yearLabel}
          </div>
        </div>

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
          <p className="font-black text-white" style={{ fontSize: 52, lineHeight: 1, letterSpacing: "-0.04em" }}>
            {totalHours.toLocaleString()}
            <span className="text-3xl text-primary-400"> hrs</span>
          </p>
          <p className="text-sm text-neutral-400 mt-1">
            {stats.movies_count} movies · {stats.episodes_count} episodes
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Top Genre", val: topGenre ?? "—" },
            { label: "Top Platform", val: topPlatform ?? "—" },
            { label: "Movies", val: fmtHours(stats.movie_minutes) },
            { label: "TV Shows", val: fmtHours(stats.episode_minutes) },
          ].map(({ label, val }) => (
            <div
              key={label}
              className="rounded-xl p-4"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <p className="text-xs text-neutral-500 mb-1">{label}</p>
              <p className="text-base font-bold text-white truncate">{val}</p>
            </div>
          ))}
        </div>

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
                    {new Date(stats.longest_binge.date + "T00:00:00").toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {stats.humor_fact && (
          <p className="text-xs text-neutral-500 text-center leading-relaxed italic">
            With that time, {stats.humor_fact}.
          </p>
        )}

        <p className="text-center text-xs text-neutral-700 -mt-2">releaseradar.co</p>
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
  const streak = (
    baseStats as
      | { streak?: { current: number; longest: number; today_logged: boolean } }
      | undefined
  )?.streak;

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
            See your total watch time, top genres, top platforms, your personal Wrapped card, and
            more — Premium only.
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
  const tvPct = stats.total_minutes > 0
    ? Math.round((stats.episode_minutes / stats.total_minutes) * 100)
    : 0;
  const avgPerDayMins = selectedYear
    ? Math.round(stats.total_minutes / 365)
    : stats.available_years.length > 0
    ? Math.round(stats.total_minutes / (stats.available_years.length * 365))
    : Math.round(stats.total_minutes / 365);

  const years = stats.available_years.length > 0 ? stats.available_years : [currentYear];
  const yearLabel = selectedYear ?? "All Time";

  if (stats.total_minutes === 0) {
    return (
      <div className="text-center py-24 text-neutral-500">
        <p className="text-lg text-white mb-1">No watch history yet</p>
        <p className="text-sm">
          {selectedYear
            ? `Nothing tracked in ${selectedYear}.`
            : "Start watching to see your stats."}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full pb-12">
      {/* ── Page header ── */}
      <div className="px-4 sm:px-8 pt-8 pb-4">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
          Your year on Release Radar{username ? ` · @${username}` : ""}
        </p>
        <div className="flex items-end gap-4 flex-wrap">
          <h1
            className="text-[28px] sm:text-[44px] leading-none tracking-tight text-white m-0"
            style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 300 }}
          >
            <em className="text-primary-400 not-italic font-light">{yearLabel}</em>
            {", in hours"}
          </h1>
          <span className="flex-1" />
          {/* Year picker */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => setSelectedYear(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedYear === null
                  ? "bg-neutral-750 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              All Time
            </button>
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-colors ${
                  selectedYear === y
                    ? "bg-neutral-750 text-white"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          {/* Wrapped toggle */}
          <button
            onClick={() => setShowWrapped(!showWrapped)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-all"
          >
            {showWrapped ? "Hide card" : "Share wrapped →"}
          </button>
        </div>
      </div>

      {/* ── Wrapped card (toggle) ── */}
      {showWrapped && (
        <div className="px-4 sm:px-8 pb-4">
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-neutral-500">
              Screenshot this card to share your{" "}
              {selectedYear ? `${selectedYear} Wrapped` : "all-time stats"}
            </p>
            <div ref={cardRef}>
              <WrappedCard stats={stats} year={selectedYear} username={username} />
            </div>
          </div>
        </div>
      )}

      {/* ── Hero: total + streaks ── */}
      <div className="px-4 sm:px-8 pb-6 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-5">
        {/* Total watch time */}
        <div className="relative overflow-hidden bg-neutral-900 border border-neutral-800 rounded-2xl p-8">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(80% 60% at 80% 30%, rgba(16,185,129,0.10), transparent 65%)",
            }}
          />
          <div className="relative">
            <p className="font-mono text-[10px] tracking-[0.16em] text-neutral-500 uppercase mb-4">
              Total watch time
            </p>
            <div className="flex items-baseline gap-3">
              <span
                className="text-white leading-none"
                style={{
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontStyle: "italic",
                  fontWeight: 300,
                  fontSize: "clamp(52px, 14vw, 120px)",
                  letterSpacing: "-0.04em",
                  lineHeight: 0.9,
                }}
              >
                {totalHours.toLocaleString()}
              </span>
              <span
                className="text-primary-400"
                style={{
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontStyle: "italic",
                  fontWeight: 300,
                  fontSize: "clamp(22px, 5vw, 44px)",
                  letterSpacing: "-0.02em",
                }}
              >
                hrs
              </span>
            </div>
            <p className="text-sm text-neutral-400 mt-4 leading-relaxed">
              {stats.movies_count} movies · {stats.episodes_count} episodes · {totalDays} full days
              in front of the screen.
            </p>
            {stats.humor_fact && (
              <div className="mt-5 px-4 py-3.5 bg-neutral-950 border border-neutral-800 rounded-xl flex items-start gap-3 max-w-xl">
                <span className="text-primary-400 text-xl leading-none mt-0.5 shrink-0">"</span>
                <p className="text-[13.5px] text-neutral-200 leading-relaxed m-0">
                  With that time, {stats.humor_fact}.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Streak cards */}
        <div className="grid grid-rows-2 gap-3.5">
          {/* Current streak */}
          <div
            className="rounded-2xl p-5 flex flex-col justify-between text-white relative overflow-hidden"
            style={{
              background:
                "linear-gradient(135deg, #4a1500 0%, #1f0800 100%)",
            }}
          >
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase opacity-70 m-0">
              ● Current streak
            </p>
            <div className="flex items-baseline gap-2">
              <span
                style={{
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontStyle: "italic",
                  fontWeight: 300,
                  fontSize: "clamp(36px, 8vw, 64px)",
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                }}
              >
                {streak?.current ?? 0}
              </span>
              <span className="text-lg opacity-70">days</span>
            </div>
            <p className="text-xs opacity-75 m-0">
              {streak?.today_logged
                ? "✓ Logged today — keep it rolling"
                : streak?.current
                ? "Log something to keep it going!"
                : "Start a streak by logging something"}
            </p>
          </div>

          {/* Longest streak */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex flex-col justify-between">
            <p className="font-mono text-[10px] tracking-[0.16em] text-neutral-500 uppercase m-0">
              Longest streak
            </p>
            <div className="flex items-baseline gap-2">
              <span
                className="text-white"
                style={{
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontStyle: "italic",
                  fontWeight: 300,
                  fontSize: "clamp(32px, 7vw, 56px)",
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                }}
              >
                {streak?.longest ?? 0}
              </span>
              <span className="text-sm text-neutral-400">days</span>
            </div>
            <p className="text-xs text-neutral-500 m-0">
              {streak?.current === streak?.longest && (streak?.longest ?? 0) > 1
                ? "Personal best — you're on it now!"
                : "Personal best"}
            </p>
          </div>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="px-4 sm:px-8 pb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Movies",
            value: stats.movies_count.toLocaleString(),
            sub: fmtMins(stats.movie_minutes) + " watched",
          },
          {
            label: "Episodes",
            value: stats.episodes_count.toLocaleString(),
            sub: fmtMins(stats.episode_minutes) + " watched",
          },
          {
            label: "Binge record",
            value:
              stats.longest_binge.minutes > 0 ? fmtMins(stats.longest_binge.minutes) : "—",
            sub: stats.longest_binge.date
              ? new Date(stats.longest_binge.date + "T00:00:00").toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "No binge days yet",
          },
          {
            label: "Average / day",
            value: fmtMins(avgPerDayMins),
            sub: selectedYear ? `Over ${yearLabel}` : "All time average",
          },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-neutral-900 border border-neutral-800 rounded-xl px-5 py-4"
          >
            <p className="font-mono text-[10px] text-neutral-500 tracking-[0.13em] uppercase m-0">
              {k.label}
            </p>
            <p
              className="text-white mt-1.5 mb-1 leading-none"
              style={{
                fontFamily: "'IBM Plex Sans', sans-serif",
                fontStyle: "italic",
                fontWeight: 300,
                fontSize: 34,
                letterSpacing: "-0.02em",
              }}
            >
              {k.value}
            </p>
            <p className="text-[11.5px] text-neutral-500 m-0">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Genres + Platforms ── */}
      {(stats.top_genres.length > 0 || stats.top_platforms.length > 0) && (
        <div className="px-4 sm:px-8 pb-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          {stats.top_genres.length > 0 && (
            <StatBlock title="Top genres" sub="What you actually watched">
              <div className="space-y-4">
                {stats.top_genres.map((g, i) => {
                  const max = stats.top_genres[0].minutes;
                  const pct = Math.round((g.minutes / max) * 100);
                  return (
                    <div key={g.name}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-[13.5px] text-neutral-200 font-medium">
                          <span className="font-mono text-[10px] text-neutral-500 mr-2">
                            0{i + 1}
                          </span>
                          {g.name}
                        </span>
                        <span className="font-mono text-[11.5px] text-neutral-500">
                          {fmtHours(g.minutes)}
                        </span>
                      </div>
                      <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background:
                              i === 0
                                ? "#10b981"
                                : `oklch(0.52 0.11 ${[200, 250, 90, 285, 160][i % 5]})`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </StatBlock>
          )}

          {stats.top_platforms.length > 0 && (
            <StatBlock title="Top platforms" sub="Where you watched">
              <div className="space-y-4">
                {stats.top_platforms.map((p, i) => {
                  const max = stats.top_platforms[0].minutes;
                  const pct = Math.round((p.minutes / max) * 100);
                  const hue = PLATFORM_HUES[i % PLATFORM_HUES.length];
                  return (
                    <div key={p.name} className="flex items-center gap-3">
                      {p.logo_path ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w45${p.logo_path}`}
                          alt={p.name}
                          className="w-8 h-8 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold"
                          style={{
                            background: `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.35 0.14 ${hue}))`,
                          }}
                        >
                          {p.name[0]}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-[13.5px] text-neutral-200 font-medium truncate">
                            {p.name}
                          </span>
                          <span className="font-mono text-[11.5px] text-neutral-500 ml-2 shrink-0">
                            {fmtHours(p.minutes)}
                          </span>
                        </div>
                        <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background:
                                i === 0
                                  ? "#10b981"
                                  : `oklch(0.52 0.11 ${hue})`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </StatBlock>
          )}
        </div>
      )}

      {/* ── TV vs Movies + Wrapped mini card ── */}
      <div className="px-4 sm:px-8 pb-4 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-5">
        {/* TV vs Movies */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 mb-4">
            <h3
              className="m-0 font-normal tracking-tight text-[22px] leading-none text-white"
              style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontStyle: "italic" }}
            >
              TV vs Movies
            </h3>
            <span className="font-mono text-[11px] text-neutral-500 sm:ml-auto shrink-0">
              {tvPct}% TV · {100 - tvPct}% Movies
            </span>
          </div>

          <div className="h-7 bg-neutral-800 rounded-xl overflow-hidden flex">
            {stats.episode_minutes > 0 && (
              <div
                className="h-full flex items-center justify-end pr-3"
                style={{
                  width: `${tvPct}%`,
                  background: "#10b981",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#001a10",
                }}
              >
                {fmtHours(stats.episode_minutes)} TV
              </div>
            )}
            {stats.movie_minutes > 0 && (
              <div
                className="h-full flex items-center justify-start pl-3"
                style={{
                  width: `${100 - tvPct}%`,
                  background: "oklch(0.55 0.18 285)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#fff",
                }}
              >
                {fmtHours(stats.movie_minutes)} Movies
              </div>
            )}
          </div>

          {stats.movies_count > 0 && stats.episodes_count > 0 && (
            <p className="text-[12.5px] text-neutral-500 leading-relaxed mt-5">
              {tvPct > 60
                ? "You leaned hard into series this year"
                : tvPct > 40
                ? "A solid mix of series and films"
                : "You were mostly a cinema person this period"}
              {" — "}
              about{" "}
              <strong className="text-neutral-300 font-medium">
                {(stats.episodes_count / Math.max(1, stats.movies_count)).toFixed(1)} episodes
              </strong>{" "}
              for every movie. The average movie you watched was{" "}
              <strong className="text-neutral-300 font-medium">
                {fmtMins(Math.round(stats.movie_minutes / Math.max(1, stats.movies_count)))}
              </strong>
              , and the average TV session was{" "}
              <strong className="text-neutral-300 font-medium">
                {fmtMins(Math.round(stats.episode_minutes / Math.max(1, stats.episodes_count)))}
              </strong>
              .
            </p>
          )}
        </div>

        {/* Wrapped sidebar */}
        <div
          className="rounded-2xl p-5 relative overflow-hidden border border-neutral-800"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.20 0.09 160) 0%, oklch(0.10 0.04 230) 100%)",
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(80% 60% at 80% 20%, rgba(16,185,129,0.18), transparent 65%)",
            }}
          />
          <div className="relative flex flex-col h-full gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-[0.16em] text-white/60 uppercase m-0">
                {selectedYear ? `${selectedYear} Wrapped` : "All-Time Wrapped"}
              </p>
              <p
                className="text-primary-400 mt-1 leading-none"
                style={{
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontStyle: "italic",
                  fontWeight: 300,
                  fontSize: "clamp(24px, 6vw, 40px)",
                  letterSpacing: "-0.02em",
                }}
              >
                {totalHours.toLocaleString()} hours
              </p>
              {stats.top_genres[0] && stats.top_platforms[0] && (
                <p className="text-xs text-white/60 mt-1">
                  Top genre · {stats.top_genres[0].name} · Top platform · {stats.top_platforms[0].name}
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => setShowWrapped(!showWrapped)}
                className="flex-1 py-2 px-3 rounded-lg bg-primary-500 hover:bg-primary-400 text-neutral-950 text-sm font-semibold transition-colors"
              >
                {showWrapped ? "Hide card" : "View card →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
