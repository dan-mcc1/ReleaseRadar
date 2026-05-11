import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
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

const TIER_COLORS: Record<string, string> = {
  free: "text-neutral-400 bg-neutral-700",
  premium: "text-amber-300 bg-amber-900/40",
  admin: "text-red-300 bg-red-900/40",
};

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${TIER_COLORS[tier] ?? "text-neutral-400 bg-neutral-700"}`}
    >
      {tier}
    </span>
  );
}

function UserRow({
  user,
  onRefresh,
}: {
  user: AdminUser;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [suspendDays, setSuspendDays] = useState(7);
  const [suspendReason, setSuspendReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const suspendMutation = useAdminSuspendUser();
  const unsuspendMutation = useUnsuspendUser();
  const deleteMutation = useAdminDeleteUser();
  const tierMutation = usePromoteUser();
  const banMutation = useAdminBanUser();
  const unbanMutation = useAdminUnbanUser();
  const unsilenceMutation = useAdminUnsilenceUser();

  async function suspend() {
    await suspendMutation.mutateAsync({
      userId: user.id,
      days: suspendDays,
      reason: suspendReason || undefined,
    });
    onRefresh();
    setExpanded(false);
  }

  async function unsuspend() {
    await unsuspendMutation.mutateAsync(user.id);
    onRefresh();
  }

  async function deleteUser() {
    await deleteMutation.mutateAsync(user.id);
    onRefresh();
    setConfirmDelete(false);
  }

  async function setTier(tier: string) {
    await tierMutation.mutateAsync({ userId: user.id, tier });
    onRefresh();
  }

  async function ban() {
    await banMutation.mutateAsync({
      userId: user.id,
      reason: banReason || undefined,
    });
    onRefresh();
    setExpanded(false);
  }

  async function unban() {
    await unbanMutation.mutateAsync(user.id);
    onRefresh();
  }

  async function unsilence() {
    await unsilenceMutation.mutateAsync(user.id);
    onRefresh();
  }

  const busy =
    suspendMutation.isPending ||
    unsuspendMutation.isPending ||
    deleteMutation.isPending ||
    tierMutation.isPending ||
    banMutation.isPending ||
    unbanMutation.isPending ||
    unsilenceMutation.isPending;

  return (
    <>
      <tr
        className={`border-t border-neutral-700/50 hover:bg-neutral-750 transition-colors ${expanded ? "bg-neutral-750" : ""}`}
      >
        <td className="px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-neutral-200">
              {user.username ? (
                `@${user.username}`
              ) : (
                <span className="text-neutral-500 italic">no username</span>
              )}
            </span>
            <span className="text-xs text-neutral-500">
              {user.email ?? "—"}
            </span>
          </div>
        </td>
        <td className="px-4 py-3">
          <TierBadge tier={user.subscription_tier} />
        </td>
        <td className="px-4 py-3">
          {user.is_banned ? (
            <span className="text-xs text-red-400">Banned</span>
          ) : user.is_suspended ? (
            <span className="text-xs text-warning-400">
              Suspended
              {user.suspended_until
                ? ` until ${new Date(user.suspended_until).toLocaleDateString()}`
                : ""}
            </span>
          ) : user.is_silenced ? (
            <span className="text-xs text-orange-400">
              Silenced (permanent)
            </span>
          ) : user.silenced_until &&
            new Date(user.silenced_until) > new Date() ? (
            <span className="text-xs text-orange-400">
              Silenced until{" "}
              {new Date(user.silenced_until).toLocaleDateString()}
            </span>
          ) : (
            <span className="text-xs text-success-400">Active</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-neutral-500">
          {new Date(user.created_at).toLocaleDateString()}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-neutral-400 hover:text-neutral-200 border border-neutral-700 hover:border-neutral-500 px-3 py-1 rounded-lg transition-colors"
          >
            {expanded ? "Close" : "Manage"}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-neutral-800/80">
          <td colSpan={5} className="px-4 py-4">
            <div className="space-y-4">
              {/* Tier */}
              <div>
                <p className="text-xs text-neutral-400 font-medium mb-2">
                  Change tier
                </p>
                <div className="flex gap-2">
                  {["free", "premium", "admin"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setTier(t)}
                      disabled={busy || user.subscription_tier === t}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 capitalize ${
                        user.subscription_tier === t
                          ? "border-primary-500 bg-primary-900/30 text-primary-300"
                          : "border-neutral-600 text-neutral-400 hover:border-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Suspend / Unsuspend */}
              <div>
                <p className="text-xs text-neutral-400 font-medium mb-2">
                  Suspension{" "}
                  <span className="text-neutral-600 font-normal">
                    (full account lockout, auto-lifts when time expires)
                  </span>
                </p>
                {user.is_suspended ? (
                  <button
                    onClick={unsuspend}
                    disabled={busy}
                    className="text-xs bg-success-700 hover:bg-success-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {unsuspendMutation.isPending
                      ? "Unsuspending…"
                      : "Unsuspend"}
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-neutral-400">Days:</label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={suspendDays}
                        onChange={(e) => setSuspendDays(Number(e.target.value))}
                        className="w-16 bg-neutral-900 border border-neutral-600 rounded px-2 py-1 text-sm text-neutral-200 focus:outline-none"
                      />
                    </div>
                    <input
                      type="text"
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="flex-1 min-w-0 bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none"
                    />
                    <button
                      onClick={suspend}
                      disabled={busy}
                      className="text-xs bg-warning-700 hover:bg-warning-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                    >
                      {suspendMutation.isPending ? "Suspending…" : "Suspend"}
                    </button>
                  </div>
                )}
              </div>

              {/* Silence */}
              <div>
                <p className="text-xs text-neutral-400 font-medium mb-2">
                  Silence{" "}
                  <span className="text-neutral-600 font-normal">
                    (can't post reviews/comments, site still usable)
                  </span>
                </p>
                {user.is_silenced ? (
                  <button
                    onClick={unsilence}
                    disabled={busy}
                    className="text-xs bg-success-700 hover:bg-success-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {unsilenceMutation.isPending
                      ? "Unsilencing…"
                      : "Remove permanent silence"}
                  </button>
                ) : user.silenced_until &&
                  new Date(user.silenced_until) > new Date() ? (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-orange-400">
                      Silenced until{" "}
                      {new Date(user.silenced_until).toLocaleDateString()}
                    </span>
                    <button
                      onClick={unsilence}
                      disabled={busy}
                      className="text-xs bg-success-700 hover:bg-success-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                    >
                      {unsilenceMutation.isPending
                        ? "Lifting…"
                        : "Lift silence"}
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-neutral-600 italic">
                    Not silenced — silence is applied automatically at warning
                    3+
                  </span>
                )}
              </div>

              {/* Ban */}
              <div className="border-t border-neutral-700 pt-3">
                <p className="text-xs text-neutral-400 font-medium mb-2">Ban</p>
                {user.is_banned ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-400">
                      Banned{user.ban_reason ? `: ${user.ban_reason}` : ""}
                    </p>
                    <button
                      onClick={unban}
                      disabled={busy}
                      className="text-xs bg-success-700 hover:bg-success-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                    >
                      {unbanMutation.isPending ? "Unbanning…" : "Unban"}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="text"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      placeholder="Ban reason (optional)"
                      className="flex-1 min-w-0 bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none"
                    />
                    <button
                      onClick={ban}
                      disabled={busy}
                      className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                    >
                      {banMutation.isPending ? "Banning…" : "Ban account"}
                    </button>
                  </div>
                )}
              </div>

              {/* Delete */}
              <div className="border-t border-neutral-700 pt-3">
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs text-error-400 hover:text-error-300 border border-error-700 hover:border-error-500 px-4 py-1.5 rounded-lg transition-colors"
                  >
                    Delete account
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-error-300">
                      Permanently delete this account?
                    </span>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={deleteUser}
                      disabled={busy}
                      className="text-xs bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors font-medium"
                    >
                      {deleteMutation.isPending
                        ? "Deleting…"
                        : "Confirm delete"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const PAGE_SIZE = 50;

export default function AdminUsersPage() {
  usePageTitle("Users — Admin");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [skip, setSkip] = useState(0);

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
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/admin"
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <span className="text-sm text-neutral-500">
          {total.toLocaleString()} total
        </span>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search username or email…"
          className="w-full bg-neutral-800 border border-neutral-700 focus:border-neutral-500 rounded-xl pl-9 pr-4 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none transition-colors"
        />
      </div>

      {/* Table */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="space-y-px">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-14 bg-neutral-800 animate-pulse border-t border-neutral-700/50"
              />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-neutral-500 text-sm text-center py-12">
            No users found.
          </p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-neutral-700">
                <th className="px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Tier
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} onRefresh={refetch} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              disabled={skip === 0}
              className="text-sm px-3 py-1.5 bg-neutral-800 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-300 rounded-lg transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setSkip(skip + PAGE_SIZE)}
              disabled={skip + PAGE_SIZE >= total}
              className="text-sm px-3 py-1.5 bg-neutral-800 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-300 rounded-lg transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
