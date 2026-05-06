import { useUserStats } from "../hooks/api/useUser";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface Stats {
  counts: {
    movies_watched: number;
    shows_watched: number;
    episodes_watched: number;
    movies_watchlist: number;
    shows_watchlist: number;
  };
  ratings: {
    movie_avg: number | null;
    show_avg: number | null;
    distribution: { rating: number; count: number }[];
  };
  top_genres: { name: string; count: number }[];
}

const GENRE_COLORS = [
  "#10b981", // primary-500 (emerald)
  "#8b5cf6", // highlight-500 (purple)
  "#f59e0b", // warning-500 (yellow)
  "#ef4444", // error-500 (red)
  "#3b82f6", // info-500 (blue)
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
];

const RATING_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#f59e0b",
  4: "#22c55e",
  5: "#8b5cf6",
};

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="bg-neutral-700/50 rounded-lg p-4 flex flex-col items-center text-center">
      <span className="text-2xl font-bold text-white">{value}</span>
      <span className="text-sm text-neutral-300 mt-1">{label}</span>
      {sub && <span className="text-xs text-neutral-500 mt-0.5">{sub}</span>}
    </div>
  );
}

export default function StatsSection() {
  const { data, isLoading } = useUserStats();
  const stats = data as Stats | undefined;

  if (isLoading) {
    return (
      <div className="bg-neutral-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4 text-white">Stats</h2>
        <div className="h-32 flex items-center justify-center text-neutral-400 text-sm">
          Loading stats…
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const { counts, ratings, top_genres } = stats;
  const totalWatched = counts.movies_watched + counts.shows_watched;
  const hasRatings = ratings.distribution.some((d) => d.count > 0);
  const hasGenres = top_genres.length > 0;

  return (
    <div className="bg-neutral-800 rounded-lg p-4 space-y-6">
      <h2 className="text-lg font-semibold text-white">Stats</h2>

      {/* Summary counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Movies Watched" value={counts.movies_watched} />
        <StatCard label="Shows Watched" value={counts.shows_watched} />
        <StatCard label="Episodes Watched" value={counts.episodes_watched} />
        <StatCard
          label="On Watchlist"
          value={counts.movies_watchlist + counts.shows_watchlist}
          sub={`${counts.movies_watchlist}m · ${counts.shows_watchlist}tv`}
        />
        <StatCard
          label="Total Watched"
          value={totalWatched}
          sub="movies + shows"
        />
      </div>

      {/* Average ratings */}
      {(ratings.movie_avg !== null || ratings.show_avg !== null) && (
        <div className="flex gap-4 flex-wrap">
          {ratings.movie_avg !== null && (
            <div className="flex items-center gap-2 bg-neutral-700/50 rounded-lg px-4 py-2">
              <span className="text-neutral-400 text-sm">Avg movie rating</span>
              <span className="text-white font-semibold text-lg">
                {ratings.movie_avg}
                <span className="text-neutral-400 text-sm">/5</span>
              </span>
            </div>
          )}
          {ratings.show_avg !== null && (
            <div className="flex items-center gap-2 bg-neutral-700/50 rounded-lg px-4 py-2">
              <span className="text-neutral-400 text-sm">Avg show rating</span>
              <span className="text-white font-semibold text-lg">
                {ratings.show_avg}
                <span className="text-neutral-400 text-sm">/5</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Rating distribution */}
      {hasRatings && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-3">
            Rating Distribution
          </h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={ratings.distribution}
              margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="rating"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                contentStyle={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  fontSize: 13,
                }}
                labelStyle={{ color: "#f1f5f9", fontWeight: 600 }}
                itemStyle={{ color: "#60a5fa" }}
                formatter={(value) => [value ?? 0, "Ratings"]}
                labelFormatter={(label) =>
                  `${label} ${"★".repeat(Number(label))}${"☆".repeat(5 - Number(label))}`
                }
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {ratings.distribution.map((entry) => (
                  <Cell
                    key={entry.rating}
                    fill={RATING_COLORS[entry.rating] ?? "#3b82f6"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top genres */}
      {hasGenres && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-3">
            Favorite Genres
          </h3>
          <div className="space-y-2">
            {top_genres.map((genre, i) => {
              const max = top_genres[0].count;
              const pct = Math.round((genre.count / max) * 100);
              return (
                <div key={genre.name} className="flex items-center gap-3">
                  <span className="text-neutral-300 text-sm w-28 shrink-0 truncate">
                    {genre.name}
                  </span>
                  <div className="flex-1 bg-neutral-700 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: GENRE_COLORS[i % GENRE_COLORS.length],
                      }}
                    />
                  </div>
                  <span className="text-neutral-400 text-sm w-6 text-right shrink-0">
                    {genre.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {totalWatched === 0 && (
        <p className="text-neutral-400 text-sm text-center py-4">
          Watch some movies and shows to see your stats here.
        </p>
      )}
    </div>
  );
}
