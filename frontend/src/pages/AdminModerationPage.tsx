import { useState } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useAdminReports,
  useAcceptReport,
  useRejectReport,
  useAdminAppeals,
  useApproveAppeal,
  useRejectAppeal,
  useAdminBannedEmails,
  useAdminRemoveBannedEmail,
} from "../hooks/api/useModeration";

type ReportStatus = "pending" | "accepted" | "rejected";

interface ReviewPayload {
  id: number;
  author: string;
  author_id: string;
  content_type: string;
  content_id: number;
  text: string;
  created_at: string;
  deleted?: boolean;
}

interface UserPayload {
  id: string;
  username: string;
  email: string;
  created_at: string;
  warning_count: number;
  is_suspended: boolean;
  suspended_until: string | null;
  is_silenced: boolean;
  silenced_until: string | null;
  is_banned: boolean;
  deleted?: boolean;
  reviews: {
    id: number;
    content_type: string;
    content_id: number;
    text: string;
    created_at: string;
  }[];
  ratings: { content_type: string; content_id: number; rating: number }[];
}

interface Report {
  id: number;
  reporter: string;
  reported_type: "review" | "user";
  reported_id: string;
  reason: string;
  message: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  review?: ReviewPayload | null;
  reported_user?: UserPayload | null;
}

function ReasonBadge({ reason }: { reason: string }) {
  return (
    <span className="text-xs bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded-full capitalize">
      {reason.replace(/_/g, " ")}
    </span>
  );
}

