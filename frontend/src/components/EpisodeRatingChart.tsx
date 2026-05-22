import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryFetch } from "../hooks/api/queryFetch";

interface EpisodePoint {
  episode_number: number;
  name: string;
  vote_average: number | null;
}

interface SeasonRatings {
  season_number: number;
  episodes: EpisodePoint[];
}

interface TooltipState {
  season: number;
  episode: number;
  name: string;
  clientX: number;
  clientY: number;
}

function ratingToColor(rating: number): string {
  // 0–4 red → 4–6 orange → 6–7 yellow → 7–8 lime → 8–10 emerald
  if (rating <= 0) return "#262626"; // no rating
  const clamped = Math.max(0, Math.min(10, rating));

  type Stop = [number, [number, number, number]];
  const stops: Stop[] = [
    [0,  [127, 29,  29]],  // red-900
    [4,  [185, 28,  28]],  // red-700
    [5,  [234, 88,  12]],  // orange-600
    [6,  [202, 138, 4]],   // yellow-600
    [7,  [101, 163, 13]],  // lime-600
    [8,  [16,  185, 129]], // emerald-500
    [10, [6,   95,  70]],  // emerald-900
  ];

  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i][0] && clamped <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }

  const t = (clamped - lo[0]) / (hi[0] - lo[0]);
  const r = Math.round(lo[1][0] + t * (hi[1][0] - lo[1][0]));
  const g = Math.round(lo[1][1] + t * (hi[1][1] - lo[1][1]));
  const b = Math.round(lo[1][2] + t * (hi[1][2] - lo[1][2]));
  return `rgb(${r},${g},${b})`;
}

export default function EpisodeRatingChart({ showId }: { showId: number }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { data: seasons, isLoading } = useQuery<SeasonRatings[]>({
    queryKey: ["episode_ratings", showId],
    queryFn: () => queryFetch<SeasonRatings[]>(`/tv/${showId}/episode_ratings`),
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return null;

  const validSeasons = (seasons ?? []).filter((s) =>
    s.episodes.some((e) => e.vote_average != null && e.vote_average > 0)
  );

  if (!validSeasons.length) return null;

  const maxEps = Math.max(...validSeasons.map((s) => s.episodes.length));

  return (
    <div>
      <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-4">
        Episode Ratings
      </h2>

      <div className="bg-neutral-800/50 rounded-xl border border-neutral-700/50 p-4 overflow-x-auto relative">
        {/* Episode number header */}
        <div className="flex gap-px mb-1 ml-14">
          {Array.from({ length: maxEps }, (_, i) => (
            <div
              key={i}
              className="text-neutral-600 text-center flex-shrink-0"
              style={{ width: 44, fontSize: 10 }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Season rows */}
        <div className="flex flex-col gap-px">
          {validSeasons.map((season) => {
            const epMap = new Map(
              season.episodes.map((e) => [e.episode_number, e])
            );
            return (
              <div key={season.season_number} className="flex items-center gap-px">
                {/* Season label */}
                <div
                  className="text-neutral-500 text-right pr-2 flex-shrink-0 font-medium"
                  style={{ width: 52, fontSize: 12 }}
                >
                  S{season.season_number}
                </div>

                {/* Episode cells */}
                {Array.from({ length: maxEps }, (_, i) => {
                  const epNum = i + 1;
                  const ep = epMap.get(epNum);
                  const rating =
                    ep?.vote_average && ep.vote_average > 0
                      ? ep.vote_average
                      : null;
                  const bg = rating ? ratingToColor(rating) : "#1f1f1f";

                  return (
                    <div
                      key={epNum}
                      className="rounded-sm flex-shrink-0 cursor-default transition-transform hover:scale-110 hover:z-10 flex items-center justify-center"
                      style={{
                        width: 44,
                        height: 44,
                        backgroundColor: bg,
                        opacity: ep ? 1 : 0.15,
                      }}
                      onMouseEnter={(e) => {
                        if (!ep || !rating) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({
                          season: season.season_number,
                          episode: epNum,
                          name: ep.name ?? "",
                          clientX: rect.left + rect.width / 2,
                          clientY: rect.top,
                        });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      {rating != null && (
                        <span
                          className="font-bold leading-none select-none"
                          style={{ fontSize: 11, color: "rgba(255,255,255,0.9)" }}
                        >
                          {rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Tooltip rendered fixed so it's never clipped by overflow */}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{ left: tooltip.clientX, top: tooltip.clientY - 8, transform: "translate(-50%, -100%)" }}
          >
            <div className="bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 shadow-xl text-center whitespace-nowrap">
              <div className="text-neutral-400 text-xs mb-0.5">
                S{tooltip.season} E{tooltip.episode}
              </div>
              <div className="text-neutral-100 text-sm font-medium">{tooltip.name}</div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
