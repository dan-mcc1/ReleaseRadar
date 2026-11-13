import { useEffect, useState, useMemo } from "react";
import { BASE_IMAGE_URL } from "../constants";
import { useAuthUser } from "../hooks/useAuthUser";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import WatchButton, { type WatchStatus } from "../components/WatchButton";
import { useMyActivity, useFriendsActivity } from "../hooks/api/useActivity";
import {
  useRecommendationsInbox,
  useMarkRecRead,
  useDeleteRecommendation,
} from "../hooks/api/useRecommendations";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import {
  Button,
  ButtonLink,
  Card,
  CheckIcon,
  Chip,
  CloseIcon,
  EmptyState,
  IconButton,
  PageHeader,
  PlayIcon,
  PlusIcon,
  SectionHeader,
  StarIcon,
  cx,
  focusRing,
} from "../components/ui";

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
  logged_by_username?: string | null;
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

  const todayLabel = fmt(todayStart, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const yestLabel = fmt(yesterdayStart, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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
  "#10b981",
  "#6366f1",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#8b5cf6",
  "#3b82f6",
  "#ef4444",
];

function InitialsAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const parts = (name || "?").trim().split(/\s+/);
  const initials =
    parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (name[0] ?? "?").toUpperCase();
  const color = AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

const BADGE_MAP: Record<
  ActivityItem["activity_type"],
  { Icon: typeof CheckIcon; label: string; color: string }
> = {
  watched: { Icon: CheckIcon, label: "watched", color: "text-success-400" },
  currently_watching: {
    Icon: PlayIcon,
    label: "started watching",
    color: "text-highlight-400",
  },
  want_to_watch: { Icon: PlusIcon, label: "added to watchlist", color: "text-neutral-400" },
  rated: { Icon: StarIcon, label: "rated", color: "text-warning-400" },
  episode_watched: {
    Icon: PlayIcon,
    label: "watched an episode of",
    color: "text-neutral-400",
  },
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
    <div className="py-3.5 flex flex-col gap-2.5">
      {/* Row 1: avatar + name + action */}
      <div className="flex items-center gap-2">
        <InitialsAvatar name={nameLabel} size={26} />
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
        <badge.Icon className={cx("w-3.5 h-3.5", badge.color)} />
        <span className="text-caption text-neutral-400">{badge.label}</span>
      </div>

      {/* Row 2: poster + title + watch button */}
      <div className="flex items-center gap-3">
        <Link to={contentPath} className="flex-shrink-0">
          {item.content_poster_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w92${item.content_poster_path}`}
              alt={item.content_title ?? ""}
              className="w-12 h-[72px] rounded object-cover hover:opacity-80 transition-opacity"
            />
          ) : (
            <div className="w-12 h-[72px] bg-neutral-700 rounded" />
          )}
        </Link>

        <Link to={contentPath} className="flex-1 min-w-0 hover:text-primary-400 transition-colors">
          <p className="text-sm font-semibold text-neutral-100 line-clamp-2 leading-snug">
            {item.content_title ?? "Unknown"}
          </p>
          {item.activity_type === "episode_watched" &&
            item.season_number != null &&
            item.episode_number != null && (
              <span className="font-mono text-caption text-neutral-500">
                S{item.season_number} E{item.episode_number}
              </span>
            )}
          {(item.activity_type === "rated" || item.activity_type === "watched") &&
            item.rating != null && (
              <span className="inline-flex items-center gap-1 text-caption font-semibold px-1.5 py-0.5 rounded mt-0.5 bg-warning-400/10 text-warning-400 tabular">
                <StarIcon className="w-3 h-3" />
                {item.rating}
              </span>
            )}
        </Link>

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

      {/* Row 3: timestamp */}
      <time dateTime={item.created_at} className="text-caption text-neutral-500">
        {timeAgo(item.created_at)}
        {item.logged_by_username && ` · logged by ${item.logged_by_username}`}
      </time>
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
    <Card padding="sm">
      <SectionHeader
        as="h3"
        title="Inbox"
        note={unreadCount > 0 ? `${unreadCount} new` : undefined}
        action={
          <Link
            to="/activity?tab=recommendations"
            className="text-label text-neutral-300 hover:text-primary-300"
          >
            See all
          </Link>
        }
        className="mb-3.5"
      />

      {items.length === 0 ? (
        <p className="text-xs text-neutral-500 text-center py-4">
          No recommendations yet
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {items.slice(0, 4).map((rec, i) => {
            const contentPath = `/${rec.content_type === "movie" ? "movie" : "tv"}/${rec.content_id}`;
            return (
              <div
                key={rec.id}
                className="relative"
                style={{
                  paddingTop: i > 0 ? 14 : 0,
                  borderTop: i > 0 ? "1px solid #404040" : "none",
                }}
              >
                {!rec.is_read && (
                  <span
                    className="absolute right-0 size-[7px] rounded-full bg-primary-500"
                    style={{ top: i > 0 ? 18 : 4 }}
                  />
                )}
                <div className="flex gap-2.5">
                  <Link
                    to={contentPath}
                    onClick={() => !rec.is_read && onRead(rec.id)}
                    className="flex-shrink-0"
                  >
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
                      <InitialsAvatar
                        name={rec.sender_username ?? "?"}
                        size={16}
                      />
                      <span className="text-neutral-400">
                        {rec.sender_username?.split(" ")[0]}
                      </span>
                      <span className="text-neutral-500 text-caption">
                        · {timeAgo(rec.created_at)}
                      </span>
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
                  <IconButton
                    size="sm"
                    label="Dismiss recommendation"
                    icon={<CloseIcon className="w-3.5 h-3.5" />}
                    onClick={() => onDelete(rec.id)}
                    className="self-start flex-shrink-0"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function WeekStatsPanel({ friendItems }: { friendItems: ActivityItem[] }) {
  // Read the clock once per mount; calling Date.now() while rendering makes
  // the output depend on when React happens to re-render.
  const [now] = useState(Date.now);
  const uniqueFriends = useMemo(() => {
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const ids = new Set(
      friendItems
        .filter((i) => new Date(i.created_at).getTime() > weekAgo)
        .map((i) => i.user_id),
    );
    return ids.size;
  }, [friendItems]);

  const topTitle = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of friendItems) {
      if (item.content_title)
        counts[item.content_title] = (counts[item.content_title] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  }, [friendItems]);

  return (
    <section>
      <SectionHeader as="h3" title="This week" className="mb-2" />
      <p className="text-body text-neutral-300">
        <span className="tabular">{uniqueFriends}</span>{" "}
        {uniqueFriends === 1 ? "friend" : "friends"} active
        {topTitle && (
          <>
            . Most active title: <span className="text-neutral-100">{topTitle[0]}</span> (
            <span className="tabular">{topTitle[1]}</span>{" "}
            {topTitle[1] === 1 ? "activity" : "activities"})
          </>
        )}
      </p>
    </section>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-7 h-7 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

type Tab = "me" | "friends" | "recommendations";

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

  const activeItems = tab === "me" ? myItems : friendItems;
  const filteredGroups = useMemo(
    () => groupByDay(activeItems.filter((i) => matchesFilter(i, filter))),
    [activeItems, filter],
  );

  const showSidebar = tab === "friends" || tab === "me";

  return (
    <div className="w-full px-6 lg:px-10 py-7">
      <PageHeader
        title={<>What&rsquo;s moving</>}
        description={
          unreadCount > 0
            ? `${unreadCount} new recommendation${unreadCount !== 1 ? "s" : ""}`
            : undefined
        }
        className="mb-5"
      />

      {/* Tabs */}
      <div className="flex gap-3 sm:gap-6 border-b border-neutral-700 mb-6">
        {(
          [
            {
              id: "friends" as Tab,
              label: "Friends",
              shortLabel: "Friends",
              count: friendItems.length,
              badge: false,
            },
            {
              id: "me" as Tab,
              label: "My activity",
              shortLabel: "Me",
              count: myItems.length,
              badge: false,
            },
            {
              id: "recommendations" as Tab,
              label: "Recommendations",
              shortLabel: "Inbox",
              count: unreadCount,
              badge: unreadCount > 0,
            },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 py-3 text-label font-medium border-b-2 -mb-px transition-colors ${focusRing} ${
              tab === t.id
                ? "border-primary-500 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <span className="sm:hidden">{t.shortLabel}</span>
            <span className="hidden sm:inline">{t.label}</span>
            <span
              className={`tabular text-caption font-semibold px-1.5 py-0.5 rounded ${
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
        <div className="grid gap-8 grid-cols-1 lg:grid-cols-[1fr_300px]">
          {/* Timeline */}
          <div>
            {(myLoading && tab === "me") ||
            (friendsLoading && tab === "friends") ? (
              <Spinner />
            ) : filteredGroups.length === 0 ? (
              <EmptyState
                title={
                  filter !== "all"
                    ? "No matching activity"
                    : tab === "friends"
                      ? "No friend activity yet"
                      : "No activity yet"
                }
                description={
                  tab === "friends"
                    ? "Add friends to see what they’re watching."
                    : "Start tracking shows and movies to see your history here."
                }
                action={
                  tab === "friends" ? (
                    <ButtonLink to="/friends" variant="primary">
                      Find friends
                    </ButtonLink>
                  ) : undefined
                }
              />
            ) : (
              filteredGroups.map((group) => (
                <div key={group.label} className="mb-9">
                  {/* Day header */}
                  <SectionHeader
                    title={group.label}
                    note={group.dateStr || undefined}
                    divider
                  />
                  {/* Items */}
                  <div className="flex flex-col divide-y divide-neutral-800">
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
          <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            <RecsInboxPanel
              items={recommendations}
              onRead={markRead}
              onDelete={deleteRec}
              unreadCount={unreadCount}
            />

            <WeekStatsPanel friendItems={friendItems} />

            {/* Filters */}
            <section>
              <SectionHeader as="h3" title="Filters" className="mb-3" />
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map(({ label, value }) => (
                  <Chip
                    key={value}
                    pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : (
        /* Recommendations full-width tab */
        <div className="max-w-2xl mx-auto">
          {recsLoading ? (
            <Spinner />
          ) : recommendations.length === 0 ? (
            <EmptyState
              title="No recommendations yet"
              description="When a friend recommends something, it will appear here. Visit a friend’s profile to send one."
              action={
                <ButtonLink to="/friends" variant="primary">
                  Find friends
                </ButtonLink>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {recommendations.map((rec) => {
                const contentPath = `/${rec.content_type === "movie" ? "movie" : "tv"}/${rec.content_id}`;
                return (
                  <div
                    key={rec.id}
                    className={`relative flex items-start gap-4 border rounded-surface p-4 transition-colors ${
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
                        <span className="text-caption text-neutral-400">
                          Recommended by
                        </span>
                        <Link
                          to={`/user/${rec.sender_username}`}
                          className="text-caption font-semibold text-neutral-100 hover:text-primary-300"
                        >
                          @{rec.sender_username ?? "someone"}
                        </Link>
                        {!rec.is_read && (
                          <span className="ml-1 bg-primary-500 text-neutral-950 text-caption font-semibold px-1.5 py-0.5 rounded-full">
                            New
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
                        <time dateTime={rec.created_at} className="text-caption text-neutral-500">
                          {timeAgo(rec.created_at)}
                        </time>
                        {!rec.is_read && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markRead(rec.id)}
                          >
                            Mark read
                          </Button>
                        )}
                      </div>
                    </div>

                    <IconButton
                      size="sm"
                      label="Delete recommendation"
                      icon={<CloseIcon className="w-4 h-4" />}
                      onClick={() => deleteRec(rec.id)}
                      className="absolute top-2 right-2"
                    />

                    {statusMap[`${rec.content_type}:${rec.content_id}`] !==
                      undefined && (
                      <div className="flex-shrink-0 self-center">
                        <WatchButton
                          compact
                          contentType={rec.content_type}
                          contentId={rec.content_id}
                          initialStatus={
                            statusMap[`${rec.content_type}:${rec.content_id}`]!
                              .status
                          }
                          initialRating={
                            statusMap[`${rec.content_type}:${rec.content_id}`]!
                              .rating
                          }
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
