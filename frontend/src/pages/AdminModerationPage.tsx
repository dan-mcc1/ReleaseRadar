import { useState } from "react";
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
import AdminLayout, {
  ADM,
  Pill,
  Btn,
  SectionH,
  TopBar,
} from "../components/AdminLayout";

// ── Types ─────────────────────────────────────────────────────────────

type ReportStatus = "pending" | "accepted" | "rejected";
type AppealStatus = "pending" | "approved" | "rejected";
type UserAction = "warn" | "suspend" | "ban" | "delete_user";

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
  reviews: { id: number; content_type: string; content_id: number; text: string; created_at: string }[];
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

// ── Helpers ────────────────────────────────────────────────────────────

const REASON_COLOR: Record<string, string> = {
  harassment: ADM.rose,
  "hate speech": ADM.rose,
  spam: ADM.amber,
  spoilers: ADM.blue,
  "off-topic": ADM.textMuted,
  impersonation: ADM.purple,
};

function reasonColor(r: string) {
  return REASON_COLOR[r.toLowerCase()] ?? ADM.textMuted;
}

function warnHint(wc: number) {
  const n = wc + 1;
  if (n === 2) return "→ triggers 7-day silence";
  if (n === 3) return "→ triggers 30-day silence";
  if (n >= 4) return "→ triggers permanent silence";
  return "";
}

// ── Report card (review) ──────────────────────────────────────────────

