import { useQuery } from "@tanstack/react-query";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export interface BingePlan {
  show_id: number;
  show_name: string;
  total_episodes: number;
  watched_episodes: number;
  remaining_episodes: number;
  remaining_minutes: number;
  eps_per_week_recent: number | null;
  completion_estimate: string | null;
}

export function useBingePlan(showId: number | undefined) {
  const user = useAuthUser();
  return useQuery({
    queryKey: ["bingePlan", user?.uid ?? "", showId],
    queryFn: () => queryFetch<BingePlan>(`/watchlist/binge/${showId}`),
    enabled: !!user && !!showId,
    staleTime: 60_000,
  });
}

export function useBingePlanBulk(showIds: number[]) {
  const user = useAuthUser();
  const idsStr = showIds.sort().join(",");
  return useQuery({
    queryKey: ["bingePlan", "bulk", user?.uid ?? "", idsStr],
    queryFn: () =>
      queryFetch<Record<string, BingePlan>>(
        `/watchlist/binge-bulk?show_ids=${idsStr}`,
      ),
    enabled: !!user && showIds.length > 0,
    staleTime: 60_000,
  });
}
