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
import {
  Button,
  Card,
  CheckIcon,
  EmptyState,
  IconButton,
  PageHeader,
  SectionHeader,
  cx,
  focusRing,
} from "../components/ui";
import { UserMinusIcon } from "@heroicons/react/24/outline";

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
    { id: "search", label: "Find people" },
    { id: "sent", label: "Sent", count: outgoing.length },
  ];

  // One incoming request. The banner on the Friends tab says "Ignore"; the
  // Requests tab says "Decline" and shows "…" while the answer is sent.
  function renderIncoming(req: IncomingReq, inRequestsTab: boolean) {
    const busy = respondingId === req.friendship_id;
    return (
      <div
        key={req.friendship_id}
        className="grid items-center gap-4 py-3"
        style={{ gridTemplateColumns: "auto 1fr auto" }}
      >
        <Avatar name={req.from_user.username} size={inRequestsTab ? 44 : 40} />
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link
              to={`/user/${req.from_user.username}`}
              className="font-semibold text-body text-neutral-100 hover:text-primary-300 transition-colors"
            >
              @{req.from_user.username}
            </Link>
            <span className="text-caption text-neutral-500">
              · {timeAgo(req.created_at)}
            </span>
          </div>
          {req.message && (
            <p className="mt-1 italic text-label text-neutral-400 leading-snug">
              "{req.message}"
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={inRequestsTab ? undefined : <CheckIcon className="w-3.5 h-3.5" />}
            onClick={() => respond(req.friendship_id, true)}
            disabled={busy}
          >
            {inRequestsTab && busy ? "…" : "Accept"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => respond(req.friendship_id, false)}
            disabled={busy}
          >
            {inRequestsTab ? "Decline" : "Ignore"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div data-tour="friends-header">
        <PageHeader
          title="Your circle"
          description={
            <>
              {friends.length} friend{friends.length !== 1 ? "s" : ""}
              {incoming.length > 0 &&
                ` · ${incoming.length} request${incoming.length !== 1 ? "s" : ""} waiting`}
            </>
          }
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-neutral-700 mt-6 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "flex items-center gap-2 pb-3 text-label font-medium border-b-2 -mb-px transition-colors",
              focusRing,
              tab === t.id
                ? "border-primary-500 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span
                className={cx(
                  "tabular text-caption px-1.5 py-px rounded font-semibold",
                  t.badge
                    ? "bg-primary-500 text-neutral-900"
                    : "bg-neutral-800 text-neutral-400",
                )}
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
              {/* Inline requests */}
              {incoming.length > 0 && (
                <section className="mb-8">
                  <SectionHeader
                    title={`${incoming.length} new friend request${incoming.length !== 1 ? "s" : ""}`}
                    divider
                  />
                  <div className="flex flex-col divide-y divide-neutral-800">
                    {incoming.map((req) => renderIncoming(req, false))}
                  </div>
                </section>
              )}

              {/* Friends grid */}
              {friends.length === 0 ? (
                <EmptyState
                  title="No friends added yet"
                  action={
                    <Button variant="primary" onClick={() => setTab("search")}>
                      Find people
                    </Button>
                  }
                />
              ) : (
                <>
                  <SectionHeader
                    title="People you follow"
                    note={String(friends.length)}
                    divider
                    className="mb-2"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8">
                    {friends.map(({ friendship_id, friend }) => (
                      <div
                        key={friendship_id}
                        className="flex items-center gap-3 py-3 border-b border-neutral-800"
                      >
                        <Avatar name={friend.username} size={40} />
                        <div className="flex-1 min-w-0">
                          <Link
                            to={`/user/${friend.username}`}
                            className="text-body font-semibold text-neutral-100 hover:text-primary-300 transition-colors truncate block"
                          >
                            @{friend.username}
                          </Link>
                        </div>
                        {confirmRemoveId === friend.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-caption text-neutral-400">
                              Remove?
                            </span>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => removeFriend(friend.id)}
                              disabled={
                                removeMutation.isPending &&
                                removeMutation.variables === friend.id
                              }
                            >
                              Yes
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmRemoveId(null)}
                            >
                              No
                            </Button>
                          </div>
                        ) : (
                          <IconButton
                            size="sm"
                            label={`Remove @${friend.username}`}
                            icon={<UserMinusIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
                            onClick={() => setConfirmRemoveId(friend.id)}
                          />
                        )}
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
              <SectionHeader title="Friend requests" note={String(incoming.length)} divider />
              {incoming.length === 0 ? (
                <EmptyState title="No pending requests" className="py-12" />
              ) : (
                <div className="flex flex-col divide-y divide-neutral-800">
                  {incoming.map((req) => renderIncoming(req, true))}
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
              <SectionHeader title="Pending requests" note={String(outgoing.length)} divider />
              {outgoing.length === 0 ? (
                <EmptyState
                  title="No outgoing requests"
                  className="py-12"
                  action={
                    <Button onClick={() => setTab("search")}>Find people</Button>
                  }
                />
              ) : (
                <div className="flex flex-col divide-y divide-neutral-800">
                  {outgoing.map((req) => (
                    <div
                      key={req.friendship_id}
                      className="flex items-center gap-4 py-3"
                    >
                      <Avatar name={req.to_user.username} size={40} />
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/user/${req.to_user.username}`}
                          className="font-semibold text-body text-neutral-100 hover:text-primary-300 transition-colors"
                        >
                          @{req.to_user.username}
                        </Link>
                        <div className="text-caption text-neutral-500 mt-1">
                          Sent {timeAgo(req.created_at)} · Pending
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => cancelRequest(req.friendship_id)}
                        disabled={cancellingId === req.friendship_id}
                      >
                        {cancellingId === req.friendship_id
                          ? "Cancelling…"
                          : "Cancel"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Side rail */}
        <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          {/* Search tab tip */}
          {tab === "search" && (
            <p className="text-label text-neutral-400 leading-relaxed m-0">
              You can{" "}
              <strong className="text-neutral-200 font-semibold">
                follow public profiles
              </strong>{" "}
              instantly to see their activity. To unlock shared watch history
              and recommendations, send a friend request.
            </p>
          )}

          {/* Sent requests (compact, always visible unless on sent tab) */}
          {tab !== "sent" && outgoing.length > 0 && (
            <section>
              <SectionHeader
                as="h3"
                title="Sent requests"
                note={String(outgoing.length)}
                divider
              />
              <div className="flex flex-col divide-y divide-neutral-800">
                {outgoing.map((req) => (
                  <div
                    key={req.friendship_id}
                    className="flex items-center gap-3 py-3"
                  >
                    <Avatar name={req.to_user.username} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="text-label font-semibold text-neutral-200 truncate">
                        @{req.to_user.username}
                      </div>
                      <div className="text-caption text-neutral-500 mt-0.5">
                        {timeAgo(req.created_at)} · Pending
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelRequest(req.friendship_id)}
                      disabled={cancellingId === req.friendship_id}
                    >
                      Cancel
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Invite */}
          <Card padding="sm">
            <h3 className="text-title font-semibold text-neutral-100 mb-2">
              Bring a friend
            </h3>
            <p className="text-label text-neutral-400 mb-4 leading-relaxed">
              Invite someone to ReleaseRadar and track what you're both
              watching.
            </p>
            <Button onClick={() => setTab("search")} className="w-full">
              Find people
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
