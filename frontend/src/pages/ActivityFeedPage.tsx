import { useEffect, useState, useMemo } from "react";
import { BASE_IMAGE_URL } from "../constants";
import { useAuthUser } from "../hooks/useAuthUser";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import WatchButton, { WatchStatus } from "../components/WatchButton";
import { useMyActivity, useFriendsActivity } from "../hooks/api/useActivity";
import {
  useRecommendationsInbox,
  useMarkRecRead,
  useDeleteRecommendation,
} from "../hooks/api/useRecommendations";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";

type StatusMap = Record<string, { status: WatchStatus; rating: number | null }>;

interface ActivityItem {
  id: number;
  user_id: string;
  username: string | null;
  activity_type:
    | "watched"
    | "currently_watching"
    | "want_to_watch"
    | "rated"
    | "episode_watched";
  content_type: "movie" | "tv";
  content_id: number;
  content_title: string | null;
  content_poster_path: string | null;
  rating: number | null;
  season_number: number | null;
  episode_number: number | null;
  created_at: string;
}

interface RecommendationItem {
  id: number;
  sender_id: string;
  sender_username: string | null;
  content_type: "movie" | "tv";
  content_id: number;
  content_title: string | null;
  content_poster_path: string | null;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

function timeAgo(isoString: string) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

type DayGroup = { label: string; dateStr: string; items: ActivityItem[] };

function groupByDay(items: ActivityItem[]): DayGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400000);
  const weekEndDay = new Date(todayStart.getTime() - 2 * 86400000);

  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString("en-US", opts);

  const todayLabel = fmt(todayStart, { weekday: "short", month: "short", day: "numeric" });
  const yestLabel = fmt(yesterdayStart, { weekday: "short", month: "short", day: "numeric" });
  const weekRange = `${fmt(weekStart, { month: "short", day: "numeric" })} – ${fmt(weekEndDay, { month: "short", day: "numeric" })}`;

  const groups: DayGroup[] = [
    { label: "Today", dateStr: todayLabel, items: [] },
    { label: "Yesterday", dateStr: yestLabel, items: [] },
    { label: "Earlier this week", dateStr: weekRange, items: [] },
    { label: "Older", dateStr: "", items: [] },
  ];

  for (const item of items) {
    const d = new Date(item.created_at);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dayStart >= todayStart) groups[0].items.push(item);
    else if (dayStart >= yesterdayStart) groups[1].items.push(item);
    else if (dayStart >= weekStart) groups[2].items.push(item);
    else groups[3].items.push(item);
  }

  return groups.filter((g) => g.items.length > 0);
}

const AVATAR_COLORS = [
  "#10b981", "#6366f1", "#f59e0b", "#ec4899",
  "#14b8a6", "#8b5cf6", "#3b82f6", "#ef4444",
];

function InitialsAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const parts = (name || "?").trim().split(/\s+/);
  const initials = parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name[0] ?? "?").toUpperCase();
  const color = AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%", background: color,
        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

const BADGE_MAP: Record<
  ActivityItem["activity_type"],
  { icon: string; label: string; color: string }
> = {
  watched:            { icon: "✓", label: "watched",             color: "#4ade80" },
  currently_watching: { icon: "▶", label: "started watching",    color: "#a78bfa" },
  want_to_watch:      { icon: "+", label: "added to watchlist",  color: "#34d399" },
  rated:              { icon: "★", label: "rated",               color: "#fbbf24" },
  episode_watched:    { icon: "▶", label: "watched an episode of", color: "#34d399" },
};

type ActivityFilter = "all" | "episodes" | "ratings" | "watchlist" | "finished";

const FILTERS: { label: string; value: ActivityFilter }[] = [
  { label: "All", value: "all" },
  { label: "Episodes", value: "episodes" },
  { label: "Ratings", value: "ratings" },
  { label: "Watchlist", value: "watchlist" },
  { label: "Finished", value: "finished" },
];

