import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch, checkedFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export function useFriends() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friends(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch("/friends", { signal }),
    enabled: !!user,
  });
}

export function useFriendRequestsIncoming() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendRequestsIncoming(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch("/friends/requests/incoming", { signal }),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useFriendRequestsOutgoing() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendRequestsOutgoing(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch("/friends/requests/outgoing", { signal }),
    enabled: !!user,
  });
}

export function useFollowers() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.followers(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch("/friends/followers", { signal }),
    enabled: !!user,
  });
}

export function useSendFriendRequest() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      addresseeUsername,
      message,
    }: {
      addresseeUsername: string;
      message?: string;
    }) =>
      queryFetch<{ status: string; id: number }>("/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressee_username: addresseeUsername, message: message || null }),
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
      checkedFetch("/friends/respond", {
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
      checkedFetch(`/friends/cancel/${friendshipId}`, { method: "DELETE" }),
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
      checkedFetch(`/friends/remove/${friendId}`, { method: "DELETE" }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
    },
  });
}

export function useFriendSuggestions() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendSuggestions(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch("/friends/suggestions", { signal }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFriendsContentActivity(contentType: "movie" | "tv", contentId: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendsContentActivity(user?.uid ?? "", contentType, contentId),
    queryFn: ({ signal }) => queryFetch<{ username: string; status: string; rating: number | null }[]>(
      `/friends/content/${contentType}/${contentId}`
    , { signal }),
    enabled: !!user && !!contentId,
    staleTime: 60_000,
  });
}

export function useFriendSearch(query: string) {
  const user = useAuthUser();
  return useQuery({
    queryKey: ["friends", "search", query],
    queryFn: ({ signal }) =>
      queryFetch(`/friends/search?q=${encodeURIComponent(query)}`, { signal }),
    enabled: !!user && query.trim().length >= 1,
  });
}
