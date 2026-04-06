import { useState, useEffect, useRef } from "react";
import { getAuth, User } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL } from "../constants";
import StarRating from "./StarRating";
import { clearDashboardCache } from "../utils/dashboardCache";
import { clearWatchlistCache } from "../utils/watchlistCache";
import { clearForYouCache } from "../pages/ForYou";
import { updateCachedStatus } from "../utils/statusCache";

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
}: WatchButtonProps) {
  const auth = getAuth(firebaseApp);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>(
    initialStatus ?? "none",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [statusLoading, setStatusLoading] = useState(
    initialStatus === undefined,
  );
  const [rating, setRating] = useState<number | null>(initialRating ?? null);
  const [ratingSaving, setRatingSaving] = useState(false);

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

  useEffect(() => {
    // Skip individual fetch when the parent already provided the status
    if (initialStatus !== undefined) return;

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) fetchStatus(user);
      else {
        setWatchStatus("none");
        setStatusLoading(false);
      }
    });
    return unsubscribe;
  }, [contentId]);

  async function fetchStatus(user: User) {
    try {
      setStatusLoading(true);
      const res = await fetch(
        `${API_URL}/watchlist/${contentType}/${contentId}/status`,
        {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        },
      );
      if (!res.ok) throw new Error("Failed to fetch watch status");
      const data = await res.json();
      setWatchStatus(data.status);
      setRating(data.rating ?? null);
    } catch (err) {
      console.error(err);
    } finally {
      setStatusLoading(false);
    }
  }

  async function updateWatchStatus(targetStatus: WatchStatus) {
    const user = auth.currentUser;
    if (!user) {
      alert("You must be signed in.");
      return;
    }

    const token = await user.getIdToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({
      content_type: contentType,
      content_id: contentId,
    });

    const removeEndpoints: Record<WatchStatus, string | null> = {
      none: null,
      "Want To Watch": "watchlist/remove",
      "Currently Watching": "currently-watching/remove",
      Watched: "watched/remove",
    };
    const addEndpoints: Record<WatchStatus, string | null> = {
      none: null,
      "Want To Watch": "watchlist/add",
      "Currently Watching": "currently-watching/add",
      Watched: "watched/add",
    };

    try {
      setSaving(true);

      if (watchStatus === targetStatus) return;

      // Add to target state first so the new entry exists before the old one
      // is removed. This prevents cleanup logic in the remove handlers from
      // treating the show as untracked (e.g. deleting episode history).
      const addUrl = addEndpoints[targetStatus];
      if (addUrl) {
        await fetch(`${API_URL}/${addUrl}`, { method: "POST", headers, body });
      }

      // Remove from current state
      const removeUrl = removeEndpoints[watchStatus];
      if (removeUrl) {
        await fetch(`${API_URL}/${removeUrl}`, {
          method: "DELETE",
          headers,
          body,
        });
      }

      const newRating = targetStatus !== "Watched" ? null : rating;
      setWatchStatus(targetStatus);
      onStatusChange?.(targetStatus);
      if (targetStatus !== "Watched") setRating(null);
      setMenuOpen(false);
      clearDashboardCache();
      clearWatchlistCache();
      clearForYouCache();
      if (user)
        updateCachedStatus(
          user.uid,
          contentType,
          contentId,
          targetStatus,
          newRating,
        );
    } catch (err) {
      console.error(err);
      alert("Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  async function saveRating(newRating: number | null) {
    const user = auth.currentUser;
    if (!user) return;
    try {
      setRatingSaving(true);
      await fetch(`${API_URL}/watched/rate`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          rating: newRating,
        }),
      });
      setRating(newRating);
      clearDashboardCache();
      clearWatchlistCache();
      clearForYouCache();
      if (user)
        updateCachedStatus(
          user.uid,
          contentType,
          contentId,
          watchStatus,
          newRating,
        );
    } catch (err) {
      console.error(err);
    } finally {
      setRatingSaving(false);
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
              ? updateWatchStatus("Want To Watch")
              : setMenuOpen((o) => !o)
          }
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-l-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${mainClass}`}
        >
          {saving || statusLoading ? <IconSpinner /> : icon}
          {statusLoading ? "Loading…" : saving ? "Saving…" : label}
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
          <div className="absolute left-0 top-full mt-2 w-52 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden">
            {watchStatus !== "Want To Watch" && (
              <button
                onClick={() => updateWatchStatus("Want To Watch")}
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
                onClick={() => updateWatchStatus("Currently Watching")}
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
                onClick={() => updateWatchStatus("Watched")}
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
                  onClick={() => updateWatchStatus("none")}
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
        <StarRating rating={rating} onRate={saveRating} saving={ratingSaving} />
      )}
    </div>
  );
}
