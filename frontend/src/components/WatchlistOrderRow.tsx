import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BASE_IMAGE_URL } from "../constants";
import type { BingePlan } from "../hooks/api/useBingePlan";

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface WatchlistOrderRowProps {
  dndId: string;
  rank: number;
  title: string;
  posterPath: string | null;
  year: string;
  contentType: "movie" | "tv";
  voteAverage?: number;
  userRating?: number | null;
  genres?: { id: number; name: string }[];
  bingePlan?: BingePlan | null;
  isFirst: boolean;
  isLast: boolean;
  isDragDisabled?: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToTop: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export default function WatchlistOrderRow({
  dndId,
  rank,
  title,
  posterPath,
  year,
  contentType,
  voteAverage,
  userRating,
  genres,
  bingePlan,
  isFirst,
  isLast,
  isDragDisabled = false,
  onMoveUp,
  onMoveDown,
  onMoveToTop,
  onDelete,
  onClick,
}: WatchlistOrderRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dndId, disabled: isDragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-3 hover:border-neutral-600 transition-colors"
    >
      {/* Drag handle */}
      {!isDragDisabled && (
        <div
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label="Drag to reorder"
          className="text-neutral-600 hover:text-neutral-400 cursor-grab active:cursor-grabbing touch-none flex-shrink-0 px-0.5"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          </svg>
        </div>
      )}

      {/* Rank + arrows */}
      <div className="flex flex-col gap-0.5 items-center flex-shrink-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label="Move up"
          className="text-neutral-500 hover:text-neutral-300 disabled:opacity-20 disabled:cursor-not-allowed p-0.5 rounded transition-colors"
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
              d="M5 15l7-7 7 7"
            />
          </svg>
        </button>
        <span
          aria-label={`Rank ${rank}`}
          className="text-neutral-500 text-xs font-bold text-center leading-none"
        >
          #{rank}
        </span>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          aria-label="Move down"
          className="text-neutral-500 hover:text-neutral-300 disabled:opacity-20 disabled:cursor-not-allowed p-0.5 rounded transition-colors"
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
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>

      {/* Poster */}
      <div
        className="w-16 flex-shrink-0 rounded-lg overflow-hidden bg-neutral-700 cursor-pointer self-stretch"
        style={{ minHeight: "96px" }}
        onClick={onClick}
      >
        <div className="aspect-[2/3] h-full">
          {posterPath ? (
            <img
              src={`${BASE_IMAGE_URL}/w185${posterPath}`}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-neutral-500">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 cursor-pointer py-0.5" onClick={onClick}>
        <p className="text-sm font-semibold text-white truncate mb-1.5">
          {title}
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
              contentType === "tv"
                ? "bg-highlight-600/70 text-highlight-100"
                : "bg-amber-600/70 text-amber-100"
            }`}
          >
            {contentType === "tv" ? "TV" : "Movie"}
          </span>
          {year && <span className="text-xs text-neutral-400">{year}</span>}
          {voteAverage != null && voteAverage > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-warning-400 font-medium">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
              {voteAverage.toFixed(1)}
            </span>
          )}
          {genres &&
            genres.slice(0, 2).map((g) => (
              <span
                key={g.id}
                className="text-xs text-neutral-500 bg-neutral-700/60 px-1.5 py-0.5 rounded"
              >
                {g.name}
              </span>
            ))}
        </div>
        {bingePlan && bingePlan.remaining_episodes > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <svg className="w-3 h-3 text-primary-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
            </svg>
            <span className="text-xs text-neutral-400">
              {fmtMins(bingePlan.remaining_minutes)} left
              {bingePlan.completion_estimate && (
                <span className="text-primary-400"> · {bingePlan.completion_estimate}</span>
              )}
            </span>
          </div>
        )}

        {userRating != null && (
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <svg
                key={s}
                className={`w-3.5 h-3.5 ${s <= userRating ? "text-warning-400" : "text-neutral-600"}`}
                viewBox="0 0 24 24"
                fill={s <= userRating ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={s <= userRating ? 0 : 1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                />
              </svg>
            ))}
          </div>
        )}
      </div>

      {/* Move to top + Delete */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          onClick={onMoveToTop}
          disabled={isFirst}
          aria-label="Move to top"
          className="text-neutral-500 hover:text-neutral-300 disabled:opacity-20 disabled:cursor-not-allowed p-1 rounded transition-colors"
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
              d="M5 11l7-7 7 7M5 19l7-7 7 7"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Remove from watchlist"
          className="text-red-500 hover:text-red-400 p-1 rounded transition-colors"
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
      </div>
    </div>
  );
}
