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
    queryFn: async (): Promise<NavCounts> => {
      const [incomingRes, unreadRes] = await Promise.all([
        queryFetch<{ friendship_id: number }[]>("/friends/requests/incoming"),
        queryFetch<{ count: number }>("/recommendations/unread-count"),
      ]);
      return {
        pendingRequests: incomingRes.length,
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
    queryFn: async () => {
      const data = await queryFetch<{ avatar_key: string | null }>("/user/me");
      return data.avatar_key;
    },
    enabled: !!user,
  });
}
