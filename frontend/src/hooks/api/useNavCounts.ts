import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

interface NavCounts {
  pendingRequests: number;
  unreadRecs: number;
}

export function useNavCounts() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.navCounts(user?.uid ?? ""),
    queryFn: async ({ signal }): Promise<NavCounts> => {
      const [incomingRes, unreadRes] = await Promise.all([
        queryFetch<{ count: number }>("/friends/requests/incoming/count", { signal }),
        queryFetch<{ count: number }>("/recommendations/unread-count", { signal }),
      ]);
      return {
        pendingRequests: incomingRes.count,
        unreadRecs: unreadRes.count,
      };
    },
    enabled: !!user,
    staleTime: 60_000,
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
