import { useState, useEffect, useRef } from "react";
import { getAuth, User } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL } from "../constants";
import StarRating from "./StarRating";

export type WatchStatus = "none" | "Want To Watch" | "Watched";

interface WatchButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function IconBookmarkPlus() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H7a2 2 0 00-2 2v16l7-3.5L19 21V5a2 2 0 00-2-2z" />
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
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function WatchButton({ contentType, contentId }: WatchButtonProps) {
  const auth = getAuth(firebaseApp);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>("none");
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
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
      const res = await fetch(`${API_URL}/watchlist/${contentType}/${contentId}/status`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
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
    if (!user) { alert("You must be signed in."); return; }

    try {
      setSaving(true);

      if (watchStatus === "Want To Watch") {
        if (targetStatus === "Want To Watch") return;
        await fetch(`${API_URL}/watchlist/remove`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content_type: contentType, content_id: contentId }),
        });
        if (targetStatus === "Watched") {
          await fetch(`${API_URL}/watched/add`, {
            method: "POST",
            headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content_type: contentType, content_id: contentId }),
          });
        }
      } else if (watchStatus === "Watched") {
        if (targetStatus === "Watched") return;
        await fetch(`${API_URL}/watched/remove`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content_type: contentType, content_id: contentId }),
        });
        if (targetStatus === "Want To Watch") {
          await fetch(`${API_URL}/watchlist/add`, {
            method: "POST",
            headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content_type: contentType, content_id: contentId }),
          });
        }
      } else {
        const endpoint = targetStatus === "Want To Watch" ? "watchlist/add" : "watched/add";
        await fetch(`${API_URL}/${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content_type: contentType, content_id: contentId }),
        });
      }

      setWatchStatus(targetStatus);
      if (targetStatus !== "Watched") setRating(null);
      setMenuOpen(false);
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
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType, content_id: contentId, rating: newRating }),
      });
      setRating(newRating);
    } catch (err) {
      console.error(err);
    } finally {
      setRatingSaving(false);
    }
  }

  // ── Visual config per status ──

  const config = {
    none: {
      mainClass: "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500",
      chevronClass: "bg-blue-700 hover:bg-blue-600 border-l border-blue-500 text-white",
      icon: <IconBookmarkPlus />,
      label: "Add to Watchlist",
    },
    "Want To Watch": {
      mainClass: "bg-slate-700 hover:bg-slate-600 text-blue-300 border border-blue-500/60",
      chevronClass: "bg-slate-700 hover:bg-slate-600 border-l border-blue-500/40 text-blue-400",
      icon: <IconBookmarkFilled />,
      label: "On Watchlist",
    },
    Watched: {
      mainClass: "bg-green-900/40 hover:bg-green-900/60 text-green-300 border border-green-600/60",
      chevronClass: "bg-green-900/40 hover:bg-green-900/60 border-l border-green-600/40 text-green-400",
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
        <span className={`transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}>
          <IconChevronDown />
        </span>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute left-0 top-full mt-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden">
          {watchStatus !== "Want To Watch" && (
            <button
              onClick={() => updateWatchStatus("Want To Watch")}
              className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
            >
              <span className="text-blue-400"><IconBookmarkPlus /></span>
              Want to Watch
            </button>
          )}

          {watchStatus !== "Watched" && (
            <button
              onClick={() => updateWatchStatus("Watched")}
              className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
            >
              <span className="text-green-400"><IconCheckCircle /></span>
              Mark as Watched
            </button>
          )}

          {watchStatus !== "none" && (
            <>
              <div className="border-t border-slate-700 mx-3" />
              <button
                onClick={() => updateWatchStatus("none")}
                className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-600/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {watchStatus === "Watched" ? "Remove from Watched" : "Remove from Watchlist"}
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
