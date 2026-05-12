import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFriends,
  useFriendRequestsIncoming,
  useFriendRequestsOutgoing,
} from "../hooks/api/useFriends";
import { queryKeys } from "../hooks/api/queryKeys";
import { useAuthUser } from "../hooks/useAuthUser";
import { usePageTitle } from "../hooks/usePageTitle";
import FriendSearch from "../components/FriendSearch";
import FriendsList from "../components/FriendsList";
import FriendRequests from "../components/FriendRequests";

type Tab = "search" | "friends" | "requests";

export default function FriendsPage() {
  usePageTitle("Friends");
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("search");

  const { data: friendsData = [] } = useFriends();
  const { data: incomingData = [] } = useFriendRequestsIncoming();
  const { data: outgoingData = [] } = useFriendRequestsOutgoing();

  const friends = friendsData as { friendship_id: number; friend: { id: string; username: string } }[];
  const incoming = incomingData as { friendship_id: number; from_user: { id: string; username: string }; created_at: string; message?: string | null }[];
  const outgoing = outgoingData as { friendship_id: number; to_user: { id: string; username: string }; created_at: string }[];

  const incomingCount = incoming.length;

  function invalidateFriends() {
    if (!user) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
    queryClient.invalidateQueries({ queryKey: queryKeys.friendRequestsIncoming(user.uid) });
    queryClient.invalidateQueries({ queryKey: queryKeys.friendRequestsOutgoing(user.uid) });
    queryClient.invalidateQueries({ queryKey: queryKeys.navCounts(user.uid) });
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "search", label: "Find People" },
    { id: "friends", label: "Friends", badge: friends.length || undefined },
    { id: "requests", label: "Requests", badge: incomingCount || undefined },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-neutral-100 mb-6">Friends</h1>

      <div className="lg:grid lg:grid-cols-3 lg:gap-8 lg:items-start">
        {/* Sidebar: search always visible on desktop, tab on mobile */}
        <div className="lg:bg-neutral-800/50 lg:border lg:border-neutral-700 lg:rounded-xl lg:p-5 space-y-4">
          <h2 className="hidden lg:block text-sm font-semibold text-neutral-400 uppercase tracking-wider">
            Find People
          </h2>

          {/* Mobile: search only shown when search tab is active */}
          <div className={tab === "search" ? "block lg:block" : "hidden lg:block"}>
            <FriendSearch
              friendIds={new Set(friends.map((f) => f.friend.id))}
              onRequestSent={() => {
                invalidateFriends();
                setTab("requests");
              }}
            />
          </div>
        </div>

        {/* Main panel */}
        <div className="lg:col-span-2 mt-6 lg:mt-0">
          {/* Tab bar */}
          <div className="flex border-b border-neutral-700 mb-6">
            {tabs.map(({ id, label, badge }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={[
                    "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                    id === "search" ? "lg:hidden" : "",
                    tab === id
                      ? "border-primary-500 text-primary-400"
                      : "border-transparent text-neutral-400 hover:text-neutral-200",
                  ].join(" ")}
                >
                  {label}
                  {badge != null && (
                    <span
                      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full leading-none ${
                        id === "requests" && incomingCount > 0
                          ? "bg-error-500 text-white"
                          : "bg-neutral-700 text-neutral-300"
                      }`}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </button>
              ))}
          </div>

          {/* Friends list — shown on "friends" tab, and on desktop when "search" tab is active */}
          <div className={tab === "friends" || tab === "search" ? (tab === "search" ? "hidden lg:block" : "block") : "hidden"}>
            <FriendsList
              friends={friends}
              onFriendRemoved={(friendId) => {
                if (!user) return;
                invalidateFriends();
                queryClient.setQueryData(
                  queryKeys.friends(user.uid),
                  (old: typeof friends) => (old ?? []).filter((f) => f.friend.id !== friendId),
                );
              }}
              onFindFriends={() => setTab("search")}
            />
          </div>

          {/* Requests */}
          {tab === "requests" && (
            <FriendRequests
              incoming={incoming}
              outgoing={outgoing}
              onResponded={(friendshipId, accepted, req) => {
                if (!user) return;
                invalidateFriends();
                queryClient.setQueryData(
                  queryKeys.friendRequestsIncoming(user.uid),
                  (old: typeof incoming) =>
                    (old ?? []).filter((r) => r.friendship_id !== friendshipId),
                );
                if (accepted) {
                  queryClient.setQueryData(
                    queryKeys.friends(user.uid),
                    (old: typeof friends) => [
                      ...(old ?? []),
                      { friendship_id: friendshipId, friend: req.from_user },
                    ],
                  );
                }
              }}
              onCancelled={(friendshipId) => {
                if (!user) return;
                invalidateFriends();
                queryClient.setQueryData(
                  queryKeys.friendRequestsOutgoing(user.uid),
                  (old: typeof outgoing) =>
                    (old ?? []).filter((r) => r.friendship_id !== friendshipId),
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
