import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BASE_IMAGE_URL } from "../constants";
import type { ShowProgress } from "../hooks/api/useBingePlan";
import ContentRatingBadge from "./media/ContentRatingBadge";
import { ChevronDoubleUpIcon, ClockIcon, Bars3Icon } from "@heroicons/react/24/outline";
import { ChevronDownIcon, CloseIcon, IconButton, StarIcon } from "./ui";

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
  certification?: string | null;
  bingePlan?: ShowProgress | null;
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
  certification,
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
      className="flex items-center gap-3 bg-neutral-800 border border-neutral-700 rounded-surface px-3 py-3 hover:border-neutral-600 transition-colors"
    >
      {/* Drag handle */}
      {!isDragDisabled && (
        <IconButton
          {...attributes}
          {...listeners}
          label="Drag to reorder"
          icon={<Bars3Icon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
          size="sm"
          className="cursor-grab active:cursor-grabbing touch-none"
        />
      )}

      {/* Rank + arrows */}
      <div className="flex flex-col gap-0.5 items-center flex-shrink-0">
        <IconButton
          label="Move up"
          icon={<ChevronDownIcon className="w-4 h-4 rotate-180" />}
          size="sm"
          onClick={onMoveUp}
          disabled={isFirst}
        />
        <span aria-label={`Rank ${rank}`} className="text-neutral-400 text-caption font-semibold text-center leading-none tabular">
          #{rank}
        </span>
        <IconButton
          label="Move down"
          icon={<ChevronDownIcon className="w-4 h-4" />}
          size="sm"
          onClick={onMoveDown}
          disabled={isLast}
        />
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
            <div className="w-full h-full flex items-center justify-center p-1 text-center text-caption text-neutral-400">
              {title}
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 cursor-pointer py-0.5" onClick={onClick}>
        <p className="text-body font-semibold text-white truncate mb-1.5">
          {title}
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            className={`text-caption font-medium px-1.5 py-0.5 rounded-full ${
              contentType === "tv"
                ? "bg-highlight-600/70 text-highlight-100"
                : "bg-warning-600/70 text-warning-100"
            }`}
          >
            {contentType === "tv" ? "TV" : "Movie"}
          </span>
          {certification && <ContentRatingBadge rating={certification} />}
          {year && <span className="text-caption text-neutral-400">{year}</span>}
          {voteAverage != null && voteAverage > 0 && (
            <span className="flex items-center gap-0.5 text-caption text-warning-400 font-medium">
              <StarIcon className="w-3 h-3" />
              {voteAverage.toFixed(1)}
            </span>
          )}
          {genres &&
            genres.map((g) => (
              <span
                key={g.id}
                className="text-caption text-neutral-400 bg-neutral-700/60 px-1.5 py-0.5 rounded"
              >
                {g.name}
              </span>
            ))}
        </div>
        {bingePlan && bingePlan.remaining_episodes > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <ClockIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="text-caption text-neutral-400">
              {fmtMins(bingePlan.remaining_minutes)} left
              {bingePlan.completion_estimate && (
                <span className="text-neutral-300"> · {bingePlan.completion_estimate}</span>
              )}
            </span>
          </div>
        )}

        {userRating != null && (
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <StarIcon
                key={s}
                filled={s <= userRating}
                className={`w-3.5 h-3.5 ${s <= userRating ? "text-warning-400" : "text-neutral-600"}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Move to top + Delete */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <IconButton
          label="Move to top"
          icon={<ChevronDoubleUpIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
          size="sm"
          onClick={onMoveToTop}
          disabled={isFirst}
        />
        <IconButton
          label="Remove from watchlist"
          icon={<CloseIcon className="w-4 h-4 text-error-400" />}
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </div>
    </div>
  );
}
