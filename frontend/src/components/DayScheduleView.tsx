import { useState } from "react";
import type { Episode, Movie, Show } from "../types/calendar";
import { BASE_IMAGE_URL } from "../constants";
import { apiFetch } from "../utils/apiFetch";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  airInstant,
  formatAirTimeToLocal,
  type CalendarItem,
} from "../utils/calendarUtils";
import { setCalendarItemWatched } from "../hooks/useChunkedCalendar";
import { useAuthUser } from "../hooks/useAuthUser";

interface Props {
  items: CalendarItem[];
}

// When a timed TV item airs, in ms since the epoch (0 if unknown).
function airMillis(item: CalendarItem): number {
  if (item.type !== "tv") return 0;
  return (
    airInstant(item.air_date, item.showData.air_time, item.showData.air_timezone)?.getTime() ?? 0
  );
}

function RuntimeBadge({ minutes }: { minutes: number | null | undefined }) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <span>
      {h > 0 ? `${h}h ` : ""}
      {m > 0 ? `${m}m` : ""}
    </span>
  );
}

function getEpisodeTag(
  episodeType: string | null | undefined,
): { label: string; classes: string } | null {
  switch (episodeType) {
    case "show_premiere":
      return {
        label: "Series Premiere",
        classes:
          "bg-highlight-600/80 text-highlight-100 border border-highlight-400/50",
      };
    case "season_premiere":
      return {
        label: "Season Premiere",
        classes:
          "bg-primary-600/80 text-primary-100 border border-primary-400/50",
      };
    case "season_finale":
      return {
        label: "Season Finale",
        classes:
          "bg-warning-600/80 text-warning-100 border border-warning-400/50",
      };
    case "series_finale":
      return {
        label: "Series Finale",
        classes: "bg-error-700/80 text-error-100 border border-error-500/50",
      };
    case "mid_season":
      return {
        label: "Mid-Season Finale",
        classes:
          "bg-warning-600/80 text-warning-100 border border-warning-400/50",
      };
    default:
      return null;
  }
}

