import { useUserStats } from "../hooks/api/useUser";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CheckIcon, SectionHeader } from "./ui";

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
  streak?: {
    current: number;
    longest: number;
    today_logged: boolean;
  };
}

// Recharts takes a colour value, not a class: warning-400 for ratings.
const RATING_BAR_COLOR = "#fbbf24";

function StatItem({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div>
      <dt className="text-caption text-neutral-400">{label}</dt>
      <dd className="mt-1 text-heading font-semibold text-neutral-50 tabular">{value}</dd>
      {sub && <dd className="text-caption text-neutral-400">{sub}</dd>}
    </div>
  );
}

export default function StatsSection() {
  const { data, isLoading } = useUserStats();
  const stats = data as Stats | undefined;

  if (isLoading) {
    return (
      <section className="space-y-4">
        <SectionHeader title="Stats" />
        <div className="h-32 flex items-center justify-center text-neutral-400 text-body">
          Loading stats…
        </div>
      </section>
    );
  }

  if (!stats) return null;

  const { counts, ratings, top_genres, streak } = stats;
  const totalWatched = counts.movies_watched + counts.shows_watched;
  const hasRatings = ratings.distribution.some((d) => d.count > 0);
  const hasGenres = top_genres.length > 0;

  return (
    <section className="space-y-6">
      <SectionHeader title="Stats" />

      {/* Watch streak */}
      {streak && (streak.current > 0 || streak.longest > 0) && (
        <p className="text-body text-neutral-300">
          <span className="font-semibold text-neutral-50 tabular">{streak.current}</span>{" "}
          day{streak.current !== 1 ? "s" : ""} current streak
          {streak.today_logged && (
            <span className="ml-2 inline-flex items-center gap-1 text-primary-300">
              <CheckIcon className="w-3.5 h-3.5" />
              Logged today
            </span>
          )}
          {streak.longest > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-neutral-50 tabular">{streak.longest}</span>{" "}
              day{streak.longest !== 1 ? "s" : ""} longest
            </>
          )}
        </p>
      )}

      {/* Summary counts */}
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-5">
        <StatItem label="Movies watched" value={counts.movies_watched} />
        <StatItem label="Shows watched" value={counts.shows_watched} />
        <StatItem label="Episodes watched" value={counts.episodes_watched} />
        <StatItem
          label="On watchlist"
          value={counts.movies_watchlist + counts.shows_watchlist}
          sub={`${counts.movies_watchlist} movies · ${counts.shows_watchlist} shows`}
        />
        <StatItem label="Total watched" value={totalWatched} sub="movies + shows" />
      </dl>

      {/* Average ratings */}
      {(ratings.movie_avg !== null || ratings.show_avg !== null) && (
        <p className="text-body text-neutral-400">
          {ratings.movie_avg !== null && (
            <>
              Average movie rating{" "}
              <span className="font-semibold text-neutral-50 tabular">{ratings.movie_avg}</span>/5
            </>
          )}
          {ratings.movie_avg !== null && ratings.show_avg !== null && " · "}
          {ratings.show_avg !== null && (
            <>
              Average show rating{" "}
              <span className="font-semibold text-neutral-50 tabular">{ratings.show_avg}</span>/5
            </>
          )}
        </p>
      )}

      {/* Rating distribution */}
      {hasRatings && (
        <div>
          <SectionHeader title="Rating distribution" as="h3" className="mb-3" />
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
                  `${label} out of 5`
                }
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} fill={RATING_BAR_COLOR} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top genres */}
      {hasGenres && (
        <div>
          <SectionHeader title="Favorite genres" as="h3" className="mb-3" />
          <div className="space-y-2">
            {top_genres.map((genre) => {
              const max = top_genres[0].count;
              const pct = Math.round((genre.count / max) * 100);
              return (
                <div key={genre.name} className="flex items-center gap-3">
                  <span className="text-neutral-300 text-label w-28 shrink-0 truncate">
                    {genre.name}
                  </span>
                  <div className="flex-1 bg-neutral-700 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-neutral-400 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-neutral-400 text-label w-6 text-right shrink-0 tabular">
                    {genre.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {totalWatched === 0 && (
        <p className="text-neutral-400 text-body text-center py-4">
          Watch some movies and shows to see your stats here.
        </p>
      )}
    </section>
  );
}
