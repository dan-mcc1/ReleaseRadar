import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export function useFriends() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friends(user?.uid ?? ""),
    queryFn: () => queryFetch("/friends"),
    enabled: !!user,
  });
}

export function useFriendRequestsIncoming() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendRequestsIncoming(user?.uid ?? ""),
    queryFn: () => queryFetch("/friends/requests/incoming"),
    enabled: !!user,
  });
}

export function useFriendRequestsOutgoing() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendRequestsOutgoing(user?.uid ?? ""),
    queryFn: () => queryFetch("/friends/requests/outgoing"),
    enabled: !!user,
  });
}

export function useFollowers() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.followers(user?.uid ?? ""),
    queryFn: () => queryFetch("/friends/followers"),
    enabled: !!user,
  });
}

export function useSendFriendRequest() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (addresseeUsername: string) =>
      queryFetch<{ status: string; id: number }>("/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressee_username: addresseeUsername }),
      }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.friendRequestsOutgoing(user.uid),
      });
    },
  });
}

export function useRespondToFriendRequest() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      friendshipId,
      accept,
    }: {
      friendshipId: number;
      accept: boolean;
    }) =>
      apiFetch("/friends/respond", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendship_id: friendshipId, accept }),
      }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.friendRequestsIncoming(user.uid),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.navCounts(user.uid),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.friendsActivity(user.uid),
      });
    },
  });
}

export function useCancelFriendRequest() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: number) =>
      apiFetch(`/friends/cancel/${friendshipId}`, { method: "DELETE" }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.friendRequestsOutgoing(user.uid),
      });
    },
  });
}

export function useRemoveFriend() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendId: string) =>
      apiFetch(`/friends/remove/${friendId}`, { method: "DELETE" }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
    },
  });
}

export function useFriendSearch(query: string) {
  const user = useAuthUser();
  return useQuery({
    queryKey: ["friends", "search", query],
    queryFn: () =>
      queryFetch(`/friends/search?q=${encodeURIComponent(query)}`),
    enabled: !!user && query.trim().length >= 1,
  });
}