function TypeBadge({ type }: { type: "tv" | "movie" }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        type === "tv"
          ? "bg-highlight-600/20 text-highlight-400 border border-highlight-600/30"
          : "bg-amber-600/20 text-amber-400 border border-amber-600/30"
      }`}
    >
      {type === "tv" ? "TV" : "Movie"}
    </span>
  );
}

interface ItemCardProps {
  item: CalendarItem;
}

function ItemCard({ item }: ItemCardProps) {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const [marking, setMarking] = useState(false);
  const [localWatched, setLocalWatched] = useState(item.is_watched);

  const isTv = item.type === "tv";
  const contentPath = isTv
    ? `/tv/${item.showData.id}/episode/${(item as Episode & { type: "tv" }).season_number}/${(item as Episode & { type: "tv" }).episode_number}`
    : `/movie/${item.showData.id}`;
  const episodeTag = isTv
    ? getEpisodeTag((item as Episode & { type: "tv" }).episode_type)
    : null;
  const title = item.type === "tv" ? item.showData.name : item.title;
  const episodeName = isTv
    ? (item as Episode & { type: "tv"; showData: Show }).name
    : null;
  const posterPath = item.showData.poster_path;
  const backdropPath = item.showData.backdrop_path;
  const stillPath = isTv
    ? (item as Episode & { type: "tv"; showData: Show }).still_path
    : null;
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

  // Determine if the episode has aired yet
  const isReleased = (() => {
    if (!isTv) return true;
    const tvItem = item as Episode & { type: "tv"; showData: Show };
    const airDate = tvItem.air_date;
    if (!airDate) return false;
    const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
    if (airDate < todayStr) return true;
    if (airDate > todayStr) return false;
    // Same day: released once its air time has passed, if it has one.
    const aired = airInstant(
      airDate,
      tvItem.showData.air_time,
      tvItem.showData.air_timezone,
    );
    return !aired || aired.getTime() <= Date.now();
  })();

  async function handleMarkWatched(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isTv || marking || localWatched) return;
    const tvItem = item as Episode & { type: "tv"; showData: Show };
    setMarking(true);
    try {
      const res = await apiFetch(
        `/watched-episode/add?show_id=${tvItem.showData.id}&season_number=${tvItem.season_number}&episode_number=${tvItem.episode_number}`,
        { method: "POST" },
      );
      if (!res.ok) return;
      setLocalWatched(true);
      if (user) {
        setCalendarItemWatched(
          queryClient,
          user.uid,
          {
            type: "tv",
            showId: tvItem.showData.id,
            seasonNumber: tvItem.season_number,
            episodeNumber: tvItem.episode_number,
          },
          true,
        );
      }
    } catch {
      // ignore
    } finally {
      setMarking(false);
    }
  }

  return (
    <Link
      to={contentPath}
      className="group flex gap-0 bg-neutral-800 rounded-xl overflow-hidden border border-neutral-700 hover:border-neutral-500 transition-all duration-200 hover:shadow-lg hover:shadow-black/30"
    >
      {imageSrc && (
        <div
          className={`relative flex-shrink-0 ${stillPath || backdropPath ? "w-48 sm:w-56 aspect-video" : "w-24 sm:w-32"}`}
        >
          <img
            src={imageSrc}
            alt={title}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-neutral-800/20" />
          {episodeTag && (
            <span
              className={`absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded backdrop-blur-sm ${episodeTag.classes}`}
            >
              {episodeTag.label}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col justify-center px-4 py-3 min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <TypeBadge type={item.type} />
          {isTv && (
            <span className="text-neutral-500 text-xs">
              S{(item as Episode & { type: "tv" }).season_number}E
              {(item as Episode & { type: "tv" }).episode_number}
            </span>
          )}
          {episodeTag && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${episodeTag.classes}`}
            >
              {episodeTag.label}
            </span>
          )}
        </div>
        <div className="font-semibold text-neutral-100 group-hover:text-primary-300 transition-colors line-clamp-1">
          {title}
        </div>
        {episodeName && (
          <div className="text-neutral-400 text-sm mt-0.5 line-clamp-1">
            {episodeName}
          </div>
        )}
        {overview && (
          <p className="text-neutral-500 text-xs mt-1.5 line-clamp-2 hidden sm:block">
            {overview}
          </p>
        )}
        {runtime != null && runtime > 0 && (
          <div className="text-neutral-500 text-xs mt-2">
            <RuntimeBadge minutes={runtime} />
          </div>
        )}

        {/* Watched button — TV episodes only */}
        {isTv && isReleased && (
          <div className="mt-2">
            {localWatched ? (
              <span className="inline-flex items-center gap-1 text-xs text-success-400 font-medium">
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Watched
              </span>
            ) : (
              <button
                onClick={handleMarkWatched}
                disabled={marking}
                className="inline-flex items-center gap-1 bg-neutral-700 hover:bg-highlight-600 disabled:opacity-50 text-neutral-300 hover:text-white text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
              >
                {marking ? (
                  <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
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

export default function DayScheduleView({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-neutral-500 italic">Nothing scheduled for this day.</p>
    );
  }

  const allDayItems = items.filter((item) => {
    if (item.type === "movie") return true;
    return !item.showData.air_time;
  });

  const timedItems = items.filter((item) => {
    if (item.type === "movie") return false;
    return !!item.showData.air_time;
  });

  // By when they air, not by clock time: shows in different zones mix.
  timedItems.sort((a, b) => airMillis(a) - airMillis(b));

  const timedGroups: { label: string; items: CalendarItem[] }[] = [];
  for (const item of timedItems) {
    const label =
      item.type === "tv"
        ? (formatAirTimeToLocal(
            item.showData.air_time,
            item.showData.air_timezone,
            item.air_date,
          ) ?? "")
        : "";
    const existing = timedGroups.find((g) => g.label === label);
    if (existing) existing.items.push(item);
    else timedGroups.push({ label, items: [item] });
  }

  function itemKey(item: CalendarItem): string {
    if (item.type === "tv")
      return `tv_${item.showData.id}_${item.season_number}_${item.episode_number}`;
    return `movie_${item.showData.id}`;
  }

  return (
    <div className="flex flex-col gap-6">
      {allDayItems.length > 0 && (
        <div className="flex flex-col gap-3">
          {allDayItems.map((item) => (
            <ItemCard key={itemKey(item)} item={item} />
          ))}
        </div>
      )}

      {timedGroups.map(({ label, items: groupItems }) => (
        <div key={label}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm font-semibold text-primary-400 whitespace-nowrap">
              {label}
            </span>
            <div className="flex-1 h-px bg-neutral-700" />
          </div>
          <div className="flex flex-col gap-3">
            {groupItems.map((item) => (
              <ItemCard key={itemKey(item)} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
