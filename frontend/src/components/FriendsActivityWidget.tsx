import { useFriendsContentActivity } from "../hooks/api/useFriends";
import StarIcon from "./icons/StarIcon";

interface Props {
  contentType: "movie" | "tv";
  contentId: number;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5 text-warning-400 text-xs font-medium">
      <StarIcon filled className="w-3 h-3" />
      {rating % 1 === 0 ? rating.toFixed(0) : rating.toFixed(1)}
    </span>
  );
}

const STATUS_CONFIG = {
  "Watched": { color: "text-success-400", dot: "bg-success-400" },
  "Currently Watching": { color: "text-highlight-400", dot: "bg-highlight-400" },
  "Want To Watch": { color: "text-primary-400", dot: "bg-primary-400" },
} as const;

export default function FriendsActivityWidget({ contentType, contentId }: Props) {
  const { data, isPending } = useFriendsContentActivity(contentType, contentId);

  if (isPending) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 animate-pulse">
        <div className="h-2.5 bg-neutral-800 rounded w-24 mb-4" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-neutral-800" />
              <div className="h-2.5 bg-neutral-800 rounded w-28" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const watched = data.filter((f) => f.status === "Watched");
  const currentlyWatching = data.filter((f) => f.status === "Currently Watching");
  const wantToWatch = data.filter((f) => f.status === "Want To Watch");
  const withRatings = watched.filter((f) => f.rating != null);

  const summaryParts: string[] = [];
  if (watched.length > 0)
    summaryParts.push(`${watched.length} watched`);
  if (currentlyWatching.length > 0)
    summaryParts.push(`${currentlyWatching.length} watching`);
  if (wantToWatch.length > 0)
    summaryParts.push(`${wantToWatch.length} want to watch`);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
      <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-1">Friends</div>
      <p className="text-xs text-neutral-400 mb-4">{summaryParts.join(" · ")}</p>

      <div className="flex flex-col gap-2.5">
        {data.map((friend) => {
          const cfg = STATUS_CONFIG[friend.status as keyof typeof STATUS_CONFIG];
          return (
            <div key={friend.username} className="flex items-center gap-2.5">
              {/* Avatar placeholder */}
              <div className="w-6 h-6 rounded-full bg-neutral-700 flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-neutral-300 uppercase">
                {friend.username[0]}
              </div>
              <span className="text-sm text-neutral-200 font-medium flex-1 min-w-0 truncate">
                {friend.username}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {friend.rating != null && <StarRating rating={friend.rating} />}
                <span className={`text-xs ${cfg?.color ?? "text-neutral-500"}`}>
                  {friend.status === "Want To Watch" ? "Wants to watch" : friend.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {withRatings.length >= 2 && (() => {
        const avg = withRatings.reduce((s, f) => s + f.rating!, 0) / withRatings.length;
        return (
          <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center gap-1.5 text-xs text-neutral-500">
            <StarIcon filled className="w-3 h-3 text-warning-400" />
            Friend avg: <span className="text-neutral-300 font-medium">{avg.toFixed(1)}</span>
          </div>
        );
      })()}
    </div>
  );
}
