import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { User } from "firebase/auth";
import {
  useReviews,
  useSubmitReview,
  useDeleteReview,
  useLikeReview,
} from "../hooks/api/useReviews";
import { useSubmitReport, type ReportReason } from "../hooks/api/useModeration";
import { useUserMe } from "../hooks/api/useUser";

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other", label: "Other" },
];

interface Review {
  id: number;
  user_id: string;
  username: string;
  review_text: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
  like_count: number;
  user_has_liked: boolean;
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

function ReportReviewModal({
  reviewId,
  username,
  onClose,
}: {
  reviewId: number;
  username: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const reportMutation = useSubmitReport();

  async function submit() {
    await reportMutation.mutateAsync({
      reported_type: "review",
      reported_id: String(reviewId),
      reason,
      message: message.trim() || undefined,
    });
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-neutral-800 border border-neutral-700 rounded-xl p-5 w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <>
            <p className="text-neutral-200 text-sm">
              Report submitted. Thanks for letting us know.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-neutral-700 hover:bg-neutral-600 text-neutral-200 text-sm py-2 rounded-lg transition-colors"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <h3 className="text-white font-semibold">
              Report @{username}'s review
            </h3>
            <div className="space-y-1">
              {REPORT_REASONS.map(({ value, label }) => (
                <label
                  key={value}
                  className="flex items-center gap-2 cursor-pointer py-1"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="accent-highlight-500"
                  />
                  <span className="text-neutral-300 text-sm">{label}</span>
                </label>
              ))}
            </div>
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Additional details (optional)</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Describe the issue…"
                className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-sm py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={reportMutation.isPending}
                className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium"
              >
                {reportMutation.isPending ? "Submitting…" : "Report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
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
  const [reportingReviewId, setReportingReviewId] = useState<number | null>(null);
  const [sort, setSort] = useState<"newest" | "top">("newest");

  const { data, isLoading: loading } = useReviews(contentType, contentId, sort);
  const reviews = (data as Review[] | undefined) ?? [];
  const submitMutation = useSubmitReview();
  const deleteMutation = useDeleteReview();
  const likeMutation = useLikeReview();
  const { data: me } = useUserMe();
  const isSilenced = !!me && (
    me.is_silenced ||
    (!!me.silenced_until && new Date(me.silenced_until) > new Date())
  );

  const myReview = user
    ? (reviews.find((r) => r.user_id === user.uid) ?? null)
    : null;

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
    await deleteMutation
      .mutateAsync({ contentType, contentId })
      .catch(() => {});
    setEditing(false);
    setDraft("");
  }

  function toggleLike(review: Review) {
    if (!user) return;
    likeMutation.mutate({ reviewId: review.id, contentType, contentId });
  }

  const othersReviews = reviews.filter((r) => r.user_id !== user?.uid);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">
          Reviews{" "}
          {reviews.length > 0 && (
            <span className="text-neutral-600 normal-case tracking-normal">
              ({reviews.length})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1 bg-neutral-800 rounded-lg p-0.5">
          <button
            onClick={() => setSort("newest")}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              sort === "newest"
                ? "bg-neutral-700 text-neutral-200"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Newest
          </button>
          <button
            onClick={() => setSort("top")}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              sort === "top"
                ? "bg-neutral-700 text-neutral-200"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Top
          </button>
        </div>
      </div>

      {/* Write / edit review */}
      {user && !isSilenced && (
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
                  <Link to={`/user/${myReview.username}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <div className="w-6 h-6 rounded-full bg-highlight-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                      {myReview.username[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-highlight-300">
                      @{myReview.username}
                    </span>
                  </Link>
                  {myReview.rating != null && (
                    <MiniStars rating={myReview.rating} />
                  )}
                  <span className="text-xs text-neutral-500">
                    {timeAgo(myReview.updated_at ?? myReview.created_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {myReview.like_count > 0 && (
                    <span className="flex items-center gap-1 text-xs text-neutral-500">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                      </svg>
                      {myReview.like_count}
                    </span>
                  )}
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
                    {submitMutation.isPending
                      ? "Saving…"
                      : myReview
                        ? "Update"
                        : "Post"}
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
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/user/${review.username}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <div className="w-6 h-6 rounded-full bg-neutral-600 flex items-center justify-center text-[10px] font-bold text-neutral-300 flex-shrink-0">
                      {review.username[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-neutral-300">
                      @{review.username}
                    </span>
                  </Link>
                  {review.rating != null && <MiniStars rating={review.rating} />}
                  <span className="text-xs text-neutral-600">
                    {timeAgo(review.updated_at ?? review.created_at)}
                  </span>
                </div>
                {user && (
                  <button
                    onClick={() => toggleLike(review)}
                    className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded-lg transition-colors flex-shrink-0 ${
                      review.user_has_liked
                        ? "text-highlight-400 hover:text-highlight-300"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                    title={review.user_has_liked ? "Unlike" : "Like"}
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill={review.user_has_liked ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth={review.user_has_liked ? 0 : 1.5}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                    </svg>
                    {review.like_count > 0 && <span>{review.like_count}</span>}
                  </button>
                )}
              </div>
              <p className="text-neutral-400 text-sm leading-relaxed whitespace-pre-wrap">
                {review.review_text}
              </p>
              {user && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => setReportingReviewId(review.id)}
                    className="text-neutral-600 hover:text-error-400 transition-colors text-xs flex items-center gap-1"
                    title="Report review"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l1.5 1.5M21 3l-1.5 1.5M12 2v2m0 16v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2m16 0h2M6.34 17.66l-1.42 1.42M19.08 4.92l-1.42 1.42" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
                    </svg>
                    Report
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {reportingReviewId !== null && (
        <ReportReviewModal
          reviewId={reportingReviewId}
          username={othersReviews.find((r) => r.id === reportingReviewId)?.username ?? ""}
          onClose={() => setReportingReviewId(null)}
        />
      )}
    </div>
  );
}
