import { useState } from "react";
import { useRewatches, useAddRewatch, useDeleteRewatch } from "../hooks/api/useRewatch";
import PremiumGate from "./PremiumGate";
import StarRating from "./StarRating";
import { Button, Card, Chip, CloseIcon, IconButton, PlusIcon, SectionHeader, StarIcon } from "./ui";

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
      <SectionHeader
        title="Rewatches"
        note={rewatches.length > 0 ? rewatches.length : undefined}
        action={
          <PremiumGate>
            {!open && (
              <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setOpen(true)}>
                Log rewatch
              </Button>
            )}
          </PremiumGate>
        }
      />

      {/* Log form — only renders for premium (open is always false for free users since the button is gated) */}
      {open && (
        <Card padding="sm" className="space-y-4">
          <div>
            <p className="text-caption text-neutral-400 mb-2">Rating</p>
            <StarRating rating={rating} onRate={setRating} />
          </div>
          <div>
            <label htmlFor="rewatch-notes" className="block text-caption text-neutral-400 mb-2">
              Notes
            </label>
            <textarea
              id="rewatch-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Any thoughts on the rewatch?"
              className="w-full bg-neutral-900 border border-neutral-700 rounded-control px-3 py-2 text-body text-neutral-200 placeholder-neutral-500 resize-none hover:border-neutral-500 focus:outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <p className="text-caption text-neutral-400 mb-2">Would watch again?</p>
            <div className="flex gap-2">
              {([true, false] as const).map((val) => (
                <Chip
                  key={String(val)}
                  pressed={wouldRewatch === val}
                  onClick={() => setWouldRewatch(wouldRewatch === val ? null : val)}
                >
                  {val ? "Yes" : "No"}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAdd} disabled={addRewatch.isPending}>
              {addRewatch.isPending ? "Saving…" : "Log rewatch"}
            </Button>
          </div>
        </Card>
      )}

      {/* History */}
      {rewatches.length > 0 && (
        <ul className="divide-y divide-neutral-800">
          {rewatches.map((rw, i) => (
            <li key={rw.id} className="py-3 flex items-start gap-3">
              <span className="flex-shrink-0 w-6 text-caption font-semibold text-neutral-400 text-center tabular pt-0.5">
                {rewatches.length - i}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                  <span className="text-caption text-neutral-400">
                    {new Date(rw.watched_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {rw.rating != null && (
                    <span className="flex items-center gap-0.5 text-caption text-warning-400">
                      <StarIcon className="w-3 h-3" />
                      {rw.rating}/5
                    </span>
                  )}
                  {rw.would_rewatch != null && (
                    <span className={`text-caption ${rw.would_rewatch ? "text-success-400" : "text-error-400"}`}>
                      {rw.would_rewatch ? "Would watch again" : "Wouldn't rewatch"}
                    </span>
                  )}
                </div>
                {rw.notes && (
                  <p className="text-body text-neutral-300 mt-1 leading-relaxed">{rw.notes}</p>
                )}
              </div>
              <IconButton
                label="Delete rewatch"
                icon={<CloseIcon />}
                size="sm"
                onClick={() =>
                  deleteRewatch.mutate({
                    rewatchId: rw.id,
                    contentType: rw.content_type,
                    contentId: rw.content_id,
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {rewatches.length === 0 && !open && (
        <p className="text-body text-neutral-400">No rewatches logged yet.</p>
      )}
    </div>
  );
}
