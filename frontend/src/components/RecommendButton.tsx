import { useState } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import { useFriends } from "../hooks/api/useFriends";
import { useSendRecommendation } from "../hooks/api/useRecommendations";
import { Button, CheckIcon, Modal } from "./ui";

interface Friend {
  friendship_id: number;
  friend: { id: string; username: string; email: string };
}

interface RecommendButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
  contentTitle: string;
}

interface RecommendModalProps extends RecommendButtonProps {
  onClose: () => void;
}

export function RecommendModal({
  contentType,
  contentId,
  contentTitle,
  onClose,
}: RecommendModalProps) {
  const user = useAuthUser();
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: friendsData, isLoading: loadingFriends } = useFriends();
  const friends = (friendsData as Friend[] | undefined) ?? [];
  const sendMutation = useSendRecommendation();

  async function handleSend() {
    if (!selected) return;
    if (!user) return;
    setError(null);
    try {
      await sendMutation.mutateAsync({
        recipient_username: selected,
        content_type: contentType,
        content_id: contentId,
        message: message.trim(),
      });
      setSent(true);
    } catch {
      setError("Network error.");
    }
  }

  const sendFooter = sent ? (
    <Button variant="primary" onClick={onClose}>
      Done
    </Button>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={handleSend}
        disabled={!selected || sendMutation.isPending}
      >
        {sendMutation.isPending ? "Sending…" : "Send"}
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={sent ? "Recommendation sent!" : "Recommend to a friend"}
      description={sent ? `${selected} will be notified.` : undefined}
      size="sm"
      footer={sendFooter}
    >
      {sent ? (
        <div className="flex justify-center">
          <div className="size-12 rounded-full bg-success-500/20 text-success-400 flex items-center justify-center">
            <CheckIcon className="w-6 h-6" />
          </div>
        </div>
      ) : (
        <>
          <p className="text-neutral-200 text-base sm:text-lg font-semibold mb-4 line-clamp-2">
            {contentTitle}
          </p>

          {/* Friend list */}
          <div className="mb-4">
            <p className="text-caption font-medium text-neutral-400 mb-2">
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
          <div>
            <p className="text-caption font-medium text-neutral-400 mb-2">
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

          {error && <p className="text-error-400 text-sm mt-3">{error}</p>}
        </>
      )}
    </Modal>
  );
}

export default function RecommendButton({
  contentType,
  contentId,
  contentTitle,
}: RecommendButtonProps) {
  const user = useAuthUser();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
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
        <RecommendModal
          contentType={contentType}
          contentId={contentId}
          contentTitle={contentTitle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
