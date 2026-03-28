import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL, BASE_IMAGE_URL } from "../constants";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";

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
    </div>
  );
}

export default function ActivityFeedPage() {
  usePageTitle("Activity");
  const auth = getAuth(firebaseApp);
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) { navigate("/signIn"); return; }
      setCurrentUserId(user.uid);
      try {
        const res = await fetch(`${API_URL}/friends/feed`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        if (res.ok) setItems(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Activity</h1>

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
    </div>
  );
}
