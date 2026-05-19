// frontend/src/components/calendar/CalendarSideRail.tsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../../constants";
import { apiFetch } from "../../utils/apiFetch";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthUser } from "../../hooks/useAuthUser";
import { calendarQueryKey } from "../../hooks/useCalendarData";
import { formatAirTimeToLocal } from "../../utils/calendarUtils";
import { useFriendsActivity } from "../../hooks/api/useActivity";
import type { CalendarItem } from "../../utils/calendarUtils";
import type { Episode, Show } from "../../types/calendar";

interface Props {
  todayItems: CalendarItem[];
  selectedDate: Date;
  selectedDateItems: CalendarItem[];
  onResetToToday: () => void;
  onSyncCalendar: () => void;
}

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

function SideRailItem({ item }: { item: CalendarItem }) {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const [marking, setMarking] = useState(false);
  const [localWatched, setLocalWatched] = useState(item.is_watched);

  useEffect(() => {
    setLocalWatched(item.is_watched);
  }, [item.is_watched]);

  const isTv = item.type === "tv";
  const tvItem = isTv
    ? (item as Episode & { type: "tv"; showData: Show })
    : null;
  const contentPath = isTv && tvItem
    ? `/tv/${item.showData.id}/episode/${tvItem.season_number}/${tvItem.episode_number}`
    : `/movie/${item.showData.id}`;

  const showTitle = isTv ? item.showData.name : (item as any).title;
  const episodeName = tvItem?.name ?? null;
  const overview = tvItem?.overview ?? (item.showData as any).overview ?? null;
  const backdrop = item.showData.backdrop_path;
  const logo = item.showData.logo_path;
  const seasonNum = tvItem?.season_number;
  const episodeNum = tvItem?.episode_number;
  const airTime = isTv
    ? formatAirTimeToLocal(item.showData.air_time, item.showData.air_timezone)
    : null;
  const episodeTag = tvItem ? getEpisodeTag(tvItem.episode_type) : null;

  async function handleToggleWatched(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (marking) return;
    const wasWatched = localWatched;
    setLocalWatched(!wasWatched);
    setMarking(true);
    try {
      if (isTv && tvItem) {
        await apiFetch(
          wasWatched
            ? `/watched-episode/remove?show_id=${tvItem.showData.id}&season_number=${tvItem.season_number}&episode_number=${tvItem.episode_number}`
            : `/watched-episode/add?show_id=${tvItem.showData.id}&season_number=${tvItem.season_number}&episode_number=${tvItem.episode_number}`,
          { method: wasWatched ? "DELETE" : "POST" },
        );
      } else {
        await apiFetch(`/watched/${wasWatched ? "remove" : "add"}`, {
          method: wasWatched ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content_type: "movie", content_id: item.showData.id }),
        });
      }
      if (user)
        queryClient.invalidateQueries({ queryKey: calendarQueryKey(user.uid) });
    } catch {
      setLocalWatched(wasWatched);
    } finally {
      setMarking(false);
    }
  }

  // padding-bottom: 30% locks the row height to exactly the thumbnail height
  // (thumbnail is w-[20%] aspect-[2/3], so height = 20% * 3/2 = 30% of container width)
  return (
    <div className="relative overflow-hidden" style={{ paddingBottom: "30%" }}>
      <Link to={contentPath} className="absolute inset-0 flex gap-3 overflow-hidden group hover:opacity-90 transition-opacity">
        {/* Thumbnail */}
        <div className="relative w-[20%] aspect-[2/3] rounded-lg overflow-hidden flex-shrink-0 bg-neutral-800">
          {backdrop && (
            <img
              src={`${BASE_IMAGE_URL}/w780${backdrop}`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-black/40" />
          {logo && (
            <div className="absolute inset-0 flex items-center justify-center p-1">
              <img
                src={`${BASE_IMAGE_URL}/w185${logo}`}
                alt={showTitle}
                className="max-h-[35%] max-w-[85%] object-contain drop-shadow"
              />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 overflow-hidden relative">
          <p className="text-base font-semibold text-neutral-100 leading-tight truncate">
            {showTitle}
          </p>
          {episodeName && (
            <p className="text-sm text-neutral-300 mt-0.5 leading-tight line-clamp-1">
              {episodeName}
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {seasonNum != null && episodeNum != null && (
              <span className="font-mono text-xs text-neutral-500">
                S{seasonNum}E{episodeNum}
              </span>
            )}
            {airTime && (
              <span className="font-mono text-xs text-neutral-500">
                {airTime}
              </span>
            )}
            {episodeTag && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${episodeTag.classes}`}>
                {episodeTag.label}
              </span>
            )}
          </div>
          {overview && (
            <p className="text-sm text-neutral-500 mt-1 leading-relaxed">
              {overview}
            </p>
          )}
          {overview && (
            <div className="absolute bottom-0 left-0 right-0 h-5 bg-gradient-to-t from-neutral-900 to-transparent pointer-events-none" />
          )}
        </div>

        {/* Watched checkmark */}
        <button
            onClick={handleToggleWatched}
            disabled={marking}
            title={localWatched ? "Mark as unwatched" : "Mark as watched"}
            className={`flex-shrink-0 self-start mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${
              localWatched
                ? "bg-primary-500 border-primary-500 text-neutral-950 hover:bg-transparent hover:border-neutral-700 hover:text-neutral-600"
                : "border-neutral-700 text-neutral-600 hover:border-primary-500 hover:text-primary-400"
            } ${marking ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
        </button>
      </Link>
    </div>
  );
}

type ActivityType =
  | "watched"
  | "currently_watching"
  | "want_to_watch"
  | "rated"
  | "episode_watched";

interface ActivityItem {
  id: number;
  username: string | null;
  activity_type: ActivityType;
  content_type: "movie" | "tv";
  content_id: number;
  content_title: string | null;
  content_poster_path: string | null;
  created_at: string;
}

const ACTIVITY_LABELS: Record<ActivityType, { color: string; label: string }> =
  {
    watched: { color: "text-success-400", label: "watched" },
    currently_watching: {
      color: "text-highlight-400",
      label: "started watching",
    },
    want_to_watch: { color: "text-primary-400", label: "wants to watch" },
    rated: { color: "text-warning-400", label: "rated" },
    episode_watched: { color: "text-teal-400", label: "watched an episode of" },
  };

function FriendsActivityBox() {
  const { data, isLoading } = useFriendsActivity();
  const items: ActivityItem[] = Array.isArray(data) ? data.slice(0, 4) : [];

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
      <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-neutral-500 mb-4">
        Friends' Activity
      </p>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-8 h-12 rounded bg-neutral-800 flex-shrink-0" />
              <div className="flex-1 space-y-1.5 pt-1">
                <div className="h-2.5 bg-neutral-800 rounded w-3/4" />
                <div className="h-2 bg-neutral-800 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500 leading-relaxed">
          Friends' activity will show up here.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {items.map((item) => {
              const badge = ACTIVITY_LABELS[item.activity_type];
              const contentPath = `/${item.content_type === "movie" ? "movie" : "tv"}/${item.content_id}`;
              return (
                <div key={item.id} className="flex gap-3 items-start">
                  <Link to={contentPath} className="flex-shrink-0">
                    {item.content_poster_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w185${item.content_poster_path}`}
                        alt={item.content_title ?? ""}
                        className="w-8 h-12 rounded-md object-cover hover:opacity-80 transition-opacity"
                      />
                    ) : (
                      <div className="w-8 h-12 rounded-md bg-neutral-800" />
                    )}
                  </Link>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-xs text-neutral-400 leading-tight">
                      <span className="font-semibold text-neutral-200">
                        {item.username ?? "Someone"}
                      </span>{" "}
                      <span className={badge.color}>{badge.label}</span>
                    </p>
                    <Link
                      to={contentPath}
                      className="text-sm font-semibold text-neutral-100 hover:text-primary-400 transition-colors line-clamp-1 block mt-0.5"
                    >
                      {item.content_title ?? "Unknown"}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          <Link
            to="/activity"
            className="mt-4 block text-center text-xs font-semibold text-primary-400 hover:text-primary-300 transition-colors py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700"
          >
            See all →
          </Link>
        </>
      )}
    </div>
  );
}

export default function CalendarSideRail({
  todayItems,
  selectedDate,
  selectedDateItems,
  onResetToToday,
  onSyncCalendar,
}: Props) {
  const today = new Date();
  const isToday = selectedDate.toDateString() === today.toDateString();
  const displayItems = isToday ? todayItems : selectedDateItems;

  return (
    <div className="flex flex-col gap-4 sticky top-4">
      {/* Day releases panel */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <p
            className="text-lg leading-tight text-primary-300"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
          >
            {isToday
              ? "On the radar today"
              : selectedDate.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
          </p>
          {!isToday && (
            <button
              onClick={onResetToToday}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 hover:border-primary-500/50 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Today
            </button>
          )}
        </div>

        {displayItems.length === 0 ? (
          <p className="text-base text-neutral-500">Nothing scheduled.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {displayItems.slice(0, 5).map((item) => (
              <SideRailItem key={`${item.type}-${item.id}`} item={item} />
            ))}
            {displayItems.length > 5 && (
              <p className="text-sm text-neutral-500 font-mono">
                +{displayItems.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* Friends' Activity */}
      <FriendsActivityBox />

      {/* Sync CTA */}
      <div
        className="rounded-2xl p-5 border border-neutral-800"
        style={{
          background:
            "linear-gradient(180deg, rgb(5 150 105 / 0.08), transparent)",
        }}
      >
        <h3
          className="text-xl leading-tight tracking-tight mb-2"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Sync with your{" "}
          <em className="text-primary-400" style={{ fontStyle: "italic" }}>
            calendar
          </em>
        </h3>
        <p className="text-xs text-neutral-400 leading-relaxed mb-4">
          Drop releases straight into Google, iCal, or Outlook.
        </p>
        <button
          onClick={onSyncCalendar}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-500/15 text-primary-400 border border-primary-500/25 hover:bg-primary-500/25 transition-colors"
        >
          Connect →
        </button>
      </div>
    </div>
  );
}
