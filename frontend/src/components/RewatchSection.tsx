import { useState } from "react";
import { useRewatches, useAddRewatch, useDeleteRewatch } from "../hooks/api/useRewatch";
import PremiumGate from "./PremiumGate";

function StarRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(value === s ? null : s)}
          className="focus:outline-none"
        >
          <svg
            className={`w-5 h-5 transition-colors ${
              (value ?? 0) >= s ? "fill-amber-400 text-amber-400" : "fill-neutral-700 text-neutral-700 hover:fill-amber-400/50"
            }`}
            viewBox="0 0 24 24"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export default function RewatchSection({
  contentType,
  contentId,
}: {
  contentType: "movie" | "tv";
  contentId: number;
}) {
  const { data } = useRewatches(contentType, contentId);
  const addRewatch = useAddRewatch();
  const deleteRewatch = useDeleteRewatch();

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [wouldRewatch, setWouldRewatch] = useState<boolean | null>(null);

  const rewatches = data?.rewatches ?? [];

  function handleAdd() {
    addRewatch.mutate(
      { contentType, contentId, rating, notes: notes || null, wouldRewatch },
      {
        onSuccess: () => {
          setOpen(false);
          setRating(null);
          setNotes("");
          setWouldRewatch(null);
        },
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-highlight-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Rewatches
          {rewatches.length > 0 && (
            <span className="text-xs text-neutral-500 font-normal bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">
              {rewatches.length}
            </span>
          )}
        </h2>
        <PremiumGate>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className="text-sm text-highlight-400 hover:text-highlight-300 transition-colors"
            >
              + Log rewatch
            </button>
          )}
        </PremiumGate>
      </div>

      {/* Log form — only renders for premium (open is always false for free users since the button is gated) */}
      {open && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Rating</p>
            <StarRow value={rating} onChange={setRating} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Any thoughts on the rewatch?"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 resize-none focus:outline-none focus:border-primary-500"
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Would watch again?</p>
            <div className="flex gap-2">
              {([true, false] as const).map((val) => (
                <button
                  key={String(val)}
                  type="button"
                  onClick={() => setWouldRewatch(wouldRewatch === val ? null : val)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    wouldRewatch === val
                      ? val
                        ? "bg-success-700/30 border-success-600/50 text-success-400"
                        : "bg-error-900/30 border-error-600/40 text-error-400"
                      : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-500"
                  }`}
                >
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setOpen(false)}
              className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={addRewatch.isPending}
              className="text-sm px-4 py-1.5 bg-highlight-600 hover:bg-highlight-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {addRewatch.isPending ? "Saving…" : "Log Rewatch"}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {rewatches.length > 0 && (
        <div className="space-y-2">
          {rewatches.map((rw, i) => (
            <div
              key={rw.id}
              className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 flex items-start gap-3"
            >
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-highlight-600/20 border border-highlight-600/30 flex items-center justify-center text-xs font-bold text-highlight-400">
                {rewatches.length - i}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-neutral-500">
                    {new Date(rw.watched_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {rw.rating != null && (
                    <span className="flex items-center gap-0.5 text-xs text-amber-400">
                      <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      {rw.rating}/5
                    </span>
                  )}
                  {rw.would_rewatch != null && (
                    <span className={`text-xs ${rw.would_rewatch ? "text-success-400" : "text-error-400"}`}>
                      {rw.would_rewatch ? "Would watch again" : "Wouldn't rewatch"}
                    </span>
                  )}
                </div>
                {rw.notes && (
                  <p className="text-sm text-neutral-300 mt-1 leading-relaxed">{rw.notes}</p>
                )}
              </div>
              <button
                onClick={() =>
                  deleteRewatch.mutate({
                    rewatchId: rw.id,
                    contentType: rw.content_type,
                    contentId: rw.content_id,
                  })
                }
                className="text-neutral-600 hover:text-error-400 transition-colors flex-shrink-0"
                aria-label="Delete rewatch"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {rewatches.length === 0 && !open && (
        <p className="text-sm text-neutral-600 italic">No rewatches logged yet.</p>
      )}
    </div>
  );
}