function ReviewReportCard({ report, onAction }: { report: Report; onAction: () => void }) {
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const acceptMut = useAcceptReport();
  const rejectMut = useRejectReport();

  const busy = acceptMut.isPending || rejectMut.isPending;

  async function accept() {
    await acceptMut.mutateAsync({ reportId: report.id, action: "delete_review", adminNotes: notes || undefined });
    onAction();
  }
  async function reject() {
    await rejectMut.mutateAsync({ reportId: report.id, adminNotes: notes || undefined });
    onAction();
  }

  const rColor = reasonColor(report.reason);

  return (
    <div
      style={{
        background: ADM.surface,
        border: `1px solid ${ADM.border}`,
        borderLeft: `3px solid ${rColor}`,
        borderRadius: 8,
        padding: "14px 16px",
        marginBottom: 8,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim }}>#{report.id}</span>
        <Pill color={ADM.blue}>REVIEW</Pill>
        <Pill color={rColor}>{report.reason.toUpperCase()}</Pill>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: ADM.mono, fontSize: 10.5, color: ADM.textDim }}>
          BY @{report.reporter} · {new Date(report.created_at).toLocaleDateString()}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "none",
            border: "none",
            color: ADM.textMuted,
            fontFamily: ADM.mono,
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          {expanded ? "HIDE" : "NOTES"}
        </button>
      </div>

      {/* Content grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: ADM.mono, fontSize: 9.5, color: ADM.textDim, letterSpacing: "0.1em", marginBottom: 6 }}>
            REVIEW BY @{report.review?.author ?? "—"}
          </div>
          {report.review ? (
            <div
              style={{
                padding: "10px 12px",
                background: ADM.bg,
                border: `1px solid ${ADM.border}`,
                borderRadius: 6,
                fontSize: 13,
                lineHeight: 1.5,
                color: report.review.deleted ? ADM.textDim : ADM.text,
                fontStyle: "italic",
              }}
            >
              {report.review.deleted && (
                <Pill color={ADM.rose} style={{ marginBottom: 6, display: "inline-flex" }}>DELETED</Pill>
              )}
              {report.review.text}
            </div>
          ) : (
            <span style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim }}>Review no longer exists.</span>
          )}
        </div>

        {report.message && (
          <div style={{ background: ADM.bg, border: `1px solid ${ADM.border}`, borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontFamily: ADM.mono, fontSize: 9.5, color: ADM.textDim, letterSpacing: "0.1em", marginBottom: 6 }}>
              REPORTER NOTE
            </div>
            <p style={{ margin: 0, fontSize: 12, color: ADM.textMuted, lineHeight: 1.5, fontStyle: "italic" }}>
              "{report.message}"
            </p>
          </div>
        )}
      </div>

      {/* Status / actions */}
      {report.status === "pending" ? (
        <>
          {expanded && (
            <div style={{ marginBottom: 10 }}>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="internal note (optional)…"
                style={{
                  width: "100%",
                  padding: "5px 8px",
                  background: ADM.bg,
                  border: `1px solid ${ADM.border}`,
                  color: ADM.text,
                  fontFamily: ADM.mono,
                  fontSize: 11,
                  borderRadius: 4,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Btn color="ghost" size="xs" onClick={reject} disabled={busy}>REJECT</Btn>
            <Btn
              color="danger"
              size="xs"
              onClick={accept}
              disabled={busy || !report.review}
            >
              {acceptMut.isPending ? "DELETING…" : "ACCEPT & DEL REVIEW"}
            </Btn>
          </div>
        </>
      ) : (
        <div
          style={{
            padding: "8px 12px",
            background: report.status === "accepted" ? ADM.primarySoft : ADM.surface2,
            border: `1px solid ${report.status === "accepted" ? ADM.primary + "33" : ADM.border}`,
            borderRadius: 6,
            fontFamily: ADM.mono,
            fontSize: 11,
          }}
        >
          <span style={{ color: report.status === "accepted" ? ADM.primary : ADM.textMuted, fontWeight: 600 }}>
            {report.status.toUpperCase()}
          </span>
          {report.resolved_at && (
            <span style={{ color: ADM.textDim, marginLeft: 8 }}>
              {new Date(report.resolved_at).toLocaleString()}
            </span>
          )}
          {report.admin_notes && (
            <div style={{ color: ADM.textMuted, marginTop: 4, fontSize: 10.5 }}>{report.admin_notes}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Report card (user) ────────────────────────────────────────────────

function UserReportCard({ report, onAction }: { report: Report; onAction: () => void }) {
  const [action, setAction] = useState<UserAction>("warn");
  const [suspendDays, setSuspendDays] = useState(7);
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const acceptMut = useAcceptReport();
  const rejectMut = useRejectReport();
  const busy = acceptMut.isPending || rejectMut.isPending;

  const target = report.reported_user;
  const rColor = reasonColor(report.reason);

  async function accept() {
    await acceptMut.mutateAsync({
      reportId: report.id,
      action,
      adminNotes: notes || undefined,
      suspendDays: action === "suspend" ? suspendDays : undefined,
    });
    onAction();
  }
  async function reject() {
    await rejectMut.mutateAsync({ reportId: report.id, adminNotes: notes || undefined });
    onAction();
  }

  const btnColor = action === "delete_user" ? "danger" : action === "ban" ? "danger" : action === "suspend" ? "amber" : "green";

  return (
    <div
      style={{
        background: ADM.surface,
        border: `1px solid ${ADM.border}`,
        borderLeft: `3px solid ${rColor}`,
        borderRadius: 8,
        padding: "14px 16px",
        marginBottom: 8,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim }}>#{report.id}</span>
        <Pill color={ADM.purple}>USER</Pill>
        <Pill color={rColor}>{report.reason.toUpperCase()}</Pill>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: ADM.mono, fontSize: 10.5, color: ADM.textDim }}>
          BY @{report.reporter} · {new Date(report.created_at).toLocaleDateString()}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ background: "none", border: "none", color: ADM.textMuted, fontFamily: ADM.mono, fontSize: 10.5, cursor: "pointer" }}
        >
          {expanded ? "HIDE" : "DETAILS"}
        </button>
      </div>

      {/* Target user dossier */}
      {target ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 260px",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ background: ADM.bg, border: `1px solid ${ADM.border}`, borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: ADM.text, fontFamily: ADM.sans }}>@{target.username}</span>
              {target.deleted && <Pill color={ADM.rose}>DELETED</Pill>}
              {target.is_banned && <Pill color={ADM.rose}>BANNED</Pill>}
              {target.is_suspended && !target.is_banned && <Pill color={ADM.amber}>SUSPENDED</Pill>}
              {target.is_silenced && <Pill color="#fb923c">SILENCED</Pill>}
              {target.warning_count > 0 && (
                <Pill color={target.warning_count >= 3 ? ADM.rose : ADM.amber}>
                  ⚠ {target.warning_count}
                </Pill>
              )}
            </div>
            <div style={{ fontFamily: ADM.mono, fontSize: 10.5, color: ADM.textMuted, lineHeight: 1.7 }}>
              {target.email}<br />
              {target.id}<br />
              Joined {new Date(target.created_at).toLocaleDateString()}
            </div>
            {expanded && target.reviews.length > 0 && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${ADM.border}`, paddingTop: 10 }}>
                <div style={{ fontFamily: ADM.mono, fontSize: 9.5, color: ADM.textDim, letterSpacing: "0.1em", marginBottom: 6 }}>
                  RECENT REVIEWS ({target.reviews.length})
                </div>
                {target.reviews.slice(0, 3).map((r) => (
                  <div key={r.id} style={{ borderLeft: `2px solid ${ADM.border}`, paddingLeft: 8, marginBottom: 6 }}>
                    <div style={{ fontFamily: ADM.mono, fontSize: 10, color: ADM.textDim, textTransform: "capitalize" }}>
                      {r.content_type} #{r.content_id}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: ADM.text, lineHeight: 1.4 }}>{r.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {report.message && (
            <div style={{ background: ADM.bg, border: `1px solid ${ADM.border}`, borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ fontFamily: ADM.mono, fontSize: 9.5, color: ADM.textDim, letterSpacing: "0.1em", marginBottom: 6 }}>
                REPORTER NOTE
              </div>
              <p style={{ margin: 0, fontSize: 12, color: ADM.textMuted, lineHeight: 1.5, fontStyle: "italic" }}>
                "{report.message}"
              </p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 12, fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim }}>
          USER NO LONGER EXISTS
        </div>
      )}

      {/* Actions */}
      {report.status === "pending" ? (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
            {(["warn", "suspend", "ban", "delete_user"] as UserAction[]).map((a) => (
              <Btn
                key={a}
                size="xs"
                color={action === a ? (a === "warn" ? "green" : a === "suspend" ? "amber" : "danger") : "ghost"}
                onClick={() => setAction(a)}
              >
                {a === "delete_user" ? "DELETE" : a.toUpperCase()}
              </Btn>
            ))}
            {action === "suspend" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                <input
                  type="number"
                  value={suspendDays}
                  min={1}
                  max={365}
                  onChange={(e) => setSuspendDays(Number(e.target.value))}
                  style={{
                    width: 44,
                    padding: "3px 6px",
                    background: ADM.bg,
                    border: `1px solid ${ADM.border}`,
                    color: ADM.text,
                    fontFamily: ADM.mono,
                    fontSize: 11,
                    borderRadius: 4,
                    outline: "none",
                  }}
                />
                <span style={{ fontFamily: ADM.mono, fontSize: 10, color: ADM.textDim }}>DAYS</span>
              </div>
            )}
            {action === "warn" && target && warnHint(target.warning_count) && (
              <span style={{ fontFamily: ADM.mono, fontSize: 10, color: "#fb923c", alignSelf: "center" }}>
                {warnHint(target.warning_count)}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="internal note (optional)…"
              style={{
                flex: 1,
                padding: "5px 8px",
                background: ADM.bg,
                border: `1px solid ${ADM.border}`,
                color: ADM.text,
                fontFamily: ADM.mono,
                fontSize: 11,
                borderRadius: 4,
                outline: "none",
              }}
            />
            <Btn color="ghost" size="xs" onClick={reject} disabled={busy}>REJECT</Btn>
            <Btn color={btnColor} size="xs" onClick={accept} disabled={busy}>
              {acceptMut.isPending ? "APPLYING…" : `ACCEPT & ${action === "warn" ? "WARN" : action === "suspend" ? "SUSP" : action === "ban" ? "BAN" : "DELETE"}`}
            </Btn>
          </div>
        </>
      ) : (
        <div
          style={{
            padding: "8px 12px",
            background: report.status === "accepted" ? ADM.primarySoft : ADM.surface2,
            border: `1px solid ${report.status === "accepted" ? ADM.primary + "33" : ADM.border}`,
            borderRadius: 6,
            fontFamily: ADM.mono,
            fontSize: 11,
          }}
        >
          <span style={{ color: report.status === "accepted" ? ADM.primary : ADM.textMuted, fontWeight: 600 }}>
            {report.status.toUpperCase()}
          </span>
          {report.resolved_at && (
            <span style={{ color: ADM.textDim, marginLeft: 8 }}>
              {new Date(report.resolved_at).toLocaleString()}
            </span>
          )}
          {report.admin_notes && (
            <div style={{ color: ADM.textMuted, marginTop: 4, fontSize: 10.5 }}>{report.admin_notes}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Appeals ───────────────────────────────────────────────────────────

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
    <div
      style={{
        background: ADM.surface,
        border: `1px solid ${appeal.appeal_type === "ban" ? ADM.rose + "33" : ADM.amber + "22"}`,
        borderLeft: `3px solid ${appeal.appeal_type === "ban" ? ADM.rose : ADM.amber}`,
        borderRadius: 8,
        padding: "14px 16px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim }}>#{appeal.id}</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: ADM.text, fontFamily: ADM.sans }}>@{appeal.username}</span>
        <Pill color={appeal.appeal_type === "ban" ? ADM.rose : ADM.amber}>
          APPEAL {appeal.appeal_type.toUpperCase()}
        </Pill>
        {appeal.is_still_restricted && appeal.status === "pending" && (
          <Pill color={ADM.textMuted}>STILL LOCKED</Pill>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: ADM.mono, fontSize: 10.5, color: ADM.textDim }}>
          {new Date(appeal.created_at).toLocaleDateString()}
        </span>
      </div>

      <div
        style={{
          background: ADM.bg,
          border: `1px solid ${ADM.border}`,
          borderRadius: 6,
          padding: "10px 12px",
          marginBottom: 12,
        }}
      >
        <div style={{ fontFamily: ADM.mono, fontSize: 9.5, color: ADM.textDim, letterSpacing: "0.1em", marginBottom: 6 }}>
          APPEAL MESSAGE
        </div>
        <p style={{ margin: 0, fontSize: 13, color: ADM.text, lineHeight: 1.5, fontStyle: "italic" }}>
          "{appeal.message}"
        </p>
      </div>

      {appeal.status === "pending" ? (
        <>
          {appeal.is_silenced && (
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={liftSilence}
                onChange={(e) => setLiftSilence(e.target.checked)}
                style={{ accentColor: ADM.primary }}
              />
              <span style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textMuted }}>
                LIFT SILENCE
                {appeal.request_unsilence && (
                  <span style={{ color: ADM.amber, marginLeft: 6 }}>(user requested)</span>
                )}
              </span>
            </label>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="internal note (optional)…"
              style={{
                flex: 1,
                padding: "5px 8px",
                background: ADM.bg,
                border: `1px solid ${ADM.border}`,
                color: ADM.text,
                fontFamily: ADM.mono,
                fontSize: 11,
                borderRadius: 4,
                outline: "none",
              }}
            />
            <Btn color="ghost" size="xs" disabled={busy} onClick={() => onReject(notes || undefined)}>
              REJECT
            </Btn>
            <Btn color="green" size="xs" disabled={busy} onClick={() => onApprove(notes || undefined, liftSilence)}>
              APPROVE + LIFT
            </Btn>
          </div>
        </>
      ) : (
        <div
          style={{
            padding: "8px 12px",
            background: appeal.status === "approved" ? ADM.primarySoft : ADM.surface2,
            border: `1px solid ${appeal.status === "approved" ? ADM.primary + "33" : ADM.border}`,
            borderRadius: 6,
            fontFamily: ADM.mono,
            fontSize: 11,
          }}
        >
          <span style={{ color: appeal.status === "approved" ? ADM.primary : ADM.textMuted, fontWeight: 600 }}>
            {appeal.status.toUpperCase()}
          </span>
          {appeal.resolved_at && (
            <span style={{ color: ADM.textDim, marginLeft: 8 }}>
              {new Date(appeal.resolved_at).toLocaleString()}
            </span>
          )}
          {appeal.admin_notes && (
            <div style={{ color: ADM.textMuted, marginTop: 4, fontSize: 10.5 }}>{appeal.admin_notes}</div>
          )}
        </div>
      )}
    </div>
  );
}

function AppealsSection() {
  const [status, setStatus] = useState<AppealStatus>("pending");
  const { data, isLoading, refetch } = useAdminAppeals(status);
  const approveMut = useApproveAppeal();
  const rejectMut = useRejectAppeal();
  const pagedAppeals = data as { appeals: Appeal[]; total: number } | undefined;
  const appeals: Appeal[] = pagedAppeals?.appeals ?? [];
  const total: number = pagedAppeals?.total ?? 0;
  const busy = approveMut.isPending || rejectMut.isPending;

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, alignItems: "center" }}>
        {(["pending", "approved", "rejected"] as AppealStatus[]).map((s) => (
          <Btn
            key={s}
            size="xs"
            color={status === s ? (s === "pending" ? "amber" : s === "approved" ? "green" : "ghost") : "ghost"}
            onClick={() => setStatus(s)}
          >
            {s.toUpperCase()}
          </Btn>
        ))}
        {total > 0 && (
          <span style={{ fontFamily: ADM.mono, fontSize: 10.5, color: ADM.textDim, marginLeft: 4 }}>
            {total} appeal{total !== 1 ? "s" : ""}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Btn color="ghost" size="xs" onClick={() => refetch()} disabled={isLoading}>
          REFRESH ↻
        </Btn>
      </div>

      {isLoading ? (
        <div style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim, padding: "24px 0" }}>
          LOADING…
        </div>
      ) : appeals.length === 0 ? (
        <div style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim, padding: "24px 0", textAlign: "center" }}>
          NO {status.toUpperCase()} APPEALS
        </div>
      ) : (
        appeals.map((appeal) => (
          <AppealCard
            key={appeal.id}
            appeal={appeal}
            busy={busy}
            onApprove={async (notes, liftSilence) => {
              await approveMut.mutateAsync({ appealId: appeal.id, adminNotes: notes, liftSilence });
              refetch();
            }}
            onReject={async (notes) => {
              await rejectMut.mutateAsync({ appealId: appeal.id, adminNotes: notes });
              refetch();
            }}
          />
        ))
      )}
    </div>
  );
}

// ── Banned emails ─────────────────────────────────────────────────────

function BannedEmailsSection() {
  const { data: entries = [], isLoading, refetch } = useAdminBannedEmails();
  const removeMut = useAdminRemoveBannedEmail();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim }}>
          {entries.length} EMAIL{entries.length !== 1 ? "S" : ""} ON BAN LIST
        </span>
        <span style={{ flex: 1 }} />
        <Btn color="ghost" size="xs" onClick={() => refetch()} disabled={isLoading}>
          REFRESH ↻
        </Btn>
      </div>

      {isLoading ? (
        <div style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim }}>LOADING…</div>
      ) : entries.length === 0 ? (
        <div style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim, textAlign: "center", padding: "24px 0" }}>
          NO BANNED EMAILS
        </div>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              background: ADM.surface,
              border: `1px solid ${ADM.border}`,
              borderRadius: 6,
              marginBottom: 4,
            }}
          >
            <span style={{ fontFamily: ADM.mono, fontSize: 12, color: ADM.text, flex: 1 }}>
              {entry.email}
            </span>
            {entry.user_id && (
              <span style={{ fontFamily: ADM.mono, fontSize: 10, color: ADM.textDim }}>
                {entry.user_id}
              </span>
            )}
            <Btn
              color="rose"
              size="xs"
              disabled={removeMut.isPending}
              onClick={() => removeMut.mutate(entry.id)}
            >
              REMOVE
            </Btn>
          </div>
        ))
      )}
    </div>
  );
}

// ── Reports section ───────────────────────────────────────────────────

function ReportsSection() {
  const [status, setStatus] = useState<ReportStatus>("pending");
  const [typeFilter, setTypeFilter] = useState<"all" | "review" | "user">("all");
  const { data, isLoading, refetch } = useAdminReports(status);
  const pagedReports = data as { reports: Report[]; total: number } | undefined;
  const reports: Report[] = pagedReports?.reports ?? [];
  const total: number = pagedReports?.total ?? 0;
  const filtered = typeFilter === "all" ? reports : reports.filter((r) => r.reported_type === typeFilter);

  return (
    <div>
      {/* Filter row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["pending", "accepted", "rejected"] as ReportStatus[]).map((s) => (
            <Btn
              key={s}
              size="xs"
              color={status === s ? (s === "pending" ? "amber" : s === "accepted" ? "green" : "rose") : "ghost"}
              onClick={() => setStatus(s)}
            >
              {s.toUpperCase()}
            </Btn>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: ADM.border }} />
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "review", "user"] as const).map((t) => (
            <Btn
              key={t}
              size="xs"
              color={typeFilter === t ? "blue" : "ghost"}
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "ALL" : t === "review" ? "REVIEW" : "USER"}
            </Btn>
          ))}
        </div>
        {total > 0 && (
          <span style={{ fontFamily: ADM.mono, fontSize: 10.5, color: ADM.textDim, marginLeft: 4 }}>
            {total} report{total !== 1 ? "s" : ""}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Btn color="ghost" size="xs" onClick={() => refetch()} disabled={isLoading}>
          REFRESH ↻
        </Btn>
      </div>

      {isLoading ? (
        <div style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim, padding: "24px 0" }}>
          LOADING…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontFamily: ADM.mono, fontSize: 11, color: ADM.textDim, textAlign: "center", padding: "24px 0" }}>
          NO {status.toUpperCase()} {typeFilter !== "all" ? typeFilter.toUpperCase() + " " : ""}REPORTS
        </div>
      ) : (
        filtered.map((report) =>
          report.reported_type === "review" ? (
            <ReviewReportCard key={report.id} report={report} onAction={refetch} />
          ) : (
            <UserReportCard key={report.id} report={report} onAction={refetch} />
          )
        )
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

type View = "reports" | "appeals" | "banned-emails";

export default function AdminModerationPage() {
  usePageTitle("Moderation — Admin");
  const [view, setView] = useState<View>("reports");

  const viewLabel: Record<View, string> = {
    reports: "Reports",
    appeals: "Appeals",
    "banned-emails": "Banned Emails",
  };

  return (
    <AdminLayout>
      <TopBar
        crumb="ADMIN /"
        title={viewLabel[view]}
        actions={
          <div style={{ display: "flex", gap: 4 }}>
            {(["reports", "appeals", "banned-emails"] as View[]).map((v) => (
              <Btn
                key={v}
                size="xs"
                color={view === v ? (v === "reports" ? "rose" : v === "appeals" ? "amber" : "ghost") : "ghost"}
                onClick={() => setView(v)}
              >
                {v === "banned-emails" ? "BANNED EMAILS" : v.toUpperCase()}
              </Btn>
            ))}
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
        <div style={{ maxWidth: 900 }}>
          {view === "reports" && (
            <div>
              <SectionH count={undefined}>⚐ Moderation Queue</SectionH>
              <div style={{ paddingTop: 14 }}>
                <ReportsSection />
              </div>
            </div>
          )}

          {view === "appeals" && (
            <div>
              <SectionH count={undefined}>⚑ Appeals Queue</SectionH>
              <div style={{ paddingTop: 14 }}>
                <AppealsSection />
              </div>
            </div>
          )}

          {view === "banned-emails" && (
            <div>
              <SectionH count={undefined}>⊘ Banned Emails</SectionH>
              <div style={{ paddingTop: 14 }}>
                <BannedEmailsSection />
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
