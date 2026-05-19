import { useState, useEffect } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useAdminUsers,
  useAdminSuspendUser,
  useAdminDeleteUser,
  useUnsuspendUser,
  usePromoteUser,
  useAdminBanUser,
  useAdminUnbanUser,
  useAdminUnsilenceUser,
} from "../hooks/api/useModeration";
import AdminLayout, {
  ADM,
  Pill,
  Btn,
  TopBar,
} from "../components/AdminLayout";

interface AdminUser {
  id: string;
  username: string | null;
  email: string | null;
  subscription_tier: string;
  warning_count: number;
  is_suspended: boolean;
  suspended_until: string | null;
  is_silenced: boolean;
  silenced_until: string | null;
  is_banned: boolean;
  ban_reason: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;

function getUserStatus(u: AdminUser): { label: string; color: string } {
  if (u.is_banned) return { label: "BANNED", color: ADM.rose };
  if (u.is_suspended) {
    const until = u.suspended_until
      ? new Date(u.suspended_until).toLocaleDateString()
      : "";
    return { label: `SUSP ${until}`, color: ADM.amber };
  }
  if (u.is_silenced) return { label: "SILENCED", color: "#fb923c" };
  if (
    u.silenced_until &&
    new Date(u.silenced_until) > new Date()
  )
    return { label: "SILENCED", color: "#fb923c" };
  if (u.warning_count > 0) return { label: `WARNED ×${u.warning_count}`, color: ADM.amber };
  return { label: "ACTIVE", color: ADM.primary };
}

const TIER_COLOR: Record<string, string> = {
  free: ADM.textMuted,
  premium: ADM.amber,
  admin: ADM.rose,
};

function ManagePanel({
  user,
  onClose,
  onRefresh,
}: {
  user: AdminUser;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [suspendDays, setSuspendDays] = useState(7);
  const [suspendReason, setSuspendReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const suspendMut = useAdminSuspendUser();
  const unsuspendMut = useUnsuspendUser();
  const deleteMut = useAdminDeleteUser();
  const tierMut = usePromoteUser();
  const banMut = useAdminBanUser();
  const unbanMut = useAdminUnbanUser();
  const unsilenceMut = useAdminUnsilenceUser();

  const busy =
    suspendMut.isPending ||
    unsuspendMut.isPending ||
    deleteMut.isPending ||
    tierMut.isPending ||
    banMut.isPending ||
    unbanMut.isPending ||
    unsilenceMut.isPending;

  async function doAction(fn: () => Promise<unknown>) {
    await fn();
    onRefresh();
    onClose();
  }

  const status = getUserStatus(user);

  return (
    <div
      style={{
        margin: "0 0 0 0",
        background: ADM.surface2,
        border: `1px solid ${ADM.borderStrong}`,
        borderTop: "none",
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
        gap: 18,
      }}
    >
      {/* Info */}
      <div>
        <div
          style={{
            fontFamily: ADM.mono,
            fontSize: 9.5,
            color: ADM.textDim,
            letterSpacing: "0.1em",
            marginBottom: 8,
          }}
        >
          MANAGE @{user.username ?? user.id}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          <Pill color={status.color}>{status.label}</Pill>
          <Pill color={TIER_COLOR[user.subscription_tier] ?? ADM.textMuted}>
            {user.subscription_tier.toUpperCase()}
          </Pill>
          {user.warning_count > 0 && (
            <Pill color={user.warning_count >= 3 ? ADM.rose : ADM.amber}>
              ⚠ {user.warning_count}
            </Pill>
          )}
        </div>
        <div
          style={{
            fontFamily: ADM.mono,
            fontSize: 10.5,
            color: ADM.textDim,
            lineHeight: 1.7,
          }}
        >
          {user.id}
          {user.email && (
            <>
              <br />
              {user.email}
            </>
          )}
          <br />
          Joined {new Date(user.created_at).toLocaleDateString()}
        </div>
      </div>

      {/* Tier + suspend */}
      <div>
        <div
          style={{
            fontFamily: ADM.mono,
            fontSize: 9.5,
            color: ADM.textDim,
            letterSpacing: "0.1em",
            marginBottom: 6,
          }}
        >
          CHANGE TIER
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          {["free", "premium", "admin"].map((t) => (
            <Btn
              key={t}
              color={user.subscription_tier === t ? "green" : "ghost"}
              size="xs"
              disabled={busy || user.subscription_tier === t}
              onClick={() => doAction(() => tierMut.mutateAsync({ userId: user.id, tier: t }))}
            >
              {t.toUpperCase()}
            </Btn>
          ))}
        </div>

        {user.is_suspended ? (
          <>
            <div
              style={{
                fontFamily: ADM.mono,
                fontSize: 9.5,
                color: ADM.textDim,
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              SUSPEND
            </div>
            <Btn
              color="green"
              size="xs"
              disabled={busy}
              onClick={() => doAction(() => unsuspendMut.mutateAsync(user.id))}
            >
              {unsuspendMut.isPending ? "LIFTING…" : "LIFT SUSPENSION"}
            </Btn>
          </>
        ) : (
          <>
            <div
              style={{
                fontFamily: ADM.mono,
                fontSize: 9.5,
                color: ADM.textDim,
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              SUSPEND
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
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
              <span style={{ fontFamily: ADM.mono, fontSize: 10, color: ADM.textDim }}>
                DAYS
              </span>
              <Btn
                color="warn"
                size="xs"
                disabled={busy}
                onClick={() =>
                  doAction(() =>
                    suspendMut.mutateAsync({
                      userId: user.id,
                      days: suspendDays,
                      reason: suspendReason || undefined,
                    })
                  )
                }
              >
                APPLY
              </Btn>
            </div>
            <input
              type="text"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="reason (optional)"
              style={{
                width: "100%",
                padding: "4px 6px",
                background: ADM.bg,
                border: `1px solid ${ADM.border}`,
                color: ADM.text,
                fontFamily: ADM.mono,
                fontSize: 10.5,
                borderRadius: 4,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </>
        )}
      </div>

      {/* Silence + ban */}
      <div>
        {(u => {
          const isSilenced =
            u.is_silenced ||
            (!!u.silenced_until && new Date(u.silenced_until) > new Date());
          return (
            <>
              <div
                style={{
                  fontFamily: ADM.mono,
                  fontSize: 9.5,
                  color: ADM.textDim,
                  letterSpacing: "0.1em",
                  marginBottom: 6,
                }}
              >
                SILENCE
              </div>
              {isSilenced ? (
                <>
                  <div
                    style={{
                      fontFamily: ADM.mono,
                      fontSize: 10,
                      color: "#fb923c",
                      marginBottom: 6,
                    }}
                  >
                    ● CURRENTLY SILENCED
                  </div>
                  <Btn
                    color="green"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      doAction(() => unsilenceMut.mutateAsync(user.id))
                    }
                    style={{ marginBottom: 14 }}
                  >
                    LIFT SILENCE
                  </Btn>
                </>
              ) : (
                <span
                  style={{
                    fontFamily: ADM.mono,
                    fontSize: 10,
                    color: ADM.textDim,
                    display: "block",
                    marginBottom: 14,
                  }}
                >
                  NOT SILENCED
                </span>
              )}
            </>
          );
        })(user)}

        <div
          style={{
            fontFamily: ADM.mono,
            fontSize: 9.5,
            color: ADM.textDim,
            letterSpacing: "0.1em",
            marginBottom: 6,
          }}
        >
          BAN STATUS
        </div>
        {user.is_banned ? (
          <Btn
            color="green"
            size="xs"
            disabled={busy}
            onClick={() => doAction(() => unbanMut.mutateAsync(user.id))}
          >
            {unbanMut.isPending ? "UNBANNING…" : "UNBAN"}
          </Btn>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="ban reason"
              style={{
                flex: 1,
                padding: "3px 6px",
                background: ADM.bg,
                border: `1px solid ${ADM.border}`,
                color: ADM.text,
                fontFamily: ADM.mono,
                fontSize: 10.5,
                borderRadius: 4,
                outline: "none",
                minWidth: 0,
              }}
            />
            <Btn
              color="danger"
              size="xs"
              disabled={busy}
              onClick={() =>
                doAction(() =>
                  banMut.mutateAsync({ userId: user.id, reason: banReason || undefined })
                )
              }
            >
              BAN
            </Btn>
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div>
        <div
          style={{
            fontFamily: ADM.mono,
            fontSize: 9.5,
            color: ADM.rose,
            letterSpacing: "0.1em",
            marginBottom: 6,
          }}
        >
          DANGER ZONE
        </div>
        {!confirmDelete ? (
          <Btn
            color="danger"
            size="xs"
            style={{ display: "block", width: "100%", marginBottom: 8 }}
            onClick={() => setConfirmDelete(true)}
          >
            DELETE ACCOUNT
          </Btn>
        ) : (
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                fontFamily: ADM.mono,
                fontSize: 10,
                color: ADM.rose,
                marginBottom: 6,
              }}
            >
              PERMANENTLY DELETE?
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <Btn
                color="ghost"
                size="xs"
                onClick={() => setConfirmDelete(false)}
              >
                CANCEL
              </Btn>
              <Btn
                color="danger"
                size="xs"
                disabled={busy}
                onClick={() => doAction(() => deleteMut.mutateAsync(user.id))}
              >
                {deleteMut.isPending ? "DELETING…" : "CONFIRM"}
              </Btn>
            </div>
          </div>
        )}
        <Btn color="ghost" size="xs" onClick={onClose} style={{ display: "block", width: "100%" }}>
          CLOSE ✕
        </Btn>
      </div>
    </div>
  );
}

function UserRow({
  user,
  isExpanded,
  onToggle,
  onRefresh,
}: {
  user: AdminUser;
  isExpanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const status = getUserStatus(user);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 200px 80px 110px 50px 110px 80px",
          padding: "8px 14px",
          alignItems: "center",
          borderBottom: `1px solid ${ADM.border}`,
          background: isExpanded ? ADM.surface2 : "transparent",
          fontSize: 12,
          cursor: "default",
        }}
      >
        <div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 12.5,
              letterSpacing: "-0.005em",
              color: ADM.text,
              fontFamily: ADM.sans,
            }}
          >
            {user.username ? `@${user.username}` : (
              <span style={{ color: ADM.textDim, fontStyle: "italic" }}>no username</span>
            )}
          </div>
          <div
            style={{
              fontFamily: ADM.mono,
              fontSize: 10,
              color: ADM.textDim,
              letterSpacing: "0.04em",
              marginTop: 1,
            }}
          >
            {user.id}
          </div>
        </div>

        <span
          style={{
            fontFamily: ADM.mono,
            fontSize: 10.5,
            color: ADM.textMuted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {user.email ?? "—"}
        </span>

        <Pill color={TIER_COLOR[user.subscription_tier] ?? ADM.textMuted}>
          {user.subscription_tier.toUpperCase()}
        </Pill>

        <Pill color={status.color}>{status.label}</Pill>

        <span
          style={{
            fontFamily: ADM.mono,
            fontSize: 11,
            fontWeight: 600,
            color:
              user.warning_count >= 3
                ? ADM.rose
                : user.warning_count >= 1
                  ? ADM.amber
                  : ADM.textDim,
            textAlign: "center",
          }}
        >
          {user.warning_count || "—"}
        </span>

        <span
          style={{
            fontFamily: ADM.mono,
            fontSize: 10.5,
            color: ADM.textMuted,
          }}
        >
          {new Date(user.created_at).toLocaleDateString()}
        </span>

        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <Btn
            color={isExpanded ? "ghost" : "default"}
            size="xs"
            onClick={onToggle}
          >
            {isExpanded ? "CLOSE" : "MANAGE"}
          </Btn>
        </div>
      </div>

      {isExpanded && (
        <ManagePanel
          user={user}
          onClose={onToggle}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}

export default function AdminUsersPage() {
  usePageTitle("Users — Admin");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [skip, setSkip] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setSkip(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, refetch } = useAdminUsers(debouncedSearch, skip);
  const users: AdminUser[] = (data as any)?.users ?? [];
  const total: number = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(skip / PAGE_SIZE) + 1;

  return (
    <AdminLayout>
      <TopBar
        crumb="ADMIN /"
        title="Users"
        sub={`· ${total.toLocaleString()} total`}
        actions={
          <Btn
            color="ghost"
            size="xs"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            REFRESH ↻
          </Btn>
        }
      />

      {/* Search bar */}
      <div
        style={{
          padding: "10px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: `1px solid ${ADM.border}`,
          background: ADM.surface,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: ADM.bg,
            border: `1px solid ${ADM.border}`,
            borderRadius: 6,
            width: 300,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke={ADM.textDim}
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Username, email, or UID…"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: ADM.text,
              fontFamily: ADM.mono,
              fontSize: 11,
              width: "100%",
            }}
          />
        </div>
        <span style={{ fontFamily: ADM.mono, fontSize: 10.5, color: ADM.textDim }}>
          PAGE {currentPage} / {totalPages || 1}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 200px 80px 110px 50px 110px 80px",
            padding: "8px 14px",
            borderBottom: `1px solid ${ADM.border}`,
            background: ADM.surface2,
            fontFamily: ADM.mono,
            fontSize: 9.5,
            color: ADM.textDim,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          <span>USER / UID</span>
          <span>EMAIL</span>
          <span>TIER</span>
          <span>STATUS</span>
          <span style={{ textAlign: "center" }}>⚠</span>
          <span>JOINED</span>
          <span style={{ textAlign: "right" }}>ACTIONS</span>
        </div>

        {isLoading ? (
          <div style={{ padding: "24px 18px" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: 48,
                  background: ADM.surface,
                  borderRadius: 4,
                  marginBottom: 2,
                  opacity: 0.5,
                }}
              />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div
            style={{
              padding: "48px 18px",
              textAlign: "center",
              fontFamily: ADM.mono,
              fontSize: 12,
              color: ADM.textDim,
            }}
          >
            NO USERS FOUND
          </div>
        ) : (
          users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isExpanded={expandedId === u.id}
              onToggle={() => setExpandedId(expandedId === u.id ? null : u.id)}
              onRefresh={refetch}
            />
          ))
        )}
      </div>

      {/* Pagination footer */}
      <div
        style={{
          padding: "8px 18px",
          borderTop: `1px solid ${ADM.border}`,
          background: ADM.surface,
          display: "flex",
          alignItems: "center",
          fontFamily: ADM.mono,
          fontSize: 11,
          color: ADM.textDim,
          gap: 12,
          flexShrink: 0,
        }}
      >
        <span>
          PAGE {currentPage} OF {totalPages || 1} · {total.toLocaleString()} TOTAL
        </span>
        <span style={{ flex: 1 }} />
        <Btn
          color="ghost"
          size="xs"
          disabled={skip === 0}
          onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
        >
          ‹ PREV
        </Btn>
        <Btn
          color="ghost"
          size="xs"
          disabled={skip + PAGE_SIZE >= total}
          onClick={() => setSkip(skip + PAGE_SIZE)}
        >
          NEXT ›
        </Btn>
      </div>
    </AdminLayout>
  );
}
