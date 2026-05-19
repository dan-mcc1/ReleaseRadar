import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFriends,
  useFriendRequestsIncoming,
  useFriendRequestsOutgoing,
  useRespondToFriendRequest,
  useCancelFriendRequest,
  useRemoveFriend,
} from "../hooks/api/useFriends";
import { queryKeys } from "../hooks/api/queryKeys";
import { useAuthUser } from "../hooks/useAuthUser";
import { usePageTitle } from "../hooks/usePageTitle";
import FriendSearch from "../components/FriendSearch";

type Tab = "friends" | "requests" | "search" | "sent";

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const hue = hashHue(name);
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `oklch(0.32 0.10 ${hue})`,
        color: `oklch(0.88 0.08 ${hue})`,
        fontSize: size * 0.38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        flexShrink: 0,
        letterSpacing: "0.02em",
      }}
    >
      {initials}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

type FriendEntry = {
  friendship_id: number;
  friend: { id: string; username: string };
};
type IncomingReq = {
  friendship_id: number;
  from_user: { id: string; username: string };
  created_at: string;
  message?: string | null;
};
type OutgoingReq = {
  friendship_id: number;
  to_user: { id: string; username: string };
  created_at: string;
};

export default function FriendsPage() {
  usePageTitle("Friends");
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("friends");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const { data: friendsData = [] } = useFriends();
  const { data: incomingData = [] } = useFriendRequestsIncoming();
  const { data: outgoingData = [] } = useFriendRequestsOutgoing();

  const friends = friendsData as FriendEntry[];
  const incoming = incomingData as IncomingReq[];
  const outgoing = outgoingData as OutgoingReq[];

  const respondMutation = useRespondToFriendRequest();
  const cancelMutation = useCancelFriendRequest();
  const removeMutation = useRemoveFriend();

  function invalidateFriends() {
    if (!user) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.friendRequestsIncoming(user.uid),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.friendRequestsOutgoing(user.uid),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.navCounts(user.uid) });
  }

  async function respond(friendshipId: number, accept: boolean) {
    setRespondingId(friendshipId);
    const req = incoming.find((r) => r.friendship_id === friendshipId)!;
    try {
      await respondMutation.mutateAsync({ friendshipId, accept });
      invalidateFriends();
      queryClient.setQueryData(
        queryKeys.friendRequestsIncoming(user!.uid),
        (old: IncomingReq[]) =>
          (old ?? []).filter((r) => r.friendship_id !== friendshipId),
      );
      if (accept) {
        queryClient.setQueryData(
          queryKeys.friends(user!.uid),
          (old: FriendEntry[]) => [
            ...(old ?? []),
            { friendship_id: friendshipId, friend: req.from_user },
          ],
        );
      }
    } finally {
      setRespondingId(null);
    }
  }

  async function cancelRequest(friendshipId: number) {
    setCancellingId(friendshipId);
    try {
      await cancelMutation.mutateAsync(friendshipId);
      invalidateFriends();
      queryClient.setQueryData(
        queryKeys.friendRequestsOutgoing(user!.uid),
        (old: OutgoingReq[]) =>
          (old ?? []).filter((r) => r.friendship_id !== friendshipId),
      );
    } finally {
      setCancellingId(null);
    }
  }

  async function removeFriend(friendId: string) {
    try {
      await removeMutation.mutateAsync(friendId);
      invalidateFriends();
      queryClient.setQueryData(
        queryKeys.friends(user!.uid),
        (old: FriendEntry[]) =>
          (old ?? []).filter((f) => f.friend.id !== friendId),
      );
    } finally {
      setConfirmRemoveId(null);
    }
  }

  const tabs: { id: Tab; label: string; count?: number; badge?: boolean }[] = [
    { id: "friends", label: "Friends", count: friends.length },
    {
      id: "requests",
      label: "Requests",
      count: incoming.length,
      badge: incoming.length > 0,
    },
    { id: "search", label: "Find People" },
    { id: "sent", label: "Sent", count: outgoing.length },
  ];

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-end gap-6 mb-1">
        <div>
          <div className="font-mono text-[11px] tracking-[0.12em] text-neutral-500 uppercase mb-2">
            {friends.length} friend{friends.length !== 1 ? "s" : ""}
            {incoming.length > 0 && (
              <>
                {" · "}
                <span className="text-primary-400">
                  {incoming.length} request{incoming.length !== 1 ? "s" : ""}{" "}
                  waiting
                </span>
              </>
            )}
          </div>
          <h1
            className="m-0 font-normal text-[38px] tracking-tight leading-none text-neutral-100"
            data-tour="friends-header"
          >
            Your{" "}
            <em className="not-italic text-primary-400 font-normal">circle</em>
          </h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-neutral-700 mt-6 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "flex items-center gap-2 pb-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-primary-500 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span
                className={[
                  "font-mono text-[10.5px] px-1.5 py-px rounded font-semibold",
                  t.badge
                    ? "bg-primary-500 text-neutral-900"
                    : "bg-neutral-800 text-neutral-400",
                ].join(" ")}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
        {/* Main panel */}
        <div>
          {/* Friends tab */}
          {tab === "friends" && (
            <div>
              {/* Inline requests banner */}
              {incoming.length > 0 && (
                <div className="bg-primary-500/10 border border-primary-500/30 rounded-2xl p-5 mb-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-6 h-6 rounded-full bg-primary-500 flex items-center justify-center shrink-0">
                      <svg
                        width="11"
                        height="11"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        className="text-neutral-900"
                        strokeWidth={2.5}
                      >
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </div>
                    <h3 className="m-0 font-normal text-[19px] tracking-tight text-neutral-100">
                      {incoming.length} new friend request
                      {incoming.length !== 1 ? "s" : ""}
                    </h3>
                  </div>
                  <div className="flex flex-col gap-3">
                    {incoming.map((req) => (
                      <div
                        key={req.friendship_id}
                        className="grid items-center gap-4 p-3 bg-neutral-900 border border-neutral-800 rounded-xl"
                        style={{ gridTemplateColumns: "auto 1fr auto" }}
                      >
                        <Avatar name={req.from_user.username} size={40} />
                        <div>
                          <div className="flex items-baseline gap-2">
                            <Link
                              to={`/user/${req.from_user.username}`}
                              className="font-semibold text-[14px] text-neutral-100 hover:text-primary-400 transition-colors"
                            >
                              @{req.from_user.username}
                            </Link>
                            <span className="font-mono text-[10.5px] text-neutral-500">
                              · {timeAgo(req.created_at)}
                            </span>
                          </div>
                          {req.message && (
                            <p className="mt-1 italic text-[13.5px] text-neutral-400 leading-snug">
                              "{req.message}"
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => respond(req.friendship_id, true)}
                            disabled={respondingId === req.friendship_id}
                            className="flex items-center gap-1.5 text-[12px] font-semibold bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-neutral-900 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2.5}
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Accept
                          </button>
                          <button
                            onClick={() => respond(req.friendship_id, false)}
                            disabled={respondingId === req.friendship_id}
                            className="text-[12px] font-medium text-neutral-400 hover:text-neutral-200 disabled:opacity-50 bg-transparent border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Ignore
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Friends grid */}
              {friends.length === 0 ? (
                <div className="text-center py-16 text-neutral-500">
                  <p className="text-[15px] mb-3">No friends added yet.</p>
                  <button
                    onClick={() => setTab("search")}
                    className="text-sm bg-primary-600 hover:bg-primary-500 text-white font-medium px-4 py-1.5 rounded-lg transition-colors"
                  >
                    Find People
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-4 mb-5">
                    <span className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase">
                      All friends
                    </span>
                    <h2 className="m-0 font-normal text-[24px] tracking-tight text-neutral-100 italic">
                      People you follow
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {friends.map(({ friendship_id, friend }) => (
                      <div
                        key={friendship_id}
                        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex flex-col gap-4"
                      >
                        <div className="flex items-start gap-4">
                          <Avatar name={friend.username} size={48} />
                          <div className="flex-1 min-w-0">
                            <Link
                              to={`/user/${friend.username}`}
                              className="text-[15px] font-semibold text-neutral-100 hover:text-primary-400 transition-colors tracking-tight"
                            >
                              @{friend.username}
                            </Link>
                          </div>
                          {confirmRemoveId === friend.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-neutral-400">
                                Remove?
                              </span>
                              <button
                                onClick={() => removeFriend(friend.id)}
                                disabled={
                                  removeMutation.isPending &&
                                  removeMutation.variables === friend.id
                                }
                                className="text-[11px] bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white px-2 py-1 rounded-md"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setConfirmRemoveId(null)}
                                className="text-[11px] text-neutral-500 hover:text-neutral-300"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRemoveId(friend.id)}
                              className="text-neutral-600 hover:text-neutral-400 transition-colors"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <circle cx="12" cy="5" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="12" cy="19" r="2" />
                              </svg>
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Link
                            to={`/user/${friend.username}`}
                            className="flex-1 text-center text-[12px] font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-3 py-2 rounded-lg transition-colors"
                          >
                            View profile
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Requests tab */}
          {tab === "requests" && (
            <div>
              <div className="flex items-baseline gap-4 mb-5">
                <span className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase">
                  Incoming
                </span>
                <h2 className="m-0 font-normal text-[24px] tracking-tight text-neutral-100 italic">
                  Friend requests
                </h2>
              </div>
              {incoming.length === 0 ? (
                <p className="text-neutral-500 text-[14px]">
                  No pending requests.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {incoming.map((req) => (
                    <div
                      key={req.friendship_id}
                      className="grid items-center gap-4 p-4 bg-neutral-900 border border-neutral-800 rounded-2xl"
                      style={{ gridTemplateColumns: "auto 1fr auto" }}
                    >
                      <Avatar name={req.from_user.username} size={44} />
                      <div>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <Link
                            to={`/user/${req.from_user.username}`}
                            className="font-semibold text-[14px] text-neutral-100 hover:text-primary-400 transition-colors"
                          >
                            @{req.from_user.username}
                          </Link>
                          <span className="font-mono text-[10.5px] text-neutral-500">
                            · {timeAgo(req.created_at)}
                          </span>
                        </div>
                        {req.message && (
                          <p className="mt-1.5 italic text-[13px] text-neutral-400 leading-snug">
                            "{req.message}"
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => respond(req.friendship_id, true)}
                          disabled={respondingId === req.friendship_id}
                          className="text-[12px] font-semibold bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-neutral-900 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {respondingId === req.friendship_id
                            ? "…"
                            : "Accept"}
                        </button>
                        <button
                          onClick={() => respond(req.friendship_id, false)}
                          disabled={respondingId === req.friendship_id}
                          className="text-[12px] font-medium text-neutral-400 hover:text-neutral-200 disabled:opacity-50 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Search tab */}
          {tab === "search" && (
            <FriendSearch
              friendIds={new Set(friends.map((f) => f.friend.id))}
              onRequestSent={() => {
                invalidateFriends();
                setTab("sent");
              }}
            />
          )}

          {/* Sent tab */}
          {tab === "sent" && (
            <div>
              <div className="flex items-baseline gap-4 mb-5">
                <span className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase">
                  Sent · {outgoing.length}
                </span>
                <h2 className="m-0 font-normal text-[24px] tracking-tight text-neutral-100 italic">
                  Pending requests
                </h2>
              </div>
              {outgoing.length === 0 ? (
                <p className="text-neutral-500 text-[14px]">
                  No outgoing requests.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {outgoing.map((req) => (
                    <div
                      key={req.friendship_id}
                      className="flex items-center gap-4 p-4 bg-neutral-900 border border-neutral-800 rounded-2xl"
                    >
                      <Avatar name={req.to_user.username} size={40} />
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/user/${req.to_user.username}`}
                          className="font-semibold text-[14px] text-neutral-100 hover:text-primary-400 transition-colors"
                        >
                          @{req.to_user.username}
                        </Link>
                        <div className="font-mono text-[10px] text-neutral-500 tracking-[0.05em] uppercase mt-1">
                          Sent {timeAgo(req.created_at)} · Pending
                        </div>
                      </div>
                      <button
                        onClick={() => cancelRequest(req.friendship_id)}
                        disabled={cancellingId === req.friendship_id}
                        className="text-[12px] text-neutral-400 hover:text-error-400 disabled:opacity-50 border border-neutral-700 hover:border-error-700 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {cancellingId === req.friendship_id
                          ? "Cancelling…"
                          : "Cancel"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Side rail */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          {/* Search tab tip */}
          {tab === "search" && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
              <div
                className="font-mono text-[10px] text-neutral-500 uppercase mb-2"
                style={{ letterSpacing: "0.15em" }}
              >
                Tip
              </div>
              <p className="text-[12px] text-neutral-400 leading-relaxed m-0">
                You can{" "}
                <strong className="text-neutral-200 font-semibold">
                  follow public profiles
                </strong>{" "}
                instantly to see their activity. To unlock shared watch history
                and recommendations, send a friend request.
              </p>
            </div>
          )}

          {/* Sent requests (compact, always visible unless on sent tab) */}
          {tab !== "sent" && outgoing.length > 0 && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
              <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">
                Sent requests · {outgoing.length}
              </div>
              <div className="flex flex-col gap-3">
                {outgoing.map((req, i) => (
                  <div
                    key={req.friendship_id}
                    className={[
                      "flex items-center gap-3",
                      i > 0 ? "pt-3 border-t border-neutral-800" : "",
                    ].join(" ")}
                  >
                    <Avatar name={req.to_user.username} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-neutral-200 truncate">
                        @{req.to_user.username}
                      </div>
                      <div className="font-mono text-[10px] text-neutral-500 tracking-[0.04em] uppercase mt-0.5">
                        {timeAgo(req.created_at)} · Pending
                      </div>
                    </div>
                    <button
                      onClick={() => cancelRequest(req.friendship_id)}
                      disabled={cancellingId === req.friendship_id}
                      className="text-[11.5px] text-neutral-500 hover:text-error-400 disabled:opacity-50 border border-neutral-700 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invite card */}
          <div
            className="p-5 rounded-2xl border border-neutral-800 relative overflow-hidden"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.20 0.08 160) 0%, oklch(0.12 0.04 200) 100%)",
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(60% 80% at 80% 20%, oklch(0.50 0.15 155 / 0.18), transparent 65%)",
              }}
            />
            <div className="relative">
              <div className="text-[21px] tracking-tight leading-tight mb-2 text-neutral-100 italic font-normal">
                Bring a{" "}
                <em className="not-italic text-primary-400">friend</em>
              </div>
              <p className="text-[12.5px] text-neutral-400 mb-4 leading-relaxed">
                Invite someone to ReleaseRadar and track what you're both
                watching.
              </p>
              <button
                onClick={() => setTab("search")}
                className="w-full text-[12.5px] font-semibold bg-primary-500 hover:bg-primary-400 text-neutral-900 px-4 py-2.5 rounded-xl transition-colors"
              >
                Find People
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
