import { useState, useEffect, useRef } from "react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL } from "../constants";

interface Friend {
  friendship_id: number;
  friend: { id: string; username: string; email: string };
}

interface RecommendButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
  contentTitle: string;
  contentPosterPath: string | null;
}

export default function RecommendButton({
  contentType,
  contentId,
  contentTitle,
  contentPosterPath,
}: RecommendButtonProps) {
  const auth = getAuth(firebaseApp);
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [selected, setSelected] = useState<string | null>(null); // username
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleOpen() {
    setOpen(true);
    setSent(false);
    setError(null);
    setSelected(null);
    setMessage("");

    const user = auth.currentUser;
    if (!user) return;
    setLoadingFriends(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/friends/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setFriends(await res.json());
    } catch {
      setError("Could not load friends.");
    } finally {
      setLoadingFriends(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setSent(false);
    setError(null);
    setSelected(null);
    setMessage("");
  }

  async function handleSend() {
    if (!selected) return;
    const user = auth.currentUser;
    if (!user) return;
    setSending(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/recommendations/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient_username: selected,
          content_type: contentType,
          content_id: contentId,
          content_title: contentTitle,
          content_poster_path: contentPosterPath,
          message: message.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? "Failed to send recommendation.");
      } else {
        setSent(true);
      }
    } catch {
      setError("Network error.");
    } finally {
      setSending(false);
    }
  }

  if (!auth.currentUser) return null;

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Recommend
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div
            ref={modalRef}
            className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
          >
            {sent ? (
              <div className="text-center py-4">
                <div className="text-3xl mb-3">✓</div>
                <p className="text-white font-semibold text-lg mb-1">Recommendation sent!</p>
                <p className="text-slate-400 text-sm mb-6">
                  {selected} will get an email notification.
                </p>
                <button
                  onClick={handleClose}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-white font-bold text-lg mb-1">Recommend to a friend</h2>
                <p className="text-slate-400 text-sm mb-4 line-clamp-1">
                  {contentTitle}
                </p>

                {/* Friend list */}
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Select a friend
                  </p>
                  {loadingFriends ? (
                    <p className="text-slate-500 text-sm">Loading…</p>
                  ) : friends.length === 0 ? (
                    <p className="text-slate-500 text-sm">No friends yet.</p>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                      {friends.map((f) => (
                        <button
                          key={f.friendship_id}
                          onClick={() => setSelected(f.friend.username)}
                          className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            selected === f.friend.username
                              ? "bg-blue-600 text-white"
                              : "bg-slate-700 text-slate-200 hover:bg-slate-600"
                          }`}
                        >
                          @{f.friend.username}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Optional message */}
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Message (optional)
                  </p>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Why do you recommend this?"
                    maxLength={300}
                    rows={3}
                    className="w-full bg-slate-700 text-slate-100 text-sm px-3 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
                  />
                </div>

                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={!selected || sending}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
