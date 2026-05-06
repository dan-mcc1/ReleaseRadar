import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryKeys } from "./queryKeys";
import { useAuthUser } from "../useAuthUser";
import type { WatchStatus } from "../../components/WatchButton";

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
    }: {
      contentType: "movie" | "tv";
      contentId: number;
      currentStatus: WatchStatus;
      targetStatus: WatchStatus;
    }) => {
      const headers = { "Content-Type": "application/json" };
      const body = JSON.stringify({
        content_type: contentType,
        content_id: contentId,
      });

      const addEndpoint = ENDPOINTS[targetStatus];
      if (addEndpoint) {
        await apiFetch(addEndpoint.add, { method: "POST", headers, body });
      }

      const removeEndpoint = ENDPOINTS[currentStatus];
      if (removeEndpoint) {
        await apiFetch(removeEndpoint.remove, { method: "DELETE", headers, body });
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
