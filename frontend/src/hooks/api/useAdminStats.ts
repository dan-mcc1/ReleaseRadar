import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export interface AdminStats {
  users: {
    total: number;
    new_7d: number;
    new_30d: number;
    email_notifications_enabled: number;
    tier_breakdown: Record<string, number>;
  };
  tracking: {
    total_watchlist: number;
    total_watched: number;
    total_episodes_watched: number;
    total_currently_watching: number;
  };
  activity: {
    total: number;
    last_7d: number;
    last_30d: number;
    by_type: Record<string, number>;
  };
  social: {
    total_friendships: number;
    total_followers: number;
  };
  top_shows: { id: number; name: string; tracking_count: number }[];
  top_movies: { id: number; title: string; tracking_count: number }[];
  growth: { date: string; signups: number }[];
}

export function useAdminStats() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.adminStats(),
    queryFn: ({ signal }) => queryFetch<AdminStats>("/admin/stats", { signal }),
    enabled: !!user,
    staleTime: 60_000,
  });
}
