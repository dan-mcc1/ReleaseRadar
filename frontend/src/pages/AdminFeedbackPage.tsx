import { useState } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../utils/apiFetch";
import AdminLayout, {
  ADM,
  Btn,
  TopBar,
  Pill,
} from "../components/AdminLayout";

interface FeedbackItem {
  id: number;
  category: "bug" | "feature" | "general";
  subject: string;
  description: string;
  status: "open" | "reviewed" | "closed";
  admin_notes: string | null;
  created_at: string | null;
  resolved_at: string | null;
  username: string | null;
}

const CATEGORY_COLOR: Record<string, string> = {
  bug: ADM.rose,
  feature: ADM.blue,
  general: ADM.amber,
};

const STATUS_COLOR: Record<string, string> = {
  open: ADM.primary,
  reviewed: ADM.amber,
  closed: ADM.textDim,
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function DetailPanel({
  item,
  onClose,
  onRefresh,
}: {
  item: FeedbackItem;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.admin_notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await apiFetch(`/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, admin_notes: notes || null }),
      });
      if (!r.ok) throw new Error("Failed to update");
      onRefresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: ADM.surface2,
          border: `1px solid ${ADM.borderStrong}`,
          borderRadius: 12,
          padding: 24,
          maxWidth: 600,
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <Pill color={CATEGORY_COLOR[item.category]}>{item.category.toUpperCase()}</Pill>
              <Pill color={STATUS_COLOR[item.status]}>{item.status.toUpperCase()}</Pill>
            </div>
            <h2 style={{ margin: 0, color: ADM.text, fontSize: 16, fontWeight: 600 }}>{item.subject}</h2>
            <p style={{ margin: "4px 0 0", color: ADM.textDim, fontSize: 12 }}>
              {item.username ? `@${item.username}` : "Anonymous"} · {item.created_at ? timeAgo(item.created_at) : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: ADM.textDim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            background: ADM.surface3,
            border: `1px solid ${ADM.border}`,
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 20,
            color: ADM.textMuted,
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {item.description}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", color: ADM.textDim, fontSize: 11, fontFamily: ADM.mono, marginBottom: 6 }}>
            STATUS
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["open", "reviewed", "closed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: `1px solid ${status === s ? STATUS_COLOR[s] : ADM.border}`,
                  background: status === s ? `${STATUS_COLOR[s]}22` : "transparent",
                  color: status === s ? STATUS_COLOR[s] : ADM.textDim,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: ADM.mono,
                  textTransform: "uppercase",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", color: ADM.textDim, fontSize: 11, fontFamily: ADM.mono, marginBottom: 6 }}>
            ADMIN NOTES
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Internal notes…"
            style={{
              width: "100%",
              background: ADM.surface3,
              border: `1px solid ${ADM.border}`,
              borderRadius: 8,
              padding: "8px 10px",
              color: ADM.text,
              fontSize: 13,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn onClick={onClose} color="ghost">Cancel</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </div>
    </div>
  );
}

export default function AdminFeedbackPage() {
  usePageTitle("Admin — Feedback");
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [selected, setSelected] = useState<FeedbackItem | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-feedback", categoryFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiFetch(`/feedback?${params}`);
      return res.json() as Promise<{ total: number; items: FeedbackItem[] }>;
    },
  });

  return (
    <AdminLayout>
      <TopBar crumb="ADMIN / FEEDBACK" title="Feedback" />
      {selected && (
        <DetailPanel
          item={selected}
          onClose={() => setSelected(null)}
          onRefresh={() => refetch()}
        />
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, padding: "0 24px 16px", flexWrap: "wrap" }}>
        {/* Status */}
        {["all", "open", "reviewed", "closed"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: `1px solid ${statusFilter === s ? ADM.primary : ADM.border}`,
              background: statusFilter === s ? ADM.primarySoft : "transparent",
              color: statusFilter === s ? ADM.primary : ADM.textDim,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: ADM.mono,
              textTransform: "uppercase",
            }}
          >
            {s}
          </button>
        ))}
        <div style={{ width: 1, background: ADM.border, margin: "0 4px" }} />
        {["all", "bug", "feature", "general"].map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: `1px solid ${categoryFilter === c ? (c === "all" ? ADM.primary : CATEGORY_COLOR[c]) : ADM.border}`,
              background: categoryFilter === c ? `${c === "all" ? ADM.primary : CATEGORY_COLOR[c]}22` : "transparent",
              color: categoryFilter === c ? (c === "all" ? ADM.primary : CATEGORY_COLOR[c]) : ADM.textDim,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: ADM.mono,
              textTransform: "uppercase",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ padding: "0 24px", flex: 1 }}>
        {isLoading ? (
          <p style={{ color: ADM.textDim, fontSize: 13, fontFamily: ADM.mono }}>Loading…</p>
        ) : !data?.items.length ? (
          <p style={{ color: ADM.textDim, fontSize: 13, fontFamily: ADM.mono }}>No submissions found.</p>
        ) : (
          <>
            <p style={{ color: ADM.textDim, fontSize: 11, fontFamily: ADM.mono, marginBottom: 12 }}>
              {data.total} total
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelected(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: ADM.surface2,
                    border: `1px solid ${ADM.border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = ADM.borderStrong)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = ADM.border)}
                >
                  <Pill color={CATEGORY_COLOR[item.category]}>{item.category}</Pill>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: ADM.text, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.subject}
                    </div>
                    <div style={{ color: ADM.textDim, fontSize: 11, marginTop: 2 }}>
                      {item.username ? `@${item.username}` : "Anonymous"} · {item.created_at ? timeAgo(item.created_at) : ""}
                    </div>
                  </div>
                  <Pill color={STATUS_COLOR[item.status]}>{item.status}</Pill>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
