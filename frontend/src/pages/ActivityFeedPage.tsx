import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL, BASE_IMAGE_URL } from "../constants";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import WatchButton from "../components/WatchButton";

interface ActivityItem {
  id: number;
  user_id: string;
  username: string | null;
  activity_type: "watched" | "currently_watching" | "want_to_watch" | "rated" | "episode_watched";
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
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-yellow-400 text-xs">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className={`w-3 h-3 ${i < Math.round(rating) ? "fill-current" : "fill-slate-600"}`} viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      <span className="text-slate-400 ml-1">{rating}/5</span>
    </span>
  );
}

function ActivityRow({ item, currentUserId }: { item: ActivityItem; currentUserId: string }) {
  const isMe = item.user_id === currentUserId;
  const nameLabel = isMe ? "You" : (item.username ?? "Someone");
  const contentPath = `/${item.content_type === "movie" ? "movie" : "tv"}/${item.content_id}`;

  const badge = {
    watched: { color: "text-green-400", icon: "✓", label: "watched" },
    currently_watching: { color: "text-purple-400", icon: "▶", label: "started watching" },
    want_to_watch: { color: "text-blue-400", icon: "🔖", label: "added to watchlist" },
    rated: { color: "text-yellow-400", icon: "★", label: "rated" },
    episode_watched: { color: "text-teal-400", icon: "▶", label: "watched an episode of" },
  }[item.activity_type];

  return (
    <div className="flex items-start gap-4 bg-slate-800 border border-slate-700 rounded-xl p-4">
      <Link to={contentPath} className="flex-shrink-0">
        {item.content_poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w92${item.content_poster_path}`}
            alt={item.content_title ?? ""}
            className="w-12 h-[72px] rounded-lg object-cover hover:opacity-80 transition-opacity"
          />
        ) : (
          <div className="w-12 h-[72px] bg-slate-700 rounded-lg" />
        )}
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-xs font-bold ${badge.color}`}>{badge.icon}</span>
          <span className="text-xs text-slate-400">{badge.label}</span>
        </div>

        <Link to={contentPath} className="font-semibold text-slate-100 hover:text-blue-400 transition-colors line-clamp-1 block">
          {item.content_title ?? "Unknown"}
        </Link>

        {item.activity_type === "episode_watched" && item.season_number != null && item.episode_number != null && (
          <p className="text-xs text-slate-400 mt-0.5">
            S{String(item.season_number).padStart(2, "0")}E{String(item.episode_number).padStart(2, "0")}
          </p>
        )}

        {item.activity_type === "rated" && item.rating != null && (
          <div className="mt-1">
            <StarDisplay rating={item.rating} />
          </div>
        )}

        <div className="flex items-center gap-2 mt-1.5">
          {isMe ? (
            <span className="text-sm font-semibold text-slate-300">You</span>
          ) : (
            <Link to={`/user/${item.username}`} className="text-sm font-semibold text-blue-400 hover:underline">
              {nameLabel}
            </Link>
          )}
          <span className="text-slate-600">·</span>
          <span className="text-xs text-slate-500">{timeAgo(item.created_at)}</span>
        </div>
      </div>

      {!isMe && (
        <div className="flex-shrink-0 self-center">
          <WatchButton contentType={item.content_type} contentId={item.content_id} />
        </div>
      )}
    </div>
  );
}

