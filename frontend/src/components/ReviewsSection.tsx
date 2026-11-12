import { useState } from "react";
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
import { useNotificationPrefs } from "../hooks/api/useNotifications";
import StarIcon from "./icons/StarIcon";
import { ExclamationTriangleIcon, FlagIcon, HeartIcon as HeartOutline, PencilSquareIcon } from "@heroicons/react/24/outline";
import { HeartIcon as HeartSolid } from "@heroicons/react/24/solid";
import { Button, Modal, Segmented, SectionHeader } from "./ui";

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
  is_spoiler: boolean;
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
        <StarIcon
          key={s}
          filled={s <= rating}
          className={`w-3 h-3 ${s <= rating ? "text-warning-400" : "text-neutral-500"}`}
        />
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

  if (done) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Report submitted"
        size="sm"
        footer={<Button onClick={onClose}>Close</Button>}
      >
        <p className="text-neutral-200 text-sm">
          Report submitted. Thanks for letting us know.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Report @${username}'s review`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} disabled={reportMutation.isPending}>
            {reportMutation.isPending ? "Submitting…" : "Report"}
          </Button>
        </>
      }
    >
      <div className="space-y-1 mb-4">
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
          className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-500 resize-none"
        />
      </div>
    </Modal>
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
  const [draftIsSpoiler, setDraftIsSpoiler] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reportingReviewId, setReportingReviewId] = useState<number | null>(null);
  const [sort, setSort] = useState<"newest" | "top">("newest");
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());

  const { data: prefs } = useNotificationPrefs();
  const hideSpoilers = prefs?.hide_spoilers ?? true;

  function revealReview(id: number) {
    setRevealedIds((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }

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

  function startEditing() {
    setDraft(myReview?.review_text ?? "");
    setDraftIsSpoiler(myReview?.is_spoiler ?? false);
    setEditing(true);
  }

  async function submitReview() {
    if (!user || !draft.trim()) return;
    await submitMutation
      .mutateAsync({
        contentType,
        contentId,
        reviewText: draft.trim(),
        isSpoiler: draftIsSpoiler,
      })
      .catch(() => {});
    setEditing(false);
    setDraft("");
    setDraftIsSpoiler(false);
  }

  async function deleteReview() {
    if (!user || !myReview) return;
    await deleteMutation
      .mutateAsync({ contentType, contentId })
      .catch(() => {});
    setEditing(false);
    setDraft("");
    setDraftIsSpoiler(false);
  }

  function toggleLike(review: Review) {
    if (!user) return;
    likeMutation.mutate({ reviewId: review.id, contentType, contentId });
  }

  const othersReviews = reviews.filter((r) => r.user_id !== user?.uid);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Reviews" note={reviews.length > 0 ? reviews.length : undefined} />
        <Segmented
          label="Sort reviews"
          value={sort}
          onChange={setSort}
          options={[
            { value: "newest", label: "Newest" },
            { value: "top", label: "Top" },
          ]}
        />
      </div>

      {/* Write / edit review */}
      {user && !isSilenced && (
        <div className="mb-6">
          {!myReview && !editing ? (
            <button
              onClick={startEditing}
              className="text-sm text-highlight-400 hover:text-highlight-300 transition-colors flex items-center gap-1.5"
            >
              <PencilSquareIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              Write a review
            </button>
          ) : myReview && !editing ? (
            <div className="bg-neutral-800/80 border border-highlight-500/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/user/${myReview.username}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <div className="w-6 h-6 rounded-full bg-highlight-700 flex items-center justify-center text-caption font-bold text-white flex-shrink-0">
                      {myReview.username[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-highlight-300">
                      @{myReview.username}
                    </span>
                  </Link>
                  {myReview.rating != null && (
                    <MiniStars rating={myReview.rating} />
                  )}
                  {myReview.is_spoiler && (
                    <span className="text-caption font-semibold bg-warning-500/15 text-warning-400 border border-warning-500/30 rounded-full px-2 py-0.5">
                      Spoiler
                    </span>
                  )}
                  <span className="text-xs text-neutral-500">
                    {timeAgo(myReview.updated_at ?? myReview.created_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {myReview.like_count > 0 && (
                    <span className="flex items-center gap-1 text-xs text-neutral-500">
                      <HeartSolid className="w-3.5 h-3.5" aria-hidden="true" />
                      {myReview.like_count}
                    </span>
                  )}
                  <button
                    onClick={startEditing}
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
              <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={draftIsSpoiler}
                      onChange={(e) => setDraftIsSpoiler(e.target.checked)}
                      className="accent-warning-500 w-3.5 h-3.5"
                    />
                    Contains spoilers
                  </label>
                  <span className="text-xs text-neutral-500">
                    {draft.length}/2000
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(false);
                      setDraft("");
                      setDraftIsSpoiler(false);
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
                    <div className="w-6 h-6 rounded-full bg-neutral-600 flex items-center justify-center text-caption font-bold text-neutral-300 flex-shrink-0">
                      {review.username[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-neutral-300">
                      @{review.username}
                    </span>
                  </Link>
                  {review.rating != null && <MiniStars rating={review.rating} />}
                  {review.is_spoiler && (
                    <span className="text-caption font-semibold bg-warning-500/15 text-warning-400 border border-warning-500/30 rounded-full px-2 py-0.5">
                      Spoiler
                    </span>
                  )}
                  <span className="text-xs text-neutral-500">
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
                    {review.user_has_liked ? (
                      <HeartSolid className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <HeartOutline className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                    )}
                    {review.like_count > 0 && <span>{review.like_count}</span>}
                  </button>
                )}
              </div>
              {review.is_spoiler && hideSpoilers && !revealedIds.has(review.id) ? (
                <button
                  onClick={() => revealReview(review.id)}
                  className="w-full text-left bg-neutral-900/60 hover:bg-neutral-900 border border-warning-500/30 rounded-lg px-3 py-2.5 text-sm text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-2"
                >
                  <ExclamationTriangleIcon className="w-4 h-4 text-warning-400 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span>This review contains spoilers — click to reveal</span>
                </button>
              ) : (
                <p className="text-neutral-400 text-sm leading-relaxed whitespace-pre-wrap">
                  {review.review_text}
                </p>
              )}
              {user && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => setReportingReviewId(review.id)}
                    className="text-neutral-500 hover:text-error-400 transition-colors text-xs flex items-center gap-1"
                    title="Report review"
                  >
                    <FlagIcon className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
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
