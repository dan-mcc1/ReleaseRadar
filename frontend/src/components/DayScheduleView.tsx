import { useState } from "react";
import type { Episode, Movie, Show } from "../types/calendar";
import { API_URL, BASE_IMAGE_URL } from "../constants";
import { Link } from "react-router-dom";
import type { CalendarItem } from "./Calendar";

interface Props {
  items: CalendarItem[];
  watchedEpisodeKeys?: Set<string>;
  token?: string | null;
  onMarkWatched?: (showId: number, season: number, episode: number) => void;
}

const TZ_ABBR: Record<string, string> = {
  "America/New_York": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Los_Angeles": "PT",
  "America/Phoenix": "MT",
  "Europe/London": "GMT",
  "Europe/Paris": "CET",
  "Europe/Berlin": "CET",
  "Australia/Sydney": "AEST",
  "Australia/Melbourne": "AEST",
  "Asia/Tokyo": "JST",
};

function formatAirTime(time: string | null | undefined, timezone: string | null | undefined): string | null {
  if (!time) return null;
  const [hourStr, minuteStr] = time.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  const timeStr = minute > 0
    ? `${h12}:${String(minute).padStart(2, "0")} ${period}`
    : `${h12} ${period}`;
  const tzAbbr = timezone ? TZ_ABBR[timezone] : null;
  return tzAbbr ? `${timeStr} ${tzAbbr}` : timeStr;
}

function airTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function RuntimeBadge({ minutes }: { minutes: number | null | undefined }) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return <span>{h > 0 ? `${h}h ` : ""}{m > 0 ? `${m}m` : ""}</span>;
}

function getEpisodeTag(episodeType: string | null | undefined): { label: string; classes: string } | null {
  switch (episodeType) {
    case "show_premiere":    return { label: "Series Premiere", classes: "bg-purple-600/80 text-purple-100 border border-purple-400/50" };
    case "season_premiere":  return { label: "Season Premiere", classes: "bg-blue-600/80 text-blue-100 border border-blue-400/50" };
    case "season_finale":    return { label: "Season Finale",   classes: "bg-orange-600/80 text-orange-100 border border-orange-400/50" };
    case "series_finale":    return { label: "Series Finale",   classes: "bg-red-700/80 text-red-100 border border-red-500/50" };
    case "mid_season":       return { label: "Mid-Season Finale", classes: "bg-yellow-600/80 text-yellow-100 border border-yellow-400/50" };
    default:                 return null;
  }
}

