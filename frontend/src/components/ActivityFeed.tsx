import { useState } from "react";
import { BASE_IMAGE_URL } from "../constants";
import { Link } from "react-router-dom";
import { useFriendsActivity } from "../hooks/api/useActivity";

interface ActivityItem {
  id: number;
  user_id: string;
  username: string | null;
  activity_type: "watched" | "currently_watching" | "want_to_watch";
  content_type: "movie" | "tv";
  content_id: number;
  content_title: string | null;
  content_poster_path: string | null;
  created_at: string;
}

function activityLabel(type: ActivityItem["activity_type"]) {
  if (type === "watched") return "watched";
  if (type === "currently_watching") return "started watching";
  return "added to watchlist";
}

function timeAgo(isoString: string) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ActivityFeed() {
  const { data, isLoading } = useFriendsActivity();
  const items = (data as ActivityItem[] | undefined) ?? [];
  const [open, setOpen] = useState(false);

  if (isLoading || items.length === 0) return null;

  return (
    <div className="border-b border-neutral-700 bg-neutral-800/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 sm:px-6 py-3 hover:bg-neutral-700/40 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-primary-400 flex-shrink-0">
          <path d="M12 2a5 5 0 110 10A5 5 0 0112 2zm0 12c5.33 0 8 2.67 8 4v2H4v-2c0-1.33 2.67-4 8-4z" />
        </svg>
        <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">
          Friends' Activity
        </h2>
        <span className="text-xs text-neutral-500 font-normal normal-case tracking-normal">
          — {items.length} update{items.length !== 1 ? "s" : ""}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className={`w-4 h-4 ml-auto text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 sm:px-6 pb-4 pt-1 flex flex-col gap-2 max-h-72 overflow-y-auto">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 bg-neutral-900/60 border border-neutral-700 rounded-xl p-2.5">
              {item.content_poster_path ? (
                <img
                  src={`${BASE_IMAGE_URL}/w185${item.content_poster_path}`}
                  alt={item.content_title ?? ""}
                  className="w-9 h-[54px] rounded-lg flex-shrink-0 object-cover"
                />
              ) : (
                <div className="w-9 h-[54px] bg-neutral-700 rounded-lg flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-neutral-300 leading-snug">
                  <span className="font-semibold text-neutral-100">{item.username ?? "Someone"}</span>
                  {" "}{activityLabel(item.activity_type)}{" "}
                  <Link
                    to={`/${item.content_type === "movie" ? "movie" : "tv"}/${item.content_id}`}
                    className="font-semibold text-primary-400 hover:underline"
                  >
                    {item.content_title ?? "Unknown"}
                  </Link>
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">{timeAgo(item.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
