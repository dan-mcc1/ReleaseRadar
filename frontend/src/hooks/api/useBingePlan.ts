import { useQuery } from "@tanstack/react-query";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export interface ShowProgress {
  show_id: number;
  show_name: string;
  total_episodes: number;
  watched_episodes: number;
  remaining_episodes: number;
  remaining_minutes: number;
  eps_per_week_recent: number | null;
  completion_estimate: string | null;
  finish_by_date: string | null;
  eps_per_day_needed: number | null;
  mins_per_day_needed: number | null;
}

export function useShowProgress(showId: number | undefined) {
  const user = useAuthUser();
  return useQuery({
    queryKey: ["showProgress", user?.uid ?? "", showId],
    queryFn: ({ signal }) => queryFetch<ShowProgress>(`/watchlist/progress/${showId}`, { signal }),
    enabled: !!user && !!showId,
    staleTime: 60_000,
  });
}

export function useShowProgressBulk(showIds: number[]) {
  const user = useAuthUser();
  const sortedIds = [...showIds].sort((a, b) => a - b);
  return useQuery({
    queryKey: ["showProgress", "bulk", user?.uid ?? "", sortedIds],
    queryFn: ({ signal }) =>
      queryFetch<Record<string, ShowProgress>>(`/watchlist/progress-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_ids: sortedIds }),
        signal,
      }),
    enabled: !!user && showIds.length > 0,
    staleTime: 60_000,
  });
}

// Back-compat aliases â€” remove once all call sites are updated
export type BingePlan = ShowProgress;
export const useBingePlan = useShowProgress;
export const useBingePlanBulk = useShowProgressBulk;
