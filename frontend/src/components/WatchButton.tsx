import { useState, useEffect, useRef } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import StarRating from "./StarRating";
import { useWatchStatus } from "../hooks/api/useWatchStatus";
import { useUpdateWatchStatus, useRateItem } from "../hooks/api/useWatchActions";

export type WatchStatus =
  | "none"
  | "Want To Watch"
  | "Currently Watching"
  | "Watched";

interface WatchButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
  /** When provided by a parent doing a bulk fetch, skip the per-item status request. */
  initialStatus?: WatchStatus;
  initialRating?: number | null;
  onStatusChange?: (status: WatchStatus) => void;
  /** Kept for backward compatibility — no longer used (query auto-refetches on invalidation). */
  refreshKey?: number;
  /** Icon-only mode with tighter padding — use in space-constrained rows. */
  compact?: boolean;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function IconBookmarkPlus() {
  return (
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
        d="M17 3H7a2 2 0 00-2 2v16l7-3.5L19 21V5a2 2 0 00-2-2z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m-2-2h4" />
    </svg>
  );
}

function IconBookmarkFilled() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 3H7a2 2 0 00-2 2v16l7-3.5L19 21V5a2 2 0 00-2-2z" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function WatchButton({
  contentType,
  contentId,
  initialStatus,
  initialRating,
  onStatusChange,
  compact = false,
}: WatchButtonProps) {
  const user = useAuthUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const statusQuery = useWatchStatus(contentType, contentId, {
    skip: initialStatus !== undefined,
  });
  const updateMutation = useUpdateWatchStatus();
  const rateMutation = useRateItem();

  // Derive state from either props or query
  const watchStatus: WatchStatus =
    initialStatus ?? statusQuery.data?.status ?? "none";
  const rating: number | null =
    initialRating ?? statusQuery.data?.rating ?? null;
  const statusLoading = initialStatus === undefined && statusQuery.isPending;
  const saving = updateMutation.isPending;
  const ratingSaving = rateMutation.isPending;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleStatusChange(targetStatus: WatchStatus) {
    if (!user) { alert("You must be signed in."); return; }
    if (watchStatus === targetStatus) return;
    try {
      await updateMutation.mutateAsync({
        contentType,
        contentId,
        currentStatus: watchStatus,
        targetStatus,
      });
      onStatusChange?.(targetStatus);
      setMenuOpen(false);
    } catch (err) {
      console.error(err);
      alert("Failed to update status");
    }
  }

  async function handleRate(newRating: number | null) {
    if (!user) return;
    try {
      await rateMutation.mutateAsync({ contentType, contentId, rating: newRating });
    } catch (err) {
      console.error(err);
    }
  }

  // ── Visual config per status ──

  const config = {
    none: {
      mainClass:
        "bg-primary-600 hover:bg-primary-500 text-white border border-primary-500",
      chevronClass:
        "bg-primary-700 hover:bg-primary-600 border-l border-primary-500 text-white",
      icon: <IconBookmarkPlus />,
      label: "Add to Watchlist",
    },
    "Want To Watch": {
      mainClass:
        "bg-neutral-700 hover:bg-neutral-600 text-primary-300 border border-primary-500/60",
      chevronClass:
        "bg-neutral-700 hover:bg-neutral-600 border-l border-primary-500/40 text-primary-400",
      icon: <IconBookmarkFilled />,
      label: "On Watchlist",
    },
    "Currently Watching": {
      mainClass:
        "bg-highlight-900/40 hover:bg-highlight-900/60 text-highlight-300 border border-highlight-600/60",
      chevronClass:
        "bg-highlight-900/40 hover:bg-highlight-900/60 border-l border-highlight-600/40 text-highlight-400",
      icon: <IconPlay />,
      label: "Watching",
    },
    Watched: {
      mainClass:
        "bg-success-900/40 hover:bg-success-900/60 text-success-300 border border-success-600/60",
      chevronClass:
        "bg-success-900/40 hover:bg-success-900/60 border-l border-success-600/40 text-success-400",
      icon: <IconCheckCircle />,
      label: "Watched",
    },
  } as const;

  const { mainClass, chevronClass, icon, label } = config[watchStatus];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative inline-flex" ref={dropdownRef}>
        {/* Main button */}
        <button
          disabled={saving || statusLoading}
          onClick={() =>
            watchStatus === "none"
              ? handleStatusChange("Want To Watch")
              : setMenuOpen((o) => !o)
          }
          className={`flex items-center gap-2 ${compact ? "px-2.5 sm:px-4 py-2" : "px-4 py-2"} text-sm font-semibold rounded-l-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${mainClass}`}
        >
          {saving || statusLoading ? <IconSpinner /> : icon}
          {compact ? (
            <span className="hidden sm:inline">{statusLoading ? "Loading…" : saving ? "Saving…" : label}</span>
          ) : (
            statusLoading ? "Loading…" : saving ? "Saving…" : label
          )}
        </button>

        {/* Chevron dropdown toggle */}
        <button
          disabled={saving || statusLoading}
          onClick={() => setMenuOpen((o) => !o)}
          className={`flex items-center justify-center px-2.5 rounded-r-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${chevronClass}`}
          aria-label="More options"
        >
          <span
            className={`transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
          >
            <IconChevronDown />
          </span>
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className={`absolute top-full mt-2 w-52 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden ${compact ? "right-0 sm:right-auto sm:left-0" : "left-0"}`}>
            {watchStatus !== "Want To Watch" && (
              <button
                onClick={() => handleStatusChange("Want To Watch")}
                className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                <span className="text-primary-400">
                  <IconBookmarkPlus />
                </span>
                Want to Watch
              </button>
            )}

            {watchStatus !== "Currently Watching" && (
              <button
                onClick={() => handleStatusChange("Currently Watching")}
                className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                <span className="text-highlight-400">
                  <IconPlay />
                </span>
                Currently Watching
              </button>
            )}

            {watchStatus !== "Watched" && (
              <button
                onClick={() => handleStatusChange("Watched")}
                className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                <span className="text-success-400">
                  <IconCheckCircle />
                </span>
                Mark as Watched
              </button>
            )}

            {watchStatus !== "none" && (
              <>
                <div className="border-t border-neutral-700 mx-3" />
                <button
                  onClick={() => handleStatusChange("none")}
                  className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-error-400 hover:bg-error-600/10 transition-colors"
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
                  {watchStatus === "Watched"
                    ? "Remove from Watched"
                    : watchStatus === "Currently Watching"
                      ? "Remove from Watching"
                      : "Remove from Watchlist"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {watchStatus === "Watched" && (
        <div className={compact ? "hidden sm:block" : undefined}>
          <StarRating rating={rating} onRate={handleRate} saving={ratingSaving} />
        </div>
      )}
    </div>
  );
}
