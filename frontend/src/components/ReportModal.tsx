import { useState } from "react";
import { useSubmitReport, type ReportReason, type SubmitReportPayload } from "../hooks/api/useModeration";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other", label: "Other" },
];

interface Props {
  reportedType: SubmitReportPayload["reported_type"];
  reportedId: string;
  label: string; // e.g. "this post"
  onClose: () => void;
}

export default function ReportModal({ reportedType, reportedId, label, onClose }: Props) {
  const submit = useSubmitReport();
  const [reason, setReason] = useState<ReportReason>("spam");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    try {
      await submit.mutateAsync({
        reported_type: reportedType,
        reported_id: reportedId,
        reason,
        message: message.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit report.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <>
            <p className="text-neutral-200 text-sm mb-5">
              Report submitted. Thank you for letting us know.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm py-2.5 rounded-xl"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <h3 className="text-white font-semibold mb-4">Report {label}</h3>
            <div className="space-y-0.5 mb-4">
              {REASONS.map(({ value, label: rl }) => (
                <label key={value} className="flex items-center gap-2.5 cursor-pointer py-1.5">
                  <input
                    type="radio"
                    name="reportReason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="accent-primary-500"
                  />
                  <span className="text-neutral-300 text-sm">{rl}</span>
                </label>
              ))}
            </div>
            <div className="mb-5">
              <label className="text-[11px] text-neutral-500 block mb-1.5 font-mono uppercase tracking-wider">
                Additional details (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Describe the issue…"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-neutral-200 placeholder-neutral-700 outline-none focus:border-neutral-600 resize-none"
              />
            </div>
            {error && <p className="text-error-400 text-sm mb-2">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm py-2.5 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={submit.isPending}
                className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-medium"
              >
                {submit.isPending ? "Submitting…" : "Report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