function RecommendationRow({
  item,
  onRead,
}: {
  item: RecommendationItem;
  onRead: (id: number) => void;
}) {
  const contentPath = `/${item.content_type === "movie" ? "movie" : "tv"}/${item.content_id}`;

  function handleRead() {
    if (!item.is_read) onRead(item.id);
  }

  return (
    <div
      className={`flex items-start gap-4 border rounded-xl p-4 transition-colors ${
        item.is_read
          ? "bg-slate-800 border-slate-700"
          : "bg-slate-800 border-blue-600/50 ring-1 ring-blue-600/20"
      }`}
    >
      <Link to={contentPath} onClick={handleRead} className="flex-shrink-0">
        {item.content_poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w92${item.content_poster_path}`}
            alt={item.content_title ?? ""}
            className="w-12 h-[72px] rounded-lg object-cover hover:opacity-80 transition-opacity"
          />
        ) : (
          <div className="w-12 h-[72px] bg-slate-700 rounded-lg" />
        )}
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-bold text-pink-400">♥</span>
          <span className="text-xs text-slate-400">recommended by</span>
          <Link to={`/user/${item.sender_username}`} className="text-xs font-semibold text-blue-400 hover:underline">
            @{item.sender_username ?? "someone"}
          </Link>
          {!item.is_read && (
            <span className="ml-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">NEW</span>
          )}
        </div>

        <Link to={contentPath} onClick={handleRead} className="font-semibold text-slate-100 hover:text-blue-400 transition-colors line-clamp-1 block">
          {item.content_title ?? "Unknown"}
        </Link>

        {item.message && (
          <p className="text-sm text-slate-400 mt-1 italic line-clamp-2">"{item.message}"</p>
        )}

        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-slate-500">{timeAgo(item.created_at)}</span>
          {!item.is_read && (
            <button
              onClick={handleRead}
              className="text-xs text-slate-500 hover:text-slate-300 underline"
            >
              Mark read
            </button>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 self-center">
        <WatchButton
          contentType={item.content_type}
          contentId={item.content_id}
          onStatusChange={(status) => { if (status !== "none") handleRead(); }}
        />
      </div>
    </div>
  );
}

type Tab = "activity" | "recommendations";

export default function ActivityFeedPage() {
  usePageTitle("Activity");
  const auth = getAuth(firebaseApp);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("activity");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recsLoading, setRecsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) { navigate("/signIn"); return; }
      setCurrentUserId(user.uid);
      const tok = await user.getIdToken();
      setToken(tok);

      try {
        const res = await fetch(`${API_URL}/friends/feed`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.ok) setItems(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }

      try {
        const res = await fetch(`${API_URL}/recommendations/inbox`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.ok) setRecommendations(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        setRecsLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Refetch recommendations inbox when a new one arrives via SSE
  useEffect(() => {
    async function handler() {
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/recommendations/inbox`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setRecommendations(await res.json());
      } catch {
        // non-critical
      }
    }
    window.addEventListener("recommendation-received", handler);
    return () => window.removeEventListener("recommendation-received", handler);
  }, [token]);

  async function markRead(id: number) {
    setRecommendations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_read: true } : r))
    );
    try {
      const res = await fetch(`${API_URL}/recommendations/${id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent("rec-marked-read"));
      } else {
        setRecommendations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, is_read: false } : r))
        );
      }
    } catch {
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_read: false } : r))
      );
    }
  }

  const unreadCount = recommendations.filter((r) => !r.is_read).length;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Activity</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-700">
        <button
          onClick={() => setTab("activity")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "activity"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Feed
        </button>
        <button
          onClick={() => setTab("recommendations")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors relative ${
            tab === "recommendations"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Recommendations
          {unreadCount > 0 && (
            <span className="ml-1.5 bg-blue-600 text-white text-xs font-bold rounded-full px-1.5 py-0.5">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Activity tab */}
      {tab === "activity" && (
        <>
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="text-center py-20 text-slate-400">
              <p className="text-lg mb-2">No activity yet</p>
              <p className="text-sm">Start tracking shows and movies to see your history here.</p>
              <Link to="/profile" className="mt-4 inline-block text-blue-400 hover:underline text-sm">
                Find friends →
              </Link>
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <ActivityRow key={item.id} item={item} currentUserId={currentUserId} />
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
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!recsLoading && recommendations.length === 0 && (
            <div className="text-center py-20 text-slate-400">
              <p className="text-lg mb-2">No recommendations yet</p>
              <p className="text-sm">When a friend recommends a show or movie, it will appear here.</p>
              <p className="text-sm mt-1">
                Visit a friend's profile to recommend something to them, or{" "}
                <Link to="/profile" className="text-blue-400 hover:underline">find friends</Link>
                {" "}to get started.
              </p>
            </div>
          )}

          {!recsLoading && recommendations.length > 0 && (
            <div className="flex flex-col gap-3">
              {recommendations.map((rec) => (
                <RecommendationRow key={rec.id} item={rec} onRead={markRead} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
