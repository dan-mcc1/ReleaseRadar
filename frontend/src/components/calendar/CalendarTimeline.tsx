// frontend/src/components/calendar/CalendarTimeline.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_IMAGE_URL } from "../../constants";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../../hooks/useAuthUser";
import { calendarQueryKey } from "../../hooks/useCalendarData";
import { formatAirTimeToLocal } from "../../utils/calendarUtils";
import type { CalendarItem, DayItem } from "../../utils/calendarUtils";
import type { Episode, Show } from "../../types/calendar";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function getEpisodeTag(episodeType: string | null | undefined) {
  switch (episodeType) {
    case "show_premiere":
      return { label: "Series Premiere", classes: "bg-highlight-600/80 text-highlight-100 border border-highlight-400/50" };
    case "season_premiere":
      return { label: "Season Premiere", classes: "bg-primary-600/80 text-primary-100 border border-primary-400/50" };
    case "season_finale":
      return { label: "Season Finale", classes: "bg-warning-600/80 text-warning-100 border border-warning-400/50" };
    case "series_finale":
      return { label: "Series Finale", classes: "bg-error-700/80 text-error-100 border border-error-500/50" };
    case "mid_season":
      return { label: "Mid-Season Finale", classes: "bg-warning-600/80 text-warning-100 border border-warning-400/50" };
    default:
      return null;
  }
}

function TimelineItem({ item }: { item: CalendarItem }) {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const [marking, setMarking] = useState(false);
  const [localWatched, setLocalWatched] = useState(item.is_watched);

  const isTv = item.type === "tv";
  const tvItem = isTv ? (item as Episode & { type: "tv"; showData: Show }) : null;

  const title = item.type === "tv" ? item.showData.name : item.title;
  const posterPath = item.showData.poster_path;
  const backdropPath = item.showData.backdrop_path;
  const logoPath = item.showData.logo_path;
  const contentPath = isTv
    ? `/tv/${item.showData.id}/episode/${tvItem!.season_number}/${tvItem!.episode_number}`
    : `/movie/${item.showData.id}`;
  const airTime = isTv
    ? formatAirTimeToLocal(item.showData.air_time, item.showData.air_timezone)
    : null;
  const episodeTag = isTv ? getEpisodeTag(tvItem!.episode_type) : null;

  const imageSrc = posterPath
    ? `${BASE_IMAGE_URL}/w185${posterPath}`
    : backdropPath
      ? `${BASE_IMAGE_URL}/w300${backdropPath}`
      : null;

  async function handleToggleWatched(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isTv || marking || !tvItem) return;
    const wasWatched = localWatched;
    setLocalWatched(!wasWatched);
    setMarking(true);
    try {
      if (wasWatched) {
        await apiFetch(
          `/watched-episode/remove?show_id=${tvItem.showData.id}&season_number=${tvItem.season_number}&episode_number=${tvItem.episode_number}`,
          { method: "DELETE" },
        );
      } else {
        await apiFetch(
          `/watched-episode/add?show_id=${tvItem.showData.id}&season_number=${tvItem.season_number}&episode_number=${tvItem.episode_number}`,
          { method: "POST" },
        );
      }
      if (user) queryClient.invalidateQueries({ queryKey: calendarQueryKey(user.uid) });
    } catch {
      setLocalWatched(wasWatched);
    } finally {
      setMarking(false);
    }
  }

  return (
    <Link
      to={contentPath}
      className="group flex items-center gap-3 bg-neutral-800/60 hover:bg-neutral-800 border border-neutral-700/50 hover:border-neutral-600 rounded-xl px-3 py-2.5 transition-all duration-150"
    >
      {/* Poster */}
      <div className="relative flex-shrink-0 w-9 h-[54px] rounded-md overflow-hidden bg-neutral-700">
        {imageSrc && (
          <img src={imageSrc} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        {!imageSrc && logoPath && (
          <div className="absolute inset-0 flex items-center justify-center p-1 bg-neutral-800">
            <img
              src={`${BASE_IMAGE_URL}/w185${logoPath}`}
              alt={title}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-neutral-100 group-hover:text-primary-300 transition-colors line-clamp-1 leading-tight">
          {title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {isTv && tvItem && (
            <span className="font-mono text-xs text-neutral-500">
              S{String(tvItem.season_number).padStart(2, "0")}E{String(tvItem.episode_number).padStart(2, "0")}
            </span>
          )}
          {airTime && (
            <span className="font-mono text-xs text-neutral-500">{airTime}</span>
          )}
          {episodeTag && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${episodeTag.classes}`}>
              {episodeTag.label}
            </span>
          )}
          {!isTv && (
            <span className="text-xs text-amber-400/80 font-medium">Movie</span>
          )}
        </div>
        {tvItem?.name && (
          <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1 leading-tight">
            {tvItem.name}
          </p>
        )}
      </div>

      {/* Watched toggle (TV only) */}
      {isTv && (
        <button
          onClick={handleToggleWatched}
          disabled={marking}
          title={localWatched ? "Mark as unwatched" : "Mark as watched"}
          className={`flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${
            localWatched
              ? "bg-primary-500 border-primary-500 text-neutral-950 hover:bg-transparent hover:border-neutral-700 hover:text-neutral-600"
              : "border-neutral-700 text-neutral-600 hover:border-primary-500 hover:text-primary-400"
          } ${marking ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          {marking ? (
            <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}
    </Link>
  );
}

function SkeletonRow() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 bg-neutral-800/40 border border-neutral-700/30 rounded-xl px-3 py-2.5 animate-pulse">
          <div className="w-9 h-[54px] rounded-md bg-neutral-700 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-neutral-700 rounded w-2/3" />
            <div className="h-2.5 bg-neutral-700 rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface Props {
  weekDays: DayItem[];
  today: Date;
  isLoading: boolean;
}

export default function CalendarTimeline({ weekDays, today, isLoading }: Props) {
  return (
    <div className="flex flex-col divide-y divide-neutral-800 border border-neutral-800 rounded-2xl overflow-hidden bg-neutral-900">
      {weekDays.map((day) => {
        const isToday = day.date.toDateString() === today.toDateString();
        const items = day.items ?? [];

        return (
          <div
            key={day.date.toISOString()}
            className={`grid gap-5 px-5 py-5 ${isToday ? "bg-primary-500/5" : ""}`}
            style={{ gridTemplateColumns: "80px 1fr" }}
          >
            {/* Date column */}
            <div className="flex flex-col">
              <span
                className={`font-mono text-[10px] tracking-[0.12em] uppercase ${isToday ? "text-primary-400" : "text-neutral-500"}`}
              >
                {DOW[day.date.getDay()]}
              </span>
              <span
                className={`leading-none mt-1 ${isToday ? "text-primary-400" : "text-neutral-100"}`}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 36,
                  letterSpacing: "-0.02em",
                  fontStyle: isToday ? "italic" : "normal",
                }}
              >
                {day.date.getDate()}
              </span>
              <span className="font-mono text-[10px] text-neutral-600 mt-1">
                {MONTH_SHORT[day.date.getMonth()]}
              </span>
            </div>

            {/* Items column */}
            <div className="flex flex-col justify-center">
              {isLoading ? (
                <SkeletonRow />
              ) : items.length === 0 ? (
                <p className="text-sm text-neutral-600 italic self-center">No releases</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {items.map((item, idx) => (
                    <TimelineItem
                      key={
                        item.type === "tv"
                          ? `tv_${item.showData.id}_${item.season_number}_${item.episode_number}`
                          : `movie_${item.showData.id}_${idx}`
                      }
                      item={item}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
