import { useState, useEffect } from "react";
import type { User } from "firebase/auth";
import {
  useReviews,
  useSubmitReview,
  useDeleteReview,
} from "../hooks/api/useReviews";

interface Review {
  id: number;
  user_id: string;
  username: string;
  review_text: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

function MiniStars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          className={`w-3 h-3 ${s <= rating ? "text-warning-400" : "text-neutral-600"}`}
          viewBox="0 0 24 24"
          fill={s <= rating ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={s <= rating ? 0 : 1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
          />
        </svg>
      ))}
    </span>
  );
}

interface Props {
  contentType: "movie" | "tv";
  contentId: number;
  user: User | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function ReviewsSection({
  contentType,
  contentId,
  user,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const { data, isLoading: loading } = useReviews(contentType, contentId);
  const reviews = (data as Review[] | undefined) ?? [];
  const submitMutation = useSubmitReview();
  const deleteMutation = useDeleteReview();

  const myReview = user ? (reviews.find((r) => r.user_id === user.uid) ?? null) : null;

  // Pre-fill draft when editing
  useEffect(() => {
    if (editing && myReview) setDraft(myReview.review_text);
    if (!editing) setDraft("");
  }, [editing, myReview]);

  async function submitReview() {
    if (!user || !draft.trim()) return;
    await submitMutation
      .mutateAsync({ contentType, contentId, reviewText: draft.trim() })
      .catch(() => {});
    setEditing(false);
    setDraft("");
  }

  async function deleteReview() {
    if (!user || !myReview) return;
    await deleteMutation.mutateAsync({ contentType, contentId }).catch(() => {});
    setEditing(false);
    setDraft("");
  }

  const othersReviews = reviews.filter((r) => r.user_id !== user?.uid);

  return (
    <div>
      <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-4">
        Reviews{" "}
        {reviews.length > 0 && (
          <span className="text-neutral-600 normal-case tracking-normal">
            ({reviews.length})
          </span>
        )}
      </h2>

      {/* Write / edit review */}
      {user && (
        <div className="mb-6">
          {!myReview && !editing ? (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-highlight-400 hover:text-highlight-300 transition-colors flex items-center gap-1.5"
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
                  d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z"
                />
              </svg>
              Write a review
            </button>
          ) : myReview && !editing ? (
            <div className="bg-neutral-800/80 border border-highlight-500/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-6 h-6 rounded-full bg-highlight-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                    {myReview.username[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-highlight-300">
                    @{myReview.username}
                  </span>
                  {myReview.rating != null && (
                    <MiniStars rating={myReview.rating} />
                  )}
                  <span className="text-xs text-neutral-500">
                    {timeAgo(myReview.updated_at ?? myReview.created_at)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors px-2 py-1 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={deleteReview}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-error-400 hover:text-error-300 disabled:opacity-50 transition-colors px-2 py-1 rounded"
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
              <p className="text-neutral-300 text-sm leading-relaxed whitespace-pre-wrap">
                {myReview.review_text}
              </p>
            </div>
          ) : (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Share your thoughts…"
                maxLength={2000}
                rows={4}
                className="w-full bg-neutral-800 border border-neutral-600 focus:border-highlight-500 rounded-xl px-4 py-3 text-neutral-200 text-sm placeholder-neutral-500 focus:outline-none resize-none transition-colors"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-neutral-600">
                  {draft.length}/2000
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(false);
                      setDraft("");
                    }}
                    className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitReview}
                    disabled={submitMutation.isPending || !draft.trim()}
                    className="text-sm bg-highlight-600 hover:bg-highlight-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    {submitMutation.isPending ? "Saving…" : myReview ? "Update" : "Post"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Other reviews */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-xl bg-neutral-800 animate-pulse"
            />
          ))}
        </div>
      ) : othersReviews.length === 0 && !myReview ? (
        <p className="text-neutral-500 text-sm">
          No reviews yet. Be the first!
        </p>
      ) : (
        <div className="space-y-3">
          {othersReviews.map((review) => (
            <div
              key={review.id}
              className="bg-neutral-800/60 border border-neutral-700 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="w-6 h-6 rounded-full bg-neutral-600 flex items-center justify-center text-[10px] font-bold text-neutral-300 flex-shrink-0">
                  {review.username[0]?.toUpperCase()}
                </div>
                <span className="text-sm font-medium text-neutral-300">
                  @{review.username}
                </span>
                {review.rating != null && <MiniStars rating={review.rating} />}
                <span className="text-xs text-neutral-600">
                  {timeAgo(review.updated_at ?? review.created_at)}
                </span>
              </div>
              <p className="text-neutral-400 text-sm leading-relaxed whitespace-pre-wrap">
                {review.review_text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
