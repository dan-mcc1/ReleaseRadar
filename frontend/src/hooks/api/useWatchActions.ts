import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { checkedFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";
import type { WatchStatus } from "../../components/WatchButton";
import type { Movie, Show } from "../../types/calendar";

interface ListData {
  movies: Movie[];
  shows: Show[];
}

interface StatusResult {
  status: WatchStatus;
  rating: number | null;
}

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
      await checkedFetch("/watch-status/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          target: targetStatus,
          current: currentStatus,
          ...(targetStatus === "Want To Watch" && notify !== undefined ? { notify } : {}),
        }),
      });
      return targetStatus;
    },
    onMutate: async ({ contentType, contentId, targetStatus }) => {
      if (!user) return;

      const statusKey = queryKeys.watchStatus(user.uid, contentType, contentId);
      await queryClient.cancelQueries({ queryKey: statusKey });

      const previousStatus = queryClient.getQueryData<StatusResult>(statusKey);

      // Optimistically update the per-item status cache.
      queryClient.setQueryData<StatusResult>(statusKey, (prev) => ({
        status: targetStatus,
        rating: prev?.rating ?? null,
      }));

      // Optimistically patch any bulk status caches that include this item.
      const bulkItemKey = `${contentType}:${contentId}`;
      const bulkSnapshots: Array<[readonly unknown[], Record<string, StatusResult>]> = [];
      queryClient
        .getQueriesData<Record<string, StatusResult>>({
          queryKey: ["watchStatus", "bulk", user.uid],
        })
        .forEach(([key, data]) => {
          if (data && bulkItemKey in data) {
            bulkSnapshots.push([key, data]);
            queryClient.setQueryData<Record<string, StatusResult>>(key, {
              ...data,
              [bulkItemKey]: { status: targetStatus, rating: data[bulkItemKey].rating },
            });
          }
        });

      return { previousStatus, bulkSnapshots };
    },
    onError: (_err, { contentType, contentId }, ctx) => {
      if (!user || !ctx) return;
      if (ctx.previousStatus !== undefined) {
        queryClient.setQueryData(
          queryKeys.watchStatus(user.uid, contentType, contentId),
          ctx.previousStatus,
        );
      }
      for (const [key, data] of ctx.bulkSnapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: (targetStatus, { contentType, contentId, currentStatus }) => {
      if (!user) return;

      const statusToKey = (s: WatchStatus) => {
        if (s === "Want To Watch") return queryKeys.watchlist(user.uid);
        if (s === "Currently Watching") return queryKeys.currentlyWatching(user.uid);
        if (s === "Watched") return queryKeys.watched(user.uid);
        return null;
      };

      const oldKey = statusToKey(currentStatus);
      const newKey = statusToKey(targetStatus);

      // Pull the item out of the old list and remove it surgically.
      let movedItem: Movie | Show | undefined;
      if (oldKey) {
        const oldData = queryClient.getQueryData<ListData>(oldKey);
        if (oldData) {
          movedItem =
            contentType === "movie"
              ? oldData.movies.find((m) => m.id === contentId)
              : oldData.shows.find((s) => s.id === contentId);
          queryClient.setQueryData<ListData>(oldKey, {
            movies:
              contentType === "movie"
                ? oldData.movies.filter((m) => m.id !== contentId)
                : oldData.movies,
            shows:
              contentType === "tv"
                ? oldData.shows.filter((s) => s.id !== contentId)
                : oldData.shows,
          });
        }
      }

      // Prepend the item into the new list if we already have it cached.
      if (newKey && movedItem) {
        const newData = queryClient.getQueryData<ListData>(newKey);
        if (newData) {
          queryClient.setQueryData<ListData>(newKey, {
            movies:
              contentType === "movie"
                ? [movedItem as Movie, ...newData.movies]
                : newData.movies,
            shows:
              contentType === "tv"
                ? [movedItem as Show, ...newData.shows]
                : newData.shows,
          });
        }
      }

      // Confirm watchStatus with the server.
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchStatus(user.uid, contentType, contentId),
      });
      // Refetch the target list so server-computed fields (sort_key, is_watched, etc.) are fresh.
      if (newKey) {
        queryClient.invalidateQueries({ queryKey: newKey });
      }
      // Refresh For You recommendations since tracked content changed.
      queryClient.invalidateQueries({
        queryKey: ["recommendations", "forYou", user.uid],
      });
      // Calendar / shelf calendars include watchlist items — refresh so newly tracked
      // shows and movies appear without a reload.
      queryClient.invalidateQueries({ queryKey: ["calendar", user.uid] });
      queryClient.invalidateQueries({ queryKey: ["shelves", user.uid] });
      // My Collections buckets (finished / in_progress) are derived from
      // the user's watched movies — refresh so the page reflects this change.
      queryClient.invalidateQueries({ queryKey: queryKeys.myCollections() });
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
      await checkedFetch("/watched/rate", {
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
    onSuccess: (newRating, { contentType, contentId }) => {
      if (!user) return;

      // Update per-item watchStatus with the new rating.
      queryClient.setQueryData<StatusResult>(
        queryKeys.watchStatus(user.uid, contentType, contentId),
        (prev) => prev ? { ...prev, rating: newRating } : undefined,
      );

      // Patch the rating in any bulk watchStatus caches.
      const bulkItemKey = `${contentType}:${contentId}`;
      queryClient
        .getQueriesData<Record<string, StatusResult>>({
          queryKey: ["watchStatus", "bulk", user.uid],
        })
        .forEach(([key, data]) => {
          if (data && bulkItemKey in data) {
            queryClient.setQueryData<Record<string, StatusResult>>(key, {
              ...data,
              [bulkItemKey]: { ...data[bulkItemKey], rating: newRating },
            });
          }
        });

      // Patch user_rating on the item inside the watched list.
      const watchedKey = queryKeys.watched(user.uid);
      const watchedData = queryClient.getQueryData<ListData>(watchedKey);
      if (watchedData) {
        queryClient.setQueryData<ListData>(watchedKey, {
          movies:
            contentType === "movie"
              ? watchedData.movies.map((m) =>
                  m.id === contentId ? { ...m, user_rating: newRating } : m,
                )
              : watchedData.movies,
          shows:
            contentType === "tv"
              ? watchedData.shows.map((s) =>
                  s.id === contentId ? { ...s, user_rating: newRating } : s,
                )
              : watchedData.shows,
        });
      }

      // Confirm with the server.
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchStatus(user.uid, contentType, contentId),
      });
    },
  });
}
