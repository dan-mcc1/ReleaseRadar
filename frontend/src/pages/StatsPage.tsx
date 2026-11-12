import { useState, useRef } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { useWatchTimeStats, useUserStats, useUserMe } from "../hooks/api/useUser";
import { BASE_IMAGE_URL } from "../constants";
import { useSubscription } from "../hooks/api/useSubscription";
import { isPremiumFeature } from "../config/features";
import {
  Button,
  ButtonLink,
  Card,
  CheckIcon,
  EmptyState,
  PageHeader,
  SectionHeader,
  selectClass,
} from "../components/ui";

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
    <Card>
      <SectionHeader title={title} note={sub} divider className="mb-5" />
      {children}
    </Card>
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
              <span className="text-xs font-semibold uppercase tracking-widest text-primary-400"> {/* design-ok: shareable Wrapped card */}
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
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1"> {/* design-ok: shareable Wrapped card */}
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
      <EmptyState
        className="py-24"
        title="Watch time stats"
        description="See your total watch time, top genres, top platforms, your personal Wrapped card, and more. Premium only."
        action={
          <ButtonLink to="/pricing" variant="primary">
            Upgrade to Premium
          </ButtonLink>
        }
      />
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
    return <EmptyState title="Couldn't load stats" description="Try again in a moment." />;
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
  const yearLabel = selectedYear ?? "All time";

  if (stats.total_minutes === 0) {
    return (
      <EmptyState
        className="py-24"
        title="No watch history yet"
        description={
          selectedYear
            ? `Nothing tracked in ${selectedYear}.`
            : "Start watching to see your stats."
        }
      />
    );
  }

  const kpis = [
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
      value: stats.longest_binge.minutes > 0 ? fmtMins(stats.longest_binge.minutes) : "—",
      sub: stats.longest_binge.date
        ? new Date(stats.longest_binge.date + "T00:00:00").toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "No binge days yet",
    },
    {
      label: "Average per day",
      value: fmtMins(avgPerDayMins),
      sub: selectedYear ? `Over ${yearLabel}` : "All time average",
    },
  ];

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <PageHeader
        title={`${yearLabel}, in hours`}
        description={`Your year on ReleaseRadar${username ? ` · @${username}` : ""}`}
        actions={
          <>
            <label htmlFor="stats-year" className="sr-only">
              Year
            </label>
            <select
              id="stats-year"
              value={selectedYear === null ? "" : String(selectedYear)}
              onChange={(e) => setSelectedYear(e.target.value === "" ? null : Number(e.target.value))}
              className={selectClass}
            >
              <option value="">All time</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={() => setShowWrapped(!showWrapped)}>
              {showWrapped ? "Hide card" : "Share wrapped"}
            </Button>
          </>
        }
      />

      {/* ── Wrapped card (toggle) ── */}
      {showWrapped && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-caption text-neutral-400">
            Screenshot this card to share your{" "}
            {selectedYear ? `${selectedYear} Wrapped` : "all-time stats"}
          </p>
          <div ref={cardRef}>
            <WrappedCard stats={stats} year={selectedYear} username={username} />
          </div>
        </div>
      )}

      {/* ── Total + streaks ── */}
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-5">
        <Card>
          <SectionHeader title="Total watch time" className="mb-4" />
          <div className="flex items-baseline gap-2">
            <span className="text-display font-semibold text-neutral-50 tabular">
              {totalHours.toLocaleString()}
            </span>
            <span className="text-title text-neutral-400">hours</span>
          </div>
          <p className="text-body text-neutral-400 mt-3 leading-relaxed">
            {stats.movies_count} movies · {stats.episodes_count} episodes · {totalDays} full days
            in front of the screen.
          </p>
          {stats.humor_fact && (
            <p className="mt-4 text-label text-neutral-300 leading-relaxed max-w-xl">
              With that time, {stats.humor_fact}.
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-5">
          <div>
            <SectionHeader title="Current streak" as="h3" />
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-heading font-semibold text-neutral-50 tabular">
                {streak?.current ?? 0}
              </span>
              <span className="text-body text-neutral-400">days</span>
            </p>
            <p
              className={
                streak?.today_logged
                  ? "mt-1 flex items-center gap-1.5 text-label text-primary-300"
                  : "mt-1 text-label text-neutral-400"
              }
            >
              {streak?.today_logged ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5" />
                  Logged today, keep it rolling
                </>
              ) : streak?.current ? (
                "Log something to keep it going"
              ) : (
                "Start a streak by logging something"
              )}
            </p>
          </div>
          <div className="pt-5 border-t border-neutral-800">
            <SectionHeader title="Longest streak" as="h3" />
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-heading font-semibold text-neutral-50 tabular">
                {streak?.longest ?? 0}
              </span>
              <span className="text-body text-neutral-400">days</span>
            </p>
            <p className="mt-1 text-label text-neutral-400">
              {streak?.current === streak?.longest && (streak?.longest ?? 0) > 1
                ? "Personal best, and you're on it now"
                : "Personal best"}
            </p>
          </div>
        </Card>
      </div>

      {/* ── Key numbers ── */}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5 py-5 border-y border-neutral-800">
        {kpis.map((k) => (
          <div key={k.label}>
            <dt className="text-caption text-neutral-400">{k.label}</dt>
            <dd className="mt-1 text-heading font-semibold text-neutral-50 tabular">{k.value}</dd>
            <dd className="text-caption text-neutral-400">{k.sub}</dd>
          </div>
        ))}
      </dl>

      {/* ── Genres + Platforms ── */}
      {(stats.top_genres.length > 0 || stats.top_platforms.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {stats.top_genres.length > 0 && (
            <StatBlock title="Top genres" sub="What you actually watched">
              <div className="space-y-4">
                {stats.top_genres.map((g) => {
                  const max = stats.top_genres[0].minutes;
                  const pct = Math.round((g.minutes / max) * 100);
                  return (
                    <div key={g.name}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-label text-neutral-200 font-medium">{g.name}</span>
                        <span className="text-caption text-neutral-400 tabular">
                          {fmtHours(g.minutes)}
                        </span>
                      </div>
                      <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-neutral-400"
                          style={{ width: `${pct}%` }}
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
                          className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-caption font-semibold"
                          style={{
                            background: `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.35 0.14 ${hue}))`,
                          }}
                        >
                          {p.name[0]}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-label text-neutral-200 font-medium truncate">
                            {p.name}
                          </span>
                          <span className="text-caption text-neutral-400 tabular ml-2 shrink-0">
                            {fmtHours(p.minutes)}
                          </span>
                        </div>
                        <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-neutral-400"
                            style={{ width: `${pct}%` }}
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

      {/* ── TV vs Movies + Wrapped ── */}
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-5">
        <Card>
          <SectionHeader
            title="TV vs movies"
            note={`${tvPct}% TV · ${100 - tvPct}% movies`}
            className="mb-4"
          />

          <div className="h-7 bg-neutral-800 rounded-control overflow-hidden flex">
            {stats.episode_minutes > 0 && (
              <div
                className="h-full flex items-center justify-end pr-3 bg-info-500 text-caption font-semibold text-neutral-950 tabular"
                style={{ width: `${tvPct}%` }}
              >
                {fmtHours(stats.episode_minutes)} TV
              </div>
            )}
            {stats.movie_minutes > 0 && (
              <div
                className="h-full flex items-center justify-start pl-3 bg-highlight-500 text-caption font-semibold text-white tabular"
                style={{ width: `${100 - tvPct}%` }}
              >
                {fmtHours(stats.movie_minutes)} movies
              </div>
            )}
          </div>

          {stats.movies_count > 0 && stats.episodes_count > 0 && (
            <p className="text-label text-neutral-400 leading-relaxed mt-5">
              {tvPct > 60
                ? "You leaned hard into series this year"
                : tvPct > 40
                ? "A solid mix of series and films"
                : "You were mostly a cinema person this period"}
              {" — "}
              about{" "}
              <strong className="text-neutral-200 font-medium">
                {(stats.episodes_count / Math.max(1, stats.movies_count)).toFixed(1)} episodes
              </strong>{" "}
              for every movie. The average movie you watched was{" "}
              <strong className="text-neutral-200 font-medium">
                {fmtMins(Math.round(stats.movie_minutes / Math.max(1, stats.movies_count)))}
              </strong>
              , and the average TV session was{" "}
              <strong className="text-neutral-200 font-medium">
                {fmtMins(Math.round(stats.episode_minutes / Math.max(1, stats.episodes_count)))}
              </strong>
              .
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <SectionHeader title={selectedYear ? `${selectedYear} Wrapped` : "All-time Wrapped"} />
          <p className="text-heading font-semibold text-neutral-50 tabular">
            {totalHours.toLocaleString()} hours
          </p>
          {stats.top_genres[0] && stats.top_platforms[0] && (
            <p className="text-label text-neutral-400">
              Top genre: {stats.top_genres[0].name}. Top platform: {stats.top_platforms[0].name}.
            </p>
          )}
          <div className="mt-auto">
            <Button onClick={() => setShowWrapped(!showWrapped)}>
              {showWrapped ? "Hide card" : "View card"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