function TypeBadge({ type }: { type: "tv" | "movie" }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      type === "tv"
        ? "bg-purple-600/20 text-purple-400 border border-purple-600/30"
        : "bg-amber-600/20 text-amber-400 border border-amber-600/30"
    }`}>
      {type === "tv" ? "TV" : "Movie"}
    </span>
  );
}

interface ItemCardProps {
  item: CalendarItem;
  isWatched?: boolean;
  token?: string | null;
  onMarkWatched?: (showId: number, season: number, episode: number) => void;
}

function ItemCard({ item, isWatched, token, onMarkWatched }: ItemCardProps) {
  const [marking, setMarking] = useState(false);
  const [localWatched, setLocalWatched] = useState(isWatched ?? false);

  const isTv = item.type === "tv";
  const contentPath = isTv
    ? `/tv/${item.showData.id}/episode/${(item as Episode & { type: "tv" }).season_number}/${(item as Episode & { type: "tv" }).episode_number}`
    : `/movie/${item.showData.id}`;
  const episodeTag = isTv
    ? getEpisodeTag((item as Episode & { type: "tv" }).episode_type)
    : null;
  const title = isTv ? item.showData.name : (item as any).title;
  const episodeName = isTv ? (item as Episode & { type: "tv"; showData: Show }).name : null;
  const posterPath = item.showData.poster_path;
  const backdropPath = item.showData.backdrop_path;
  const stillPath = isTv ? (item as Episode & { type: "tv"; showData: Show }).still_path : null;
  const overview = isTv
    ? (item as Episode & { type: "tv"; showData: Show }).overview
    : (item.showData as Movie).overview;
  const runtime = isTv
    ? (item as Episode & { type: "tv"; showData: Show }).runtime
    : (item as { runtime: number }).runtime;

  const imageSrc = stillPath
    ? `${BASE_IMAGE_URL}/w500${stillPath}`
    : backdropPath
    ? `${BASE_IMAGE_URL}/w500${backdropPath}`
    : posterPath
    ? `${BASE_IMAGE_URL}/w300${posterPath}`
    : null;

  async function handleMarkWatched(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isTv || !token || marking || localWatched) return;
    const tvItem = item as Episode & { type: "tv"; showData: Show };
    setMarking(true);
    try {
      await fetch(
        `${API_URL}/watched-episode/add?show_id=${tvItem.showData.id}&season_number=${tvItem.season_number}&episode_number=${tvItem.episode_number}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      setLocalWatched(true);
      onMarkWatched?.(tvItem.showData.id, tvItem.season_number, tvItem.episode_number);
    } catch {
      // ignore
    } finally {
      setMarking(false);
    }
  }

  return (
    <Link
      to={contentPath}
      className="group flex gap-0 bg-slate-800 rounded-xl overflow-hidden border border-slate-700 hover:border-slate-500 transition-all duration-200 hover:shadow-lg hover:shadow-black/30"
    >
      {imageSrc && (
        <div className={`relative flex-shrink-0 ${stillPath || backdropPath ? "w-48 sm:w-56 aspect-video" : "w-24 sm:w-32"}`}>
          <img src={imageSrc} alt={title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-slate-800/20" />
          {episodeTag && (
            <span className={`absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded backdrop-blur-sm ${episodeTag.classes}`}>
              {episodeTag.label}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col justify-center px-4 py-3 min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <TypeBadge type={item.type} />
          {isTv && (
            <span className="text-slate-500 text-xs">
              S{(item as Episode & { type: "tv" }).season_number}E{(item as Episode & { type: "tv" }).episode_number}
            </span>
          )}
          {episodeTag && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${episodeTag.classes}`}>
              {episodeTag.label}
            </span>
          )}
        </div>
        <div className="font-semibold text-slate-100 group-hover:text-blue-300 transition-colors line-clamp-1">
          {title}
        </div>
        {episodeName && (
          <div className="text-slate-400 text-sm mt-0.5 line-clamp-1">{episodeName}</div>
        )}
        {overview && (
          <p className="text-slate-500 text-xs mt-1.5 line-clamp-2 hidden sm:block">{overview}</p>
        )}
        {runtime != null && runtime > 0 && (
          <div className="text-slate-500 text-xs mt-2">
            <RuntimeBadge minutes={runtime} />
          </div>
        )}

        {/* Watched button — TV episodes only */}
        {isTv && token && (
          <div className="mt-2">
            {localWatched ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Watched
              </span>
            ) : (
              <button
                onClick={handleMarkWatched}
                disabled={marking}
                className="inline-flex items-center gap-1 bg-slate-700 hover:bg-purple-600 disabled:opacity-50 text-slate-300 hover:text-white text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
              >
                {marking ? (
                  <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {marking ? "Saving…" : "Mark Watched"}
              </button>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

export default function DayScheduleView({ items, watchedEpisodeKeys, token, onMarkWatched }: Props) {
  if (items.length === 0) {
    return <p className="text-slate-500 italic">Nothing scheduled for this day.</p>;
  }

  const allDayItems = items.filter((item) => {
    if (item.type === "movie") return true;
    return !item.showData.air_time;
  });

  const timedItems = items.filter((item) => {
    if (item.type === "movie") return false;
    return !!item.showData.air_time;
  });

  timedItems.sort((a, b) => {
    const aTime = a.type === "tv" ? a.showData.air_time ?? "" : "";
    const bTime = b.type === "tv" ? b.showData.air_time ?? "" : "";
    return airTimeToMinutes(aTime) - airTimeToMinutes(bTime);
  });

  const timedGroups: { label: string; items: CalendarItem[] }[] = [];
  for (const item of timedItems) {
    const label = item.type === "tv"
      ? formatAirTime(item.showData.air_time, item.showData.air_timezone) ?? ""
      : "";
    const existing = timedGroups.find((g) => g.label === label);
    if (existing) existing.items.push(item);
    else timedGroups.push({ label, items: [item] });
  }

  function isWatched(item: CalendarItem): boolean {
    if (item.type !== "tv" || !watchedEpisodeKeys) return false;
    return watchedEpisodeKeys.has(
      `${item.showData.id}_${item.season_number}_${item.episode_number}`
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {allDayItems.length > 0 && (
        <div className="flex flex-col gap-3">
          {allDayItems.map((item, idx) => (
            <ItemCard
              key={idx}
              item={item}
              isWatched={isWatched(item)}
              token={token}
              onMarkWatched={onMarkWatched}
            />
          ))}
        </div>
      )}

      {timedGroups.map(({ label, items: groupItems }) => (
        <div key={label}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm font-semibold text-blue-400 whitespace-nowrap">{label}</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>
          <div className="flex flex-col gap-3">
            {groupItems.map((item, idx) => (
              <ItemCard
                key={idx}
                item={item}
                isWatched={isWatched(item)}
                token={token}
                onMarkWatched={onMarkWatched}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
