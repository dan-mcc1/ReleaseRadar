import { useAuthUser } from "../hooks/useAuthUser";
import { useWatchStatus } from "../hooks/api/useWatchStatus";
import { useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import type { WatchStatus } from "./WatchButton";

interface MiniWatchedButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
  initialStatus?: WatchStatus;
  /** Set true when the parent is managing status via a bulk fetch — always skips the per-item query. */
  bulkManaged?: boolean;
}

export default function MiniWatchedButton({ contentType, contentId, initialStatus, bulkManaged = false }: MiniWatchedButtonProps) {
  const user = useAuthUser();
  const statusQuery = useWatchStatus(contentType, contentId, { skip: bulkManaged });
  const updateMutation = useUpdateWatchStatus();

  const status: WatchStatus = initialStatus ?? statusQuery.data?.status ?? "none";
  const loading = (!bulkManaged && statusQuery.isPending) || updateMutation.isPending;
  const isWatched = status === "Watched";

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!user || loading) return;
    const targetStatus: WatchStatus = isWatched ? "none" : "Watched";
    updateMutation.mutate({ contentType, contentId, currentStatus: status, targetStatus });
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={isWatched ? "Watched" : "Mark as watched"}
      className={`flex-shrink-0 transition-colors disabled:opacity-40 ${
        isWatched ? "text-success-400" : "text-neutral-600 hover:text-neutral-400"
      }`}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
  );
}
