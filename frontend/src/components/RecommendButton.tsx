import { useState, useEffect, useRef } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import { useFriends } from "../hooks/api/useFriends";
import { useSendRecommendation } from "../hooks/api/useRecommendations";

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
  const user = useAuthUser();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const { data: friendsData, isLoading: loadingFriends } = useFriends();
  const friends = (friendsData as Friend[] | undefined) ?? [];
  const sendMutation = useSendRecommendation();

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

  function handleOpen() {
    setOpen(true);
    setSent(false);
    setError(null);
    setSelected(null);
    setMessage("");
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
    if (!user) return;
    setError(null);
    try {
      const res = await sendMutation.mutateAsync({
        recipient_username: selected,
        content_type: contentType,
        content_id: contentId,
        content_title: contentTitle,
        content_poster_path: contentPosterPath ?? "",
        message: message.trim(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? "Failed to send recommendation.");
      } else {
        setSent(true);
      }
    } catch {
      setError("Network error.");
    }
  }

  if (!user) return null;

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-sm font-semibold transition-colors"
      >
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
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
        Recommend
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div
            ref={modalRef}
            className="bg-neutral-800 border border-neutral-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
          >
            {sent ? (
              <div className="text-center py-4">
                <div className="text-3xl mb-3">✓</div>
                <p className="text-white font-semibold text-lg mb-1">
                  Recommendation sent!
                </p>
                <p className="text-neutral-400 text-sm mb-6">
                  {selected} will be notified.
                </p>
                <button
                  onClick={handleClose}
                  className="px-5 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-semibold"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-white font-bold text-lg mb-1">
                  Recommend to a friend
                </h2>
                <p className="text-neutral-200 text-base sm:text-lg font-semibold mb-4 line-clamp-2">
                  {contentTitle}
                </p>

                {/* Friend list */}
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                    Select a friend
                  </p>
                  {loadingFriends ? (
                    <p className="text-neutral-500 text-sm">Loading…</p>
                  ) : friends.length === 0 ? (
                    <p className="text-neutral-500 text-sm">No friends yet.</p>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                      {friends.map((f) => (
                        <button
                          key={f.friendship_id}
                          onClick={() => setSelected(f.friend.username)}
                          className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            selected === f.friend.username
                              ? "bg-primary-600 text-white"
                              : "bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
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
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                    Message (optional)
                  </p>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Why do you recommend this?"
                    maxLength={300}
                    rows={3}
                    className="w-full bg-neutral-700 text-neutral-100 text-sm px-3 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-neutral-500"
                  />
                </div>

                {error && (
                  <p className="text-error-400 text-sm mb-3">{error}</p>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={!selected || sendMutation.isPending}
                    className="px-5 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {sendMutation.isPending ? "Sending…" : "Send"}
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
