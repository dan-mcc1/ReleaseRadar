import { useState } from "react";
import { Link } from "react-router-dom";
import { ExclamationTriangleIcon, NoSymbolIcon } from "@heroicons/react/24/outline";
import { Button, CheckIcon } from "./ui";
import { useAccountStatus, useSubmitAppeal } from "../hooks/api/useUser";

export default function SuspensionBanModal({ asPage = false }: { asPage?: boolean }) {
  const { data: status } = useAccountStatus();
  const submitAppeal = useSubmitAppeal();
  const [message, setMessage] = useState("");
  const [requestUnsilence, setRequestUnsilence] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!status) return null;
  if (!status.is_banned && !status.is_suspended) return null;

  const isBan = status.is_banned;
  const untilDate = status.suspended_until
    ? new Date(status.suspended_until).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  async function handleSubmit() {
    if (!message.trim()) return;
    await submitAppeal.mutateAsync({ message: message.trim(), requestUnsilence }).catch(() => {});
    setSubmitted(true);
  }

  const wrapperClass = asPage
    ? "flex-1 flex items-center justify-center p-4"
    : "fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4";

  return (
    <div className={wrapperClass}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-surface w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-5 border-b border-neutral-800 ${isBan ? "bg-error-950/40" : "bg-warning-950/30"}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isBan ? "bg-error-900/60" : "bg-warning-900/60"}`}>
              {isBan ? (
                <NoSymbolIcon className="w-5 h-5 text-error-400" strokeWidth={2} aria-hidden="true" />
              ) : (
                <ExclamationTriangleIcon className="w-5 h-5 text-warning-400" strokeWidth={2} aria-hidden="true" />
              )}
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg">
                {isBan ? "Account Banned" : "Account Suspended"}
              </h2>
              <p className={`text-xs font-medium ${isBan ? "text-error-400" : "text-warning-400"}`}>
                {isBan
                  ? "Your account has been permanently banned"
                  : untilDate
                    ? `Suspended until ${untilDate}`
                    : "Your account has been suspended"}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Reason */}
          {(isBan ? status.ban_reason : status.suspension_reason) && (
            <div className="bg-neutral-800 rounded-lg px-4 py-3">
              <p className="text-caption text-neutral-400 mb-1">Reason</p>
              <p className="text-sm text-neutral-300">
                {isBan ? status.ban_reason : status.suspension_reason}
              </p>
            </div>
          )}

          <p className="text-sm text-neutral-400 leading-relaxed">
            {isBan
              ? "Your account has been permanently banned for violating our community guidelines. You can no longer access Release Radar."
              : "Your account has been temporarily suspended. You cannot access Release Radar until the suspension expires."}
            {" "}
            <Link to="/community-guidelines" className="text-neutral-300 underline hover:text-white">
              Review our guidelines
            </Link>
            .
          </p>

          {/* Appeal section */}
          <div className="border-t border-neutral-800 pt-4">
            <p className="text-sm font-medium text-neutral-300 mb-1">Appeal this decision</p>
            <p className="text-xs text-neutral-500 mb-3">
              If you believe this was a mistake, you can submit one appeal. Our moderation team will review it.
            </p>

            {status.has_pending_appeal || submitted ? (
              <div className="flex items-center gap-2 bg-neutral-800 rounded-lg px-4 py-3">
                <CheckIcon className="w-4 h-4 text-success-400 shrink-0" />
                <p className="text-sm text-neutral-300">Your appeal has been submitted and is under review.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Explain why you believe this decision was a mistake…"
                  maxLength={2000}
                  rows={4}
                  className="w-full bg-neutral-800 border border-neutral-700 focus:border-neutral-500 rounded-xl px-4 py-3 text-neutral-200 text-sm placeholder-neutral-600 focus:outline-none resize-none transition-colors"
                />
                {(status.is_silenced || (status.silenced_until && new Date(status.silenced_until) > new Date())) && (
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={requestUnsilence}
                      onChange={(e) => setRequestUnsilence(e.target.checked)}
                      className="mt-0.5 accent-neutral-400 shrink-0"
                    />
                    <span className="text-sm text-neutral-400 group-hover:text-neutral-300 transition-colors leading-snug">
                      I'm also requesting my review and comment privileges be restored
                    </span>
                  </label>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-600">{message.length}/2000</span>
                  <Button
                    onClick={handleSubmit}
                    disabled={!message.trim() || submitAppeal.isPending}
                  >
                    {submitAppeal.isPending ? "Submitting…" : "Submit appeal"}
                  </Button>
                </div>
                {submitAppeal.isError && (
                  <p className="text-xs text-error-400">Something went wrong. Please try again.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