function ReviewReportCard({
  report,
  onAction,
}: {
  report: Report;
  onAction: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const acceptMutation = useAcceptReport();
  const rejectMutation = useRejectReport();

  async function accept() {
    await acceptMutation.mutateAsync({
      reportId: report.id,
      action: "delete_review",
      adminNotes: notes || undefined,
    });
    onAction();
  }
  async function reject() {
    await rejectMutation.mutateAsync({
      reportId: report.id,
      adminNotes: notes || undefined,
    });
    onAction();
  }

  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-neutral-500">Reported by</span>
            <span className="text-sm font-medium text-neutral-200">
              @{report.reporter}
            </span>
            <ReasonBadge reason={report.reason} />
          </div>
          {report.message && (
            <p className="text-xs text-neutral-400 italic">
              "{report.message}"
            </p>
          )}
          <p className="text-xs text-neutral-500">
            {new Date(report.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors shrink-0"
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      {report.review ? (
        <div className="bg-neutral-900 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-neutral-500">Review by</span>
            <span className="text-sm font-medium text-neutral-300">
              @{report.review.author}
            </span>
            <span className="text-xs text-neutral-600 capitalize">
              {report.review.content_type} #{report.review.content_id}
            </span>
            {report.review.deleted && (
              <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full">
                deleted
              </span>
            )}
          </div>
          <p className={`text-sm leading-relaxed line-clamp-3 ${report.review.deleted ? "text-neutral-500 italic" : "text-neutral-300"}`}>
            {report.review.text}
          </p>
        </div>
      ) : (
        <p className="text-xs text-neutral-500 italic">
          Review no longer exists.
        </p>
      )}

      {report.status === "pending" ? (
        <>
          {expanded && (
            <div>
              <label className="text-xs text-neutral-400 block mb-1">
                Admin notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-none"
                placeholder="Internal note…"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={reject}
              disabled={rejectMutation.isPending || acceptMutation.isPending}
              className="flex-1 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-neutral-300 text-sm py-2 rounded-lg transition-colors"
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </button>
            <button
              onClick={accept}
              disabled={
                acceptMutation.isPending ||
                rejectMutation.isPending ||
                !report.review
              }
              className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium"
            >
              {acceptMutation.isPending
                ? "Deleting…"
                : "Accept & Delete Review"}
            </button>
          </div>
        </>
      ) : (
        <div
          className={`rounded-lg px-3 py-2 text-sm space-y-1 ${report.status === "accepted" ? "bg-green-900/30 border border-green-800/50" : "bg-neutral-700/40 border border-neutral-600/50"}`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`font-medium capitalize ${report.status === "accepted" ? "text-green-400" : "text-neutral-400"}`}
            >
              {report.status}
            </span>
            {report.resolved_at && (
              <span className="text-xs text-neutral-500">
                {new Date(report.resolved_at).toLocaleString()}
              </span>
            )}
          </div>
          {report.admin_notes && (
            <p className="text-xs text-neutral-400">{report.admin_notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

type UserAction = "warn" | "suspend" | "ban" | "delete_user";

function warnEscalationHint(warningCount: number): string {
  const next = warningCount + 1;
  if (next === 2) return "→ will trigger 7-day silence";
  if (next === 3) return "→ will trigger 30-day silence";
  if (next >= 4) return "→ will permanently silence this account";
  return "";
}

function UserReportCard({
  report,
  onAction,
}: {
  report: Report;
  onAction: () => void;
}) {
  const [action, setAction] = useState<UserAction>("warn");
  const [suspendDays, setSuspendDays] = useState(7);
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const acceptMutation = useAcceptReport();
  const rejectMutation = useRejectReport();

  async function accept() {
    await acceptMutation.mutateAsync({
      reportId: report.id,
      action,
      adminNotes: notes || undefined,
      suspendDays: action === "suspend" ? suspendDays : undefined,
    });
    onAction();
  }
  async function reject() {
    await rejectMutation.mutateAsync({
      reportId: report.id,
      adminNotes: notes || undefined,
    });
    onAction();
  }

  const target = report.reported_user;

  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-neutral-500">Reported by</span>
            <span className="text-sm font-medium text-neutral-200">
              @{report.reporter}
            </span>
            <ReasonBadge reason={report.reason} />
          </div>
          {report.message && (
            <p className="text-xs text-neutral-400 italic">
              "{report.message}"
            </p>
          )}
          <p className="text-xs text-neutral-500">
            {new Date(report.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors shrink-0"
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      {target ? (
        <div className="bg-neutral-900 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-sm font-bold text-neutral-300 shrink-0">
              {target.username[0]?.toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-neutral-200">
                  @{target.username}
                </p>
                {target.deleted && (
                  <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full">
                    deleted
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500">
                {target.email} · joined{" "}
                {target.created_at ? new Date(target.created_at).toLocaleDateString() : "unknown"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {target.warning_count > 0 && (
                <span className="text-xs bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded-full">
                  {target.warning_count} warning
                  {target.warning_count !== 1 ? "s" : ""}
                </span>
              )}
              {target.is_banned && (
                <span className="text-xs bg-red-900/60 text-red-300 px-2 py-0.5 rounded-full">
                  Banned
                </span>
              )}
              {target.is_silenced && (
                <span className="text-xs bg-orange-900/60 text-orange-300 px-2 py-0.5 rounded-full">
                  Silenced
                </span>
              )}
              {!target.is_silenced &&
                target.silenced_until &&
                new Date(target.silenced_until) > new Date() && (
                  <span className="text-xs bg-orange-900/60 text-orange-300 px-2 py-0.5 rounded-full">
                    Silenced until{" "}
                    {new Date(target.silenced_until).toLocaleDateString()}
                  </span>
                )}
              {target.is_suspended && !target.is_banned && (
                <span className="text-xs bg-warning-700 text-warning-200 px-2 py-0.5 rounded-full">
                  Suspended
                </span>
              )}
            </div>
          </div>

          {expanded && (
            <>
              {target.reviews.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                    Recent Reviews
                  </p>
                  <div className="space-y-2">
                    {target.reviews.slice(0, 5).map((r) => (
                      <div
                        key={r.id}
                        className="border-l-2 border-neutral-700 pl-3"
                      >
                        <p className="text-xs text-neutral-500 capitalize">
                          {r.content_type} #{r.content_id}
                        </p>
                        <p className="text-sm text-neutral-300 line-clamp-2">
                          {r.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {target.ratings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                    Ratings ({target.ratings.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {target.ratings.slice(0, 10).map((r, i) => (
                      <span
                        key={i}
                        className="text-xs bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded"
                      >
                        {r.content_type} #{r.content_id}: {r.rating}★
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-neutral-500 italic">
          User no longer exists.
        </p>
      )}

      {report.status === "pending" ? (
        <>
          {/* Action selector */}
          <div className="space-y-2">
            <p className="text-xs text-neutral-400 font-medium">
              Action if accepted:
            </p>
            <div className="flex gap-2 flex-wrap">
              {(["warn", "suspend", "ban", "delete_user"] as UserAction[]).map(
                (a) => (
                  <button
                    key={a}
                    onClick={() => setAction(a)}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors border ${
                      action === a
                        ? "bg-primary-600 border-primary-500 text-white"
                        : "bg-neutral-700 border-neutral-600 text-neutral-300 hover:bg-neutral-600"
                    }`}
                  >
                    {a === "warn"
                      ? "Warn"
                      : a === "suspend"
                        ? "Suspend"
                        : a === "ban"
                          ? "Ban"
                          : "Delete account"}
                  </button>
                ),
              )}
            </div>
            {action === "warn" &&
              target &&
              (() => {
                const hint = warnEscalationHint(target.warning_count);
                return hint ? (
                  <p className="text-xs text-orange-400">{hint}</p>
                ) : null;
              })()}
            {action === "suspend" && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-neutral-400">Days:</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={suspendDays}
                  onChange={(e) => setSuspendDays(Number(e.target.value))}
                  className="w-20 bg-neutral-900 border border-neutral-600 rounded px-2 py-1 text-sm text-neutral-200 focus:outline-none"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-neutral-400 block mb-1">
                Admin notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-none"
                placeholder="Internal note or warning message…"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={reject}
              disabled={rejectMutation.isPending || acceptMutation.isPending}
              className="flex-1 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-neutral-300 text-sm py-2 rounded-lg transition-colors"
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </button>
            <button
              onClick={accept}
              disabled={acceptMutation.isPending || rejectMutation.isPending}
              className={`flex-1 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium ${
                action === "delete_user"
                  ? "bg-error-600 hover:bg-error-500"
                  : action === "ban"
                    ? "bg-red-700 hover:bg-red-600"
                    : action === "suspend"
                      ? "bg-warning-600 hover:bg-warning-500"
                      : "bg-primary-600 hover:bg-primary-500"
              }`}
            >
              {acceptMutation.isPending
                ? "Applying…"
                : action === "warn"
                  ? "Accept & Warn"
                  : action === "suspend"
                    ? "Accept & Suspend"
                    : action === "ban"
                      ? "Accept & Ban"
                      : "Accept & Delete"}
            </button>
          </div>
        </>
      ) : (
        <div
          className={`rounded-lg px-3 py-2 text-sm space-y-1 ${report.status === "accepted" ? "bg-green-900/30 border border-green-800/50" : "bg-neutral-700/40 border border-neutral-600/50"}`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`font-medium capitalize ${report.status === "accepted" ? "text-green-400" : "text-neutral-400"}`}
            >
              {report.status}
            </span>
            {report.resolved_at && (
              <span className="text-xs text-neutral-500">
                {new Date(report.resolved_at).toLocaleString()}
              </span>
            )}
          </div>
          {report.admin_notes && (
            <p className="text-xs text-neutral-400">{report.admin_notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

type AppealStatus = "pending" | "approved" | "rejected";

interface Appeal {
  id: number;
  user_id: string;
  username: string;
  email: string | null;
  appeal_type: "ban" | "suspension";
  message: string;
  request_unsilence: boolean;
  status: string;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  is_still_restricted: boolean;
  is_silenced: boolean;
}

function AppealsQueue() {
  const [appealStatus, setAppealStatus] = useState<AppealStatus>("pending");
  const { data, isLoading, refetch } = useAdminAppeals(appealStatus);
  const approveMutation = useApproveAppeal();
  const rejectMutation = useRejectAppeal();

  const appeals: Appeal[] = (data as any)?.appeals ?? [];
  const total: number = (data as any)?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-neutral-800 p-1 rounded-xl w-fit">
          {(["pending", "approved", "rejected"] as AppealStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setAppealStatus(s)}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors capitalize ${
                appealStatus === s
                  ? "bg-neutral-600 text-white font-medium"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {total > 0 && (
          <span className="text-sm text-neutral-500">
            {total} appeal{total !== 1 ? "s" : ""}
          </span>
        )}
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="ml-auto p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 rounded-lg transition-colors"
          title="Refresh"
        >
          <svg
            className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-36 bg-neutral-800 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : appeals.length === 0 ? (
        <p className="text-neutral-500 text-sm py-8 text-center">
          No {appealStatus} appeals.
        </p>
      ) : (
        <div className="space-y-4">
          {appeals.map((appeal) => (
            <AppealCard
              key={appeal.id}
              appeal={appeal}
              onApprove={async (notes, liftSilence) => {
                await approveMutation.mutateAsync({
                  appealId: appeal.id,
                  adminNotes: notes,
                  liftSilence,
                });
                refetch();
              }}
              onReject={async (notes) => {
                await rejectMutation.mutateAsync({
                  appealId: appeal.id,
                  adminNotes: notes,
                });
                refetch();
              }}
              busy={approveMutation.isPending || rejectMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AppealCard({
  appeal,
  onApprove,
  onReject,
  busy,
}: {
  appeal: Appeal;
  onApprove: (notes?: string, liftSilence?: boolean) => Promise<void>;
  onReject: (notes?: string) => Promise<void>;
  busy: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [liftSilence, setLiftSilence] = useState(appeal.request_unsilence);

  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-neutral-200">
              @{appeal.username}
            </span>
            <span className="text-xs text-neutral-500">{appeal.email}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                appeal.appeal_type === "ban"
                  ? "bg-red-900/50 text-red-300"
                  : "bg-warning-900/40 text-warning-300"
              }`}
            >
              Appealing {appeal.appeal_type}
            </span>
            {appeal.is_still_restricted && appeal.status === "pending" && (
              <span className="text-xs bg-neutral-700 text-neutral-400 px-2 py-0.5 rounded-full">
                still restricted
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            {new Date(appeal.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg px-4 py-3">
        <p className="text-xs text-neutral-500 font-medium uppercase tracking-wide mb-1">
          Appeal message
        </p>
        <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">
          {appeal.message}
        </p>
      </div>

      {appeal.status === "pending" ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-neutral-400 block mb-1">
              Admin notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-none"
              placeholder="Internal note or message to user…"
            />
          </div>
          {appeal.is_silenced && (
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={liftSilence}
                onChange={(e) => setLiftSilence(e.target.checked)}
                className="mt-0.5 accent-neutral-400 shrink-0"
              />
              <span className="text-sm text-neutral-400 group-hover:text-neutral-300 transition-colors leading-snug">
                Also lift silence
                {appeal.request_unsilence && (
                  <span className="ml-1.5 text-xs text-amber-400">
                    (user requested)
                  </span>
                )}
              </span>
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onReject(notes || undefined)}
              disabled={busy}
              className="flex-1 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-neutral-300 text-sm py-2 rounded-lg transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => onApprove(notes || undefined, liftSilence)}
              disabled={busy}
              className="flex-1 bg-success-700 hover:bg-success-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium"
            >
              Approve & lift restriction
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`rounded-lg px-3 py-2 text-sm space-y-1 ${
            appeal.status === "approved"
              ? "bg-green-900/30 border border-green-800/50"
              : "bg-neutral-700/40 border border-neutral-600/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`font-medium capitalize ${appeal.status === "approved" ? "text-green-400" : "text-neutral-400"}`}
            >
              {appeal.status}
            </span>
            {appeal.resolved_at && (
              <span className="text-xs text-neutral-500">
                {new Date(appeal.resolved_at).toLocaleString()}
              </span>
            )}
          </div>
          {appeal.admin_notes && (
            <p className="text-xs text-neutral-400">{appeal.admin_notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

function BannedEmailsSection() {
  const { data: entries = [], isLoading, refetch } = useAdminBannedEmails();
  const removeMutation = useAdminRemoveBannedEmail();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          {entries.length} email{entries.length !== 1 ? "s" : ""} on the ban list
        </p>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 rounded-lg transition-colors"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-neutral-800 rounded-xl animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-neutral-500 text-sm py-8 text-center">No banned emails.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between bg-neutral-800/60 border border-neutral-700 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm text-neutral-200">{entry.email}</p>
                {entry.user_id && (
                  <p className="text-xs text-neutral-500 mt-0.5">UID: {entry.user_id}</p>
                )}
              </div>
              <button
                onClick={() => removeMutation.mutate(entry.id)}
                disabled={removeMutation.isPending}
                className="text-xs text-error-400 hover:text-error-300 disabled:opacity-50 transition-colors px-3 py-1.5 rounded-lg border border-error-700 hover:border-error-500"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminModerationPage() {
  usePageTitle("Moderation");
  const [view, setView] = useState<"reports" | "appeals" | "banned-emails">("reports");
  const [status, setStatus] = useState<ReportStatus>("pending");
  const [typeFilter, setTypeFilter] = useState<"all" | "review" | "user">(
    "all",
  );
  const { data, isLoading, refetch } = useAdminReports(status);

  const reports: Report[] = (data as any)?.reports ?? [];
  const total: number = (data as any)?.total ?? 0;

  const filtered =
    typeFilter === "all"
      ? reports
      : reports.filter((r) => r.reported_type === typeFilter);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/admin"
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-white">Moderation</h1>
      </div>

      {/* Top-level view toggle */}
      <div className="flex gap-1 bg-neutral-800 p-1 rounded-xl w-fit">
        {(["reports", "appeals", "banned-emails"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-5 py-1.5 text-sm rounded-lg transition-colors capitalize ${
              view === v
                ? "bg-neutral-600 text-white font-medium"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {v === "banned-emails" ? "Banned Emails" : v}
          </button>
        ))}
      </div>

      {view === "appeals" ? (
        <AppealsQueue />
      ) : view === "banned-emails" ? (
        <BannedEmailsSection />
      ) : (
        <>
          {/* Status tabs */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex gap-1 bg-neutral-800 p-1 rounded-xl w-fit">
              {(["pending", "accepted", "rejected"] as ReportStatus[]).map(
                (s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`px-4 py-1.5 text-sm rounded-lg transition-colors capitalize ${
                      status === s
                        ? "bg-neutral-600 text-white font-medium"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {s}
                  </button>
                ),
              )}
            </div>
            <div className="ml-auto flex items-center gap-3">
              {total > 0 && (
                <span className="text-sm text-neutral-400">
                  {total} report{total !== 1 ? "s" : ""}
                </span>
              )}
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 rounded-lg transition-colors"
                title="Refresh"
              >
                <svg
                  className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Type filter */}
          <div className="flex gap-2">
            {(["all", "review", "user"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`text-sm px-3 py-1 rounded-lg transition-colors border ${
                  typeFilter === t
                    ? "border-primary-500 text-primary-300 bg-primary-900/30"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
                }`}
              >
                {t === "all" ? "All" : t === "review" ? "Reviews" : "Users"}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-36 bg-neutral-800 rounded-xl animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-neutral-500 text-sm py-8 text-center">
              No {status} {typeFilter !== "all" ? typeFilter : ""} reports.
            </p>
          ) : (
            <div className="space-y-4">
              {filtered.map((report) =>
                report.reported_type === "review" ? (
                  <ReviewReportCard
                    key={report.id}
                    report={report}
                    onAction={refetch}
                  />
                ) : (
                  <UserReportCard
                    key={report.id}
                    report={report}
                    onAction={refetch}
                  />
                ),
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
