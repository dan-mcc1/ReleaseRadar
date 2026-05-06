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

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-warning-400 text-xs">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          className={`w-3 h-3 ${i < Math.round(rating) ? "fill-current" : "fill-neutral-600"}`}
          viewBox="0 0 24 24"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      <span className="text-neutral-400 ml-1">{rating}/5</span>
    </span>
  );
}

function ActivityRow({
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

  const badge = {
    watched: { color: "text-success-400", icon: "✓", label: "watched" },
    currently_watching: {
      color: "text-highlight-400",
      icon: "▶",
      label: "started watching",
    },
    want_to_watch: {
      color: "text-primary-400",
      icon: "🔖",
      label: "added to watchlist",
    },
    rated: { color: "text-warning-400", icon: "★", label: "rated" },
    episode_watched: {
      color: "text-teal-400",
      icon: "▶",
      label: "watched an episode of",
    },
  }[item.activity_type];

  return (
    <div className="flex items-start gap-4 bg-neutral-800 border border-neutral-700 rounded-xl p-4">
      <Link to={contentPath} className="flex-shrink-0">
        {item.content_poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w185${item.content_poster_path}`}
            alt={item.content_title ?? ""}
            className="w-12 h-[72px] rounded-lg object-cover hover:opacity-80 transition-opacity"
          />
        ) : (
          <div className="w-12 h-[72px] bg-neutral-700 rounded-lg" />
        )}
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-xs font-bold ${badge.color}`}>
            {badge.icon}
          </span>
          <span className="text-xs text-neutral-400">{badge.label}</span>
        </div>

        <Link
          to={contentPath}
          className="font-semibold text-neutral-100 hover:text-primary-400 transition-colors line-clamp-1 block"
        >
          {item.content_title ?? "Unknown"}
        </Link>

        {item.activity_type === "episode_watched" &&
          item.season_number != null &&
          item.episode_number != null && (
            <p className="text-xs text-neutral-400 mt-0.5">
              S{String(item.season_number).padStart(2, "0")}E
              {String(item.episode_number).padStart(2, "0")}
            </p>
          )}

        {item.activity_type === "rated" && item.rating != null && (
          <div className="mt-1">
            <StarDisplay rating={item.rating} />
          </div>
        )}

        <div className="flex items-center gap-2 mt-1.5">
          {isMe ? (
            <span className="text-sm font-semibold text-neutral-300">You</span>
          ) : (
            <Link
              to={`/user/${item.username}`}
              className="text-sm font-semibold text-primary-400 hover:underline"
            >
              {nameLabel}
            </Link>
          )}
          <span className="text-neutral-600">·</span>
          <span className="text-xs text-neutral-500">
            {timeAgo(item.created_at)}
          </span>
        </div>
      </div>

      {!isMe &&
        statusMap[`${item.content_type}:${item.content_id}`] !== undefined && (
          <div className="flex-shrink-0 self-center">
            <WatchButton
              compact
              contentType={item.content_type}
              contentId={item.content_id}
              initialStatus={
                statusMap[`${item.content_type}:${item.content_id}`]!.status
              }
              initialRating={
                statusMap[`${item.content_type}:${item.content_id}`]!.rating
              }
            />
          </div>
        )}
    </div>
  );
}

function RecommendationRow({
  item,
  onRead,
  onDelete,
  statusMap,
}: {
  item: RecommendationItem;
  onRead: (id: number) => void;
  onDelete: (id: number) => void;
  statusMap: StatusMap;
}) {
  const contentPath = `/${item.content_type === "movie" ? "movie" : "tv"}/${item.content_id}`;

  function handleRead() {
    if (!item.is_read) onRead(item.id);
  }

  return (
    <div
      className={`relative flex items-start gap-4 border rounded-xl p-4 transition-colors ${
        item.is_read
          ? "bg-neutral-800 border-neutral-700"
          : "bg-neutral-800 border-primary-600/50 ring-1 ring-primary-600/20"
      }`}
    >
      <Link to={contentPath} onClick={handleRead} className="flex-shrink-0">
        {item.content_poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w185${item.content_poster_path}`}
            alt={item.content_title ?? ""}
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
            to={`/user/${item.sender_username}`}
            className="text-xs font-semibold text-primary-400 hover:underline"
          >
            @{item.sender_username ?? "someone"}
          </Link>
          {!item.is_read && (
            <span className="ml-1 bg-primary-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              NEW
            </span>
          )}
        </div>

        <Link
          to={contentPath}
          onClick={handleRead}
          className="font-semibold text-neutral-100 hover:text-primary-400 transition-colors line-clamp-1 block"
        >
          {item.content_title ?? "Unknown"}
        </Link>

        {item.message && (
          <p className="text-sm text-neutral-400 mt-1 italic line-clamp-2">
            "{item.message}"
          </p>
        )}

        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-neutral-500">
            {timeAgo(item.created_at)}
          </span>
          {!item.is_read && (
            <button
              onClick={handleRead}
              className="text-xs text-neutral-500 hover:text-neutral-300 underline"
            >
              Mark read
            </button>
          )}
        </div>
      </div>

      <button
        onClick={() => onDelete(item.id)}
        title="Delete recommendation"
        className="absolute top-2 right-2 text-neutral-600 hover:text-error-400 transition-colors"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      {statusMap[`${item.content_type}:${item.content_id}`] !== undefined && (
        <div className="flex-shrink-0 self-center">
          <WatchButton
            compact
            contentType={item.content_type}
            contentId={item.content_id}
            initialStatus={
              statusMap[`${item.content_type}:${item.content_id}`]!.status
            }
            initialRating={
              statusMap[`${item.content_type}:${item.content_id}`]!.rating
            }
            onStatusChange={(status) => {
              if (status !== "none") handleRead();
            }}
          />
        </div>
      )}
    </div>
  );
}

type Tab = "mine" | "friends" | "recommendations";

export default function ActivityFeedPage() {
  usePageTitle("Activity");
  const user = useAuthUser();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("friends");

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

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Activity</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-neutral-700">
        <button
          onClick={() => setTab("mine")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "mine"
              ? "border-primary-500 text-primary-400"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          My Activity
        </button>
        <button
          onClick={() => setTab("friends")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "friends"
              ? "border-primary-500 text-primary-400"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Friends' Activity
        </button>
        <button
          onClick={() => setTab("recommendations")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors relative ${
            tab === "recommendations"
              ? "border-primary-500 text-primary-400"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Recommendations
          {unreadCount > 0 && (
            <span className="ml-1.5 bg-primary-600 text-white text-xs font-bold rounded-full px-1.5 py-0.5">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* My Activity tab */}
      {tab === "mine" && (
        <>
          {myLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!myLoading && myItems.length === 0 && (
            <div className="text-center py-20 text-neutral-400">
              <p className="text-lg mb-2">No activity yet</p>
              <p className="text-sm">
                Start tracking shows and movies to see your history here.
              </p>
            </div>
          )}
          {!myLoading && myItems.length > 0 && (
            <div className="flex flex-col gap-3">
              {myItems.map((item) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  currentUserId={currentUserId}
                  statusMap={statusMap}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Friends' Activity tab */}
      {tab === "friends" && (
        <>
          {friendsLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!friendsLoading && friendItems.length === 0 && (
            <div className="text-center py-20 text-neutral-400">
              <p className="text-lg mb-2">No friend activity yet</p>
              <p className="text-sm">
                Add friends to see what they're watching.
              </p>
              <Link
                to="/profile"
                className="mt-4 inline-block text-primary-400 hover:underline text-sm"
              >
                Find friends →
              </Link>
            </div>
          )}
          {!friendsLoading && friendItems.length > 0 && (
            <div className="flex flex-col gap-3">
              {friendItems.map((item) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  currentUserId={currentUserId}
                  statusMap={statusMap}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Recommendations tab */}
      {tab === "recommendations" && (
        <>
          {recsLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!recsLoading && recommendations.length === 0 && (
            <div className="text-center py-20 text-neutral-400">
              <p className="text-lg mb-2">No recommendations yet</p>
              <p className="text-sm">
                When a friend recommends a show or movie, it will appear here.
              </p>
              <p className="text-sm mt-1">
                Visit a friend's profile to recommend something to them, or{" "}
                <Link
                  to="/profile"
                  className="text-primary-400 hover:underline"
                >
                  find friends
                </Link>{" "}
                to get started.
              </p>
            </div>
          )}

          {!recsLoading && recommendations.length > 0 && (
            <div className="flex flex-col gap-3">
              {recommendations.map((rec) => (
                <RecommendationRow
                  key={rec.id}
                  item={rec}
                  onRead={markRead}
                  onDelete={deleteRec}
                  statusMap={statusMap}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
