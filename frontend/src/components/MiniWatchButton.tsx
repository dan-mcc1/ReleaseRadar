import { useAuthUser } from "../hooks/useAuthUser";
import { useWatchStatus } from "../hooks/api/useWatchStatus";
import { useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import type { WatchStatus } from "./WatchButton";

interface MiniWatchButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
  initialStatus?: WatchStatus;
  /** Set true when the parent is managing status via a bulk fetch — always skips the per-item query. */
  bulkManaged?: boolean;
}

export default function MiniWatchButton({ contentType, contentId, initialStatus, bulkManaged = false }: MiniWatchButtonProps) {
  const user = useAuthUser();
  const statusQuery = useWatchStatus(contentType, contentId, { skip: bulkManaged });
  const updateMutation = useUpdateWatchStatus();

  const status: WatchStatus = initialStatus ?? statusQuery.data?.status ?? "none";
  const loading = (!bulkManaged && statusQuery.isPending) || updateMutation.isPending;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!user || loading) return;
    const targetStatus: WatchStatus = status === "none" ? "Want To Watch" : "none";
    updateMutation.mutate({ contentType, contentId, currentStatus: status, targetStatus });
  }

  const colorClass =
    status === "Watched"
      ? "text-success-400"
      : status === "Currently Watching"
        ? "text-highlight-400"
        : status === "Want To Watch"
          ? "text-primary-400"
          : "text-neutral-600 hover:text-neutral-400";

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={status === "none" ? "Add to watchlist" : status}
      className={`flex-shrink-0 transition-colors disabled:opacity-40 ${colorClass}`}
    >
      {status === "none" ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H7a2 2 0 00-2 2v16l7-3.5L19 21V5a2 2 0 00-2-2z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m-2-2h4" />
        </svg>
      ) : status === "Watched" ? (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : status === "Currently Watching" ? (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 3H7a2 2 0 00-2 2v16l7-3.5L19 21V5a2 2 0 00-2-2z" />
        </svg>
      )}
    </button>
  );
}
