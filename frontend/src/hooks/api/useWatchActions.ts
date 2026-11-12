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
      targetStatus,
      notify,
    }: {
      contentType: "movie" | "tv";
      contentId: number;
      // Not sent: the server looks up the current list itself. Still passed
      // in so onSuccess can move the item between the cached lists.
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

function withRating(
  data: ListData,
  contentType: "movie" | "tv",
  contentId: number,
  rating: number | null,
): ListData {
  return {
    movies:
      contentType === "movie"
        ? data.movies.map((m) => (m.id === contentId ? { ...m, user_rating: rating } : m))
        : data.movies,
    shows:
      contentType === "tv"
        ? data.shows.map((s) => (s.id === contentId ? { ...s, user_rating: rating } : s))
        : data.shows,
  };
}

// The newest rating sent per title ("movie:123"), so only its failure
// triggers a refetch.
const latestRating = new Map<string, number>();

export function useRateItem() {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    // The watched list shows the new rating at once. On a failure the list
    // is refetched, unless a newer rating of the same title is on its way:
    // guessing the old value goes wrong when several are in flight.
    onMutate: async ({ contentType, contentId, rating }) => {
      if (!user) return;
      const watchedKey = queryKeys.watched(user.uid);
      const itemKey = `${contentType}:${contentId}`;
      const seq = (latestRating.get(itemKey) ?? 0) + 1;
      latestRating.set(itemKey, seq);
      // A refetch in flight would overwrite the new rating with the old one.
      // It's cancelled here and run again once this settles.
      const wasFetching = queryClient.isFetching({ queryKey: watchedKey }) > 0;
      await queryClient.cancelQueries({ queryKey: watchedKey });
      const data = queryClient.getQueryData<ListData>(watchedKey);
      if (data) {
        queryClient.setQueryData<ListData>(
          watchedKey,
          withRating(data, contentType, contentId, rating),
        );
      }
      return { seq, itemKey, wasFetching };
    },
    onError: (_err, _vars, ctx) => {
      if (!user || !ctx || latestRating.get(ctx.itemKey) !== ctx.seq) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.watched(user.uid) });
    },
    onSettled: (_data, _err, _vars, ctx) => {
      if (user && ctx?.wasFetching) {
        queryClient.invalidateQueries({ queryKey: queryKeys.watched(user.uid) });
      }
    },
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

      // The watched list already has it, from onMutate.

      // Confirm with the server.
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchStatus(user.uid, contentType, contentId),
      });
    },
  });
}
