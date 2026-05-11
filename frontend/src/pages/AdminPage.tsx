import { Link } from "react-router-dom";
import { useAdminStats } from "../hooks/api/useAdminStats";
import { useUserMe } from "../hooks/api/useUser";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-neutral-900 border border-white/10 rounded-xl p-5">
      <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-3xl font-bold text-white">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-neutral-500 mt-1">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mt-8 mb-3">
      {title}
    </h2>
  );
}

function MiniBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-400 w-32 truncate shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-highlight-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-neutral-300 w-10 text-right shrink-0">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function GrowthChart({ data }: { data: { date: string; signups: number }[] }) {
  const max = Math.max(...data.map((d) => d.signups), 1);
  return (
    <div className="bg-neutral-900 border border-white/10 rounded-xl p-5">
      <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-4">
        Signups — last 14 days
      </p>
      {data.length === 0 ? (
        <p className="text-sm text-neutral-500">No data yet.</p>
      ) : (
        <div className="flex gap-1 h-20">
          {data.map((d) => {
            const heightPct = Math.max((d.signups / max) * 100, 4);
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center justify-end gap-1 group h-full"
                title={`${d.date}: ${d.signups}`}
              >
                <div
                  className="w-full bg-highlight-600 rounded-sm group-hover:bg-highlight-400 transition-colors"
                  style={{ height: `${heightPct}%` }}
                />
                <span className="text-[9px] text-neutral-600 rotate-45 origin-left hidden sm:block">
                  {d.date.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { data: me } = useUserMe();
  const { data: stats, isLoading, isError } = useAdminStats();

  if (me && me.subscription_tier !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-neutral-400">You don't have access to this page.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 rounded-full border-2 border-highlight-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-neutral-400">Failed to load admin stats.</p>
      </div>
    );
  }

  const { users, tracking, activity, social, top_shows, top_movies, growth } = stats;
  const totalTracked =
    tracking.total_watchlist + tracking.total_watched + tracking.total_currently_watching;
  const maxShowCount = top_shows[0]?.tracking_count ?? 1;
  const maxMovieCount = top_movies[0]?.tracking_count ?? 1;

  const activityTypeLabels: Record<string, string> = {
    watched: "Watched",
    currently_watching: "Currently Watching",
    want_to_watch: "Want to Watch",
    rated: "Rated",
    episode_watched: "Episode Watched",
  };

  const sortedActivityTypes = Object.entries(activity.by_type).sort(([, a], [, b]) => b - a);
  const maxActivityCount = sortedActivityTypes[0]?.[1] ?? 1;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
          <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2zM4 20c0-4 3.58-7 8-7s8 3 8 7H4z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-xs text-neutral-500">Release Radar site stats</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/admin/users"
            className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-sm px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6-4a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Users
          </Link>
          <Link
            to="/admin/moderation"
            className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-sm px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Moderation
          </Link>
        </div>
      </div>

      <SectionHeader title="Users" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={users.total} />
        <StatCard label="New (7d)" value={users.new_7d} />
        <StatCard label="New (30d)" value={users.new_30d} />
        <StatCard
          label="Email Notifs On"
          value={users.email_notifications_enabled}
          sub={`${users.total > 0 ? Math.round((users.email_notifications_enabled / users.total) * 100) : 0}% of users`}
        />
      </div>

      <div className="mt-3 bg-neutral-900 border border-white/10 rounded-xl p-5">
        <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">
          Subscription Tiers
        </p>
        <div className="flex flex-wrap gap-4">
          {["free", "premium", "admin"].map((tier) => {
            const count = users.tier_breakdown[tier] ?? 0;
            const colors: Record<string, string> = {
              free: "text-neutral-300",
              premium: "text-amber-400",
              admin: "text-red-400",
            };
            return (
              <div key={tier} className="flex flex-col">
                <span className={`text-2xl font-bold ${colors[tier]}`}>
                  {count.toLocaleString()}
                </span>
                <span className="text-xs text-neutral-500 capitalize">{tier}</span>
              </div>
            );
          })}
        </div>
      </div>

      <SectionHeader title="Content Tracking" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Watchlist Items" value={tracking.total_watchlist} />
        <StatCard label="Watched Items" value={tracking.total_watched} />
        <StatCard label="Episodes Watched" value={tracking.total_episodes_watched} />
        <StatCard
          label="Currently Watching"
          value={tracking.total_currently_watching}
          sub={`${totalTracked.toLocaleString()} total tracked`}
        />
      </div>

      <SectionHeader title="Activity" />
      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Total Activity" value={activity.total} />
        <StatCard label="Last 7 Days" value={activity.last_7d} />
        <StatCard label="Last 30 Days" value={activity.last_30d} />
      </div>
      {sortedActivityTypes.length > 0 && (
        <div className="bg-neutral-900 border border-white/10 rounded-xl p-5 space-y-2.5">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">
            By Type
          </p>
          {sortedActivityTypes.map(([type, count]) => (
            <MiniBar
              key={type}
              label={activityTypeLabels[type] ?? type}
              value={count}
              max={maxActivityCount}
            />
          ))}
        </div>
      )}

      <SectionHeader title="Social" />
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Friend Pairs" value={social.total_friendships} />
        <StatCard label="Followers" value={social.total_followers} />
      </div>

      <SectionHeader title="Growth" />
      <GrowthChart data={growth} />

      <SectionHeader title="Top Tracked Shows" />
      {top_shows.length === 0 ? (
        <p className="text-sm text-neutral-500">No data yet.</p>
      ) : (
        <div className="bg-neutral-900 border border-white/10 rounded-xl p-5 space-y-2.5">
          {top_shows.map((show) => (
            <MiniBar
              key={show.id}
              label={show.name}
              value={show.tracking_count}
              max={maxShowCount}
            />
          ))}
        </div>
      )}

      <SectionHeader title="Top Tracked Movies" />
      {top_movies.length === 0 ? (
        <p className="text-sm text-neutral-500">No data yet.</p>
      ) : (
        <div className="bg-neutral-900 border border-white/10 rounded-xl p-5 space-y-2.5">
          {top_movies.map((movie) => (
            <MiniBar
              key={movie.id}
              label={movie.title}
              value={movie.tracking_count}
              max={maxMovieCount}
            />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-neutral-600 mt-10">
        Data refreshes on page load · only visible to admin accounts
      </p>
    </div>
  );
}
