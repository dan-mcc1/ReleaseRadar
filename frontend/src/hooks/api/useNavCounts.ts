import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export interface NavCounts {
  pendingRequests: number;
  unreadRecs: number;
  householdInvites: number;
}

export function useNavCounts() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.navCounts(user?.uid ?? ""),
    queryFn: async ({ signal }): Promise<NavCounts> => {
      const [incomingRes, unreadRes, householdRes] = await Promise.all([
        queryFetch<{ count: number }>("/friends/requests/incoming/count", { signal }),
        queryFetch<{ count: number }>("/recommendations/unread-count", { signal }),
        queryFetch<{ count: number }>("/households/invites/count", { signal }),
      ]);
      return {
        pendingRequests: incomingRes.count,
        unreadRecs: unreadRes.count,
        householdInvites: householdRes.count,
      };
    },
    enabled: !!user,
    staleTime: 60_000,
    // SSE drives live updates, but if the connection dropped while the tab was
    // backgrounded the badge can go stale — refetch on focus as a cheap backup.
    refetchOnWindowFocus: true,
  });
}

export function useNavAvatar() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.navAvatar(user?.uid ?? ""),
    queryFn: async ({ signal }) => {
      const data = await queryFetch<{ avatar_key: string | null }>("/user/me", { signal });
      return data.avatar_key;
    },
    enabled: !!user,
  });
}