function matchesFilter(item: ActivityItem, filter: ActivityFilter) {
  if (filter === "all") return true;
  if (filter === "episodes") return item.activity_type === "episode_watched";
  if (filter === "ratings") return item.activity_type === "rated";
  if (filter === "watchlist") return item.activity_type === "want_to_watch";
  if (filter === "finished") return item.activity_type === "watched";
  return true;
}

function ActivityCard({
  item,
  currentUserId,
  statusMap,
}: {
  item: ActivityItem;
  currentUserId: string;
  statusMap: StatusMap;
}) {
  const isMe = item.user_id === currentUserId;
  const nameLabel = isMe ? "You" : (item.username ?? "Someone");
  const contentPath = `/${item.content_type === "movie" ? "movie" : "tv"}/${item.content_id}`;
  const badge = BADGE_MAP[item.activity_type];

  return (
    <div className="flex items-center gap-3 p-3.5 bg-neutral-800 border border-neutral-700 rounded-xl">
      {/* Avatar */}
      <InitialsAvatar name={nameLabel} size={34} />

      {/* Poster */}
      <Link to={contentPath} className="flex-shrink-0">
        {item.content_poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w92${item.content_poster_path}`}
            alt={item.content_title ?? ""}
            className="w-14 h-[84px] rounded object-cover hover:opacity-80 transition-opacity"
          />
        ) : (
          <div className="w-14 h-[84px] bg-neutral-700 rounded" />
        )}
      </Link>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Action line */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mb-1">
          {isMe ? (
            <span className="text-sm font-semibold text-neutral-100">You</span>
          ) : (
            <Link
              to={`/user/${item.username}`}
              className="text-sm font-semibold text-neutral-100 hover:text-primary-400 transition-colors"
            >
              {nameLabel}
            </Link>
          )}
          <span style={{ color: badge.color }} className="text-xs leading-none">{badge.icon}</span>
          <span className="text-xs text-neutral-400">{badge.label}</span>
          <Link
            to={contentPath}
            className="text-sm font-semibold text-neutral-100 hover:text-primary-400 transition-colors truncate"
          >
            {item.content_title ?? "Unknown"}
          </Link>
          {item.activity_type === "episode_watched" &&
            item.season_number != null &&
            item.episode_number != null && (
              <span className="font-mono text-[11px] text-neutral-500">
                · S{String(item.season_number).padStart(2, "0")}E{String(item.episode_number).padStart(2, "0")}
              </span>
            )}
          {(item.activity_type === "rated" || item.activity_type === "watched") &&
            item.rating != null && (
              <span
                className="font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}
              >
                ★ {item.rating}
              </span>
            )}
        </div>

        {/* Timestamp */}
        <div className="font-mono text-[10.5px] text-neutral-600 tracking-wide uppercase">
          {timeAgo(item.created_at)}
        </div>
      </div>

      {/* Right: watchlist button */}
      {!isMe && statusMap[`${item.content_type}:${item.content_id}`] !== undefined && (
        <div className="flex-shrink-0">
          <WatchButton
            compact
            contentType={item.content_type}
            contentId={item.content_id}
            initialStatus={statusMap[`${item.content_type}:${item.content_id}`]!.status}
            initialRating={statusMap[`${item.content_type}:${item.content_id}`]!.rating}
          />
        </div>
      )}
    </div>
  );
}

function RecsInboxPanel({
  items,
  onRead,
  onDelete,
  unreadCount,
}: {
  items: RecommendationItem[];
  onRead: (id: number) => void;
  onDelete: (id: number) => void;
  unreadCount: number;
}) {
  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3.5">
        <span className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase">
          Inbox{unreadCount > 0 ? ` · ${unreadCount} new` : ""}
        </span>
        <Link to="/activity?tab=recommendations" className="text-xs text-primary-400 font-medium hover:underline">
          See all
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-neutral-500 text-center py-4">No recommendations yet</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {items.slice(0, 4).map((rec, i) => {
            const contentPath = `/${rec.content_type === "movie" ? "movie" : "tv"}/${rec.content_id}`;
            return (
              <div
                key={rec.id}
                className="relative"
                style={{ paddingTop: i > 0 ? 14 : 0, borderTop: i > 0 ? "1px solid #404040" : "none" }}
              >
                {!rec.is_read && (
                  <span
                    className="absolute right-0"
                    style={{ top: i > 0 ? 18 : 4, width: 7, height: 7, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b98180", display: "block" }}
                  />
                )}
                <div className="flex gap-2.5">
                  <Link to={contentPath} onClick={() => !rec.is_read && onRead(rec.id)} className="flex-shrink-0">
                    {rec.content_poster_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w92${rec.content_poster_path}`}
                        alt={rec.content_title ?? ""}
                        className="w-10 h-[60px] rounded object-cover hover:opacity-80 transition-opacity"
                      />
                    ) : (
                      <div className="w-10 h-[60px] bg-neutral-700 rounded" />
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs mb-1">
                      <InitialsAvatar name={rec.sender_username ?? "?"} size={16} />
                      <span className="text-neutral-400">{rec.sender_username?.split(" ")[0]}</span>
                      <span className="text-neutral-600 font-mono text-[10px]">· {timeAgo(rec.created_at)}</span>
                    </div>
                    <Link
                      to={contentPath}
                      onClick={() => !rec.is_read && onRead(rec.id)}
                      className="text-sm font-semibold text-neutral-100 hover:text-primary-400 transition-colors line-clamp-1 block"
                    >
                      {rec.content_title ?? "Unknown"}
                    </Link>
                    {rec.message && (
                      <p className="text-xs text-neutral-400 italic mt-1 line-clamp-2">
                        "{rec.message}"
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onDelete(rec.id)}
                    title="Dismiss"
                    className="text-neutral-600 hover:text-error-400 transition-colors self-start mt-0.5 flex-shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WeekStatsPanel({
  friendItems,
}: {
  friendItems: ActivityItem[];
}) {
  const uniqueFriends = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const ids = new Set(
      friendItems
        .filter((i) => new Date(i.created_at).getTime() > weekAgo)
        .map((i) => i.user_id)
    );
    return ids.size;
  }, [friendItems]);

  const topTitle = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of friendItems) {
      if (item.content_title) counts[item.content_title] = (counts[item.content_title] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  }, [friendItems]);

  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-4">
      <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-3.5">
        This week
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-900 rounded-xl p-3">
          <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wide mb-1">Friends active</div>
          <div className="text-xl font-semibold text-neutral-100">{uniqueFriends}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">this week</div>
        </div>
        <div className="bg-neutral-900 rounded-xl p-3">
          <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wide mb-1">Top title</div>
          {topTitle ? (
            <>
              <div className="text-sm font-semibold text-neutral-100 line-clamp-1">{topTitle[0]}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{topTitle[1]} {topTitle[1] === 1 ? "activity" : "activities"}</div>
            </>
          ) : (
            <div className="text-sm text-neutral-500">—</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-7 h-7 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

type Tab = "mine" | "friends" | "recommendations";

export default function ActivityFeedPage() {
  usePageTitle("Activity");
  const user = useAuthUser();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("friends");
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const { data: myData, isLoading: myLoading } = useMyActivity();
  const { data: friendData, isLoading: friendsLoading } = useFriendsActivity();
  const { data: recsData, isLoading: recsLoading } = useRecommendationsInbox();

  const myItems = (myData as ActivityItem[] | undefined) ?? [];
  const friendItems = (friendData as ActivityItem[] | undefined) ?? [];
  const recommendations = (recsData as RecommendationItem[] | undefined) ?? [];

  const markReadMutation = useMarkRecRead();
  const deleteRecMutation = useDeleteRecommendation();

  useEffect(() => {
    if (!user) navigate("/signIn");
  }, [user, navigate]);

  const bulkItems = useMemo(() => {
    const seen = new Set<string>();
    return [...myItems, ...friendItems, ...recommendations]
      .map((i) => ({ content_type: i.content_type, content_id: i.content_id }))
      .filter(({ content_type, content_id }) => {
        const key = `${content_type}:${content_id}`;
        return seen.has(key) ? false : (seen.add(key), true);
      });
  }, [myItems, friendItems, recommendations]);

  const { data: bulkStatusData } = useBulkWatchStatus(bulkItems);
  const statusMap = (bulkStatusData as StatusMap | undefined) ?? {};

  async function markRead(id: number) {
    await markReadMutation.mutateAsync(id).catch(() => {});
  }

  async function deleteRec(id: number) {
    await deleteRecMutation.mutateAsync(id).catch(() => {});
  }

  const currentUserId = user?.uid ?? "";
  const unreadCount = recommendations.filter((r) => !r.is_read).length;

  const activeItems = tab === "mine" ? myItems : friendItems;
  const filteredGroups = useMemo(
    () => groupByDay(activeItems.filter((i) => matchesFilter(i, filter))),
    [activeItems, filter]
  );

  const showSidebar = tab === "friends" || tab === "mine";

  return (
    <div className="w-full px-6 lg:px-10 py-7">
      {/* Header */}
      <div className="mb-5">
        <div className="font-mono text-[11px] tracking-[0.12em] text-neutral-500 uppercase mb-2">
          Activity
          {unreadCount > 0 && ` · ${unreadCount} new recommendation${unreadCount !== 1 ? "s" : ""}`}
        </div>
        <h1 className="text-4xl font-light text-neutral-100 tracking-tight leading-none">
          What&rsquo;s{" "}
          <em className="not-italic font-semibold text-primary-400">moving</em>
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-neutral-700 mb-6">
        {(
          [
            { id: "friends" as Tab, label: "Friends", count: friendItems.length, badge: false },
            { id: "mine" as Tab, label: "My activity", count: myItems.length, badge: false },
            { id: "recommendations" as Tab, label: "Recommendations", count: unreadCount, badge: unreadCount > 0 },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-primary-500 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t.label}
            <span
              className={`font-mono text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${
                t.badge
                  ? "bg-primary-500 text-neutral-950"
                  : "bg-neutral-700 text-neutral-400"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Layout: timeline + sidebar for friends/mine, full-width for recommendations */}
      {showSidebar ? (
        <div className="grid gap-8" style={{ gridTemplateColumns: "1fr 300px" }}>
          {/* Timeline */}
          <div>
            {(myLoading && tab === "mine") || (friendsLoading && tab === "friends") ? (
              <Spinner />
            ) : filteredGroups.length === 0 ? (
              <div className="text-center py-20 text-neutral-400">
                <p className="text-base mb-2">
                  {filter !== "all"
                    ? "No matching activity"
                    : tab === "friends"
                    ? "No friend activity yet"
                    : "No activity yet"}
                </p>
                <p className="text-sm text-neutral-500">
                  {tab === "friends" ? (
                    <>
                      Add friends to see what they&rsquo;re watching.{" "}
                      <Link to="/friends" className="text-primary-400 hover:underline">
                        Find friends →
                      </Link>
                    </>
                  ) : (
                    "Start tracking shows and movies to see your history here."
                  )}
                </p>
              </div>
            ) : (
              filteredGroups.map((group) => (
                <div key={group.label} className="mb-9">
                  {/* Day header */}
                  <div className="flex items-baseline gap-3.5 mb-4">
                    <h2 className="text-2xl font-light text-neutral-100 tracking-tight flex-shrink-0">
                      {group.label}
                    </h2>
                    <span className="font-mono text-[10.5px] text-neutral-600 tracking-[0.08em] uppercase flex-shrink-0">
                      {group.dateStr.toUpperCase()}
                    </span>
                    <div className="flex-1 h-px bg-neutral-700" />
                  </div>
                  {/* Items */}
                  <div className="flex flex-col gap-2.5">
                    {group.items.map((item) => (
                      <ActivityCard
                        key={item.id}
                        item={item}
                        currentUserId={currentUserId}
                        statusMap={statusMap}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4" style={{ position: "sticky", top: 80, alignSelf: "flex-start" }}>
            <RecsInboxPanel
              items={recommendations}
              onRead={markRead}
              onDelete={deleteRec}
              unreadCount={unreadCount}
            />

            <WeekStatsPanel friendItems={friendItems} />

            {/* Filters */}
            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-4">
              <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-3">
                Filters
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      filter === value
                        ? "bg-primary-500/20 text-primary-400 border-primary-500/40"
                        : "bg-neutral-900 text-neutral-500 border-neutral-700 hover:text-neutral-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Recommendations full-width tab */
        <div className="max-w-2xl mx-auto">
          {recsLoading ? (
            <Spinner />
          ) : recommendations.length === 0 ? (
            <div className="text-center py-20 text-neutral-400">
              <p className="text-base mb-2">No recommendations yet</p>
              <p className="text-sm text-neutral-500">
                When a friend recommends something, it will appear here. Visit a friend&rsquo;s profile to send one, or{" "}
                <Link to="/friends" className="text-primary-400 hover:underline">
                  find friends
                </Link>{" "}
                to get started.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recommendations.map((rec) => {
                const contentPath = `/${rec.content_type === "movie" ? "movie" : "tv"}/${rec.content_id}`;
                return (
                  <div
                    key={rec.id}
                    className={`relative flex items-start gap-4 border rounded-xl p-4 transition-colors ${
                      rec.is_read
                        ? "bg-neutral-800 border-neutral-700"
                        : "bg-neutral-800 border-primary-600/50 ring-1 ring-primary-600/20"
                    }`}
                  >
                    <Link
                      to={contentPath}
                      onClick={() => !rec.is_read && markRead(rec.id)}
                      className="flex-shrink-0"
                    >
                      {rec.content_poster_path ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w185${rec.content_poster_path}`}
                          alt={rec.content_title ?? ""}
                          className="w-12 h-[72px] rounded-lg object-cover hover:opacity-80 transition-opacity"
                        />
                      ) : (
                        <div className="w-12 h-[72px] bg-neutral-700 rounded-lg" />
                      )}
                    </Link>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs font-bold text-pink-400">♥</span>
                        <span className="text-xs text-neutral-400">recommended by</span>
                        <Link
                          to={`/user/${rec.sender_username}`}
                          className="text-xs font-semibold text-primary-400 hover:underline"
                        >
                          @{rec.sender_username ?? "someone"}
                        </Link>
                        {!rec.is_read && (
                          <span className="ml-1 bg-primary-600 text-neutral-950 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            NEW
                          </span>
                        )}
                      </div>
                      <Link
                        to={contentPath}
                        onClick={() => !rec.is_read && markRead(rec.id)}
                        className="font-semibold text-neutral-100 hover:text-primary-400 transition-colors line-clamp-1 block"
                      >
                        {rec.content_title ?? "Unknown"}
                      </Link>
                      {rec.message && (
                        <p className="text-sm text-neutral-400 mt-1 italic line-clamp-2">
                          &ldquo;{rec.message}&rdquo;
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="font-mono text-[10.5px] text-neutral-600">{timeAgo(rec.created_at)}</span>
                        {!rec.is_read && (
                          <button
                            onClick={() => markRead(rec.id)}
                            className="text-xs text-neutral-500 hover:text-neutral-300 underline"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => deleteRec(rec.id)}
                      title="Delete recommendation"
                      className="absolute top-2 right-2 text-neutral-600 hover:text-error-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    {statusMap[`${rec.content_type}:${rec.content_id}`] !== undefined && (
                      <div className="flex-shrink-0 self-center">
                        <WatchButton
                          compact
                          contentType={rec.content_type}
                          contentId={rec.content_id}
                          initialStatus={statusMap[`${rec.content_type}:${rec.content_id}`]!.status}
                          initialRating={statusMap[`${rec.content_type}:${rec.content_id}`]!.rating}
                          onStatusChange={(status) => {
                            if (status !== "none") markRead(rec.id);
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
