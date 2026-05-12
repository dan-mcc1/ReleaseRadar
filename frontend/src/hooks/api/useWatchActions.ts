import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryKeys } from "./queryKeys";
import { useAuthUser } from "../useAuthUser";
import type { WatchStatus } from "../../components/WatchButton";
import { TrackingLimitError } from "./useSubscription";

async function checkedFetch(path: string, options: RequestInit): Promise<void> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      if (body?.detail?.error === "tracking_limit_reached") {
        throw new TrackingLimitError(body.detail.limit, body.detail.current);
      }
    }
    throw new Error(`Request failed: ${res.status}`);
  }
}

const ENDPOINTS: Record<string, { add: string; remove: string } | null> = {
  none: null,
  "Want To Watch": { add: "/watchlist/add", remove: "/watchlist/remove" },
  "Currently Watching": {
    add: "/currently-watching/add",
    remove: "/currently-watching/remove",
  },
  Watched: { add: "/watched/add", remove: "/watched/remove" },
};

export function useUpdateWatchStatus() {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      currentStatus,
      targetStatus,
      notify,
    }: {
      contentType: "movie" | "tv";
      contentId: number;
      currentStatus: WatchStatus;
      targetStatus: WatchStatus;
      notify?: boolean;
    }) => {
      const headers = { "Content-Type": "application/json" };

      const addEndpoint = ENDPOINTS[targetStatus];
      if (addEndpoint) {
        const payload: Record<string, unknown> = {
          content_type: contentType,
          content_id: contentId,
        };
        if (targetStatus === "Want To Watch" && notify !== undefined) {
          payload.notify = notify;
        }
        await checkedFetch(addEndpoint.add, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      }

      const body = JSON.stringify({
        content_type: contentType,
        content_id: contentId,
      });

      const removeEndpoint = ENDPOINTS[currentStatus];
      if (removeEndpoint) {
        await checkedFetch(removeEndpoint.remove, { method: "DELETE", headers, body });
      }

      return targetStatus;
    },
    onSuccess: (_, { contentType, contentId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchStatus(user.uid, contentType, contentId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(user.uid) });
      queryClient.invalidateQueries({ queryKey: queryKeys.watched(user.uid) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.currentlyWatching(user.uid),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar(user.uid) });
      queryClient.invalidateQueries({
        queryKey: ["watchStatus", "bulk", user.uid],
      });
      queryClient.invalidateQueries({
        queryKey: ["recommendations", "forYou", user.uid],
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.profileSummary(user.uid),
      });
    },
  });
}

export function useRateItem() {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      rating,
    }: {
      contentType: "movie" | "tv";
      contentId: number;
      rating: number | null;
    }) => {
      await apiFetch("/watched/rate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          rating,
        }),
      });
      return rating;
    },
    onSuccess: (_, { contentType, contentId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchStatus(user.uid, contentType, contentId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.watched(user.uid) });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar(user.uid) });
      queryClient.invalidateQueries({
        queryKey: ["watchStatus", "bulk", user.uid],
      });
      queryClient.invalidateQueries({
        queryKey: ["recommendations", "forYou", user.uid],
      });
    },
  });
}
