import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";
import type { WatchStatus } from "../../components/WatchButton";

interface StatusResult {
  status: WatchStatus;
  rating: number | null;
}

export function useWatchStatus(
  contentType: string,
  contentId: number,
  options?: { skip?: boolean },
) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.watchStatus(user?.uid ?? "", contentType, contentId),
    queryFn: () =>
      queryFetch<StatusResult>(
        `/watchlist/${contentType}/${contentId}/status`,
      ),
    enabled: !!user && contentId > 0 && !options?.skip,
  });
}

export function useBulkWatchStatus(
  items: { content_type: string; content_id: number }[],
) {
  const user = useAuthUser();
  const key = items
    .map((i) => `${i.content_type}:${i.content_id}`)
    .sort()
    .join(",");

  return useQuery({
    queryKey: queryKeys.bulkWatchStatus(user?.uid ?? "", key),
    queryFn: () =>
      queryFetch<Record<string, StatusResult>>("/watchlist/status/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      }),
    enabled: !!user && items.length > 0,
  });
}
