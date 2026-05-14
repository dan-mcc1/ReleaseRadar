import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryKeys } from "./queryKeys";
import { useAuthUser } from "../useAuthUser";
import type { WatchStatus } from "../../components/WatchButton";
import type { Movie, Show } from "../../types/calendar";
import { TrackingLimitError } from "./useSubscription";

interface ListData {
  movies: Movie[];
  shows: Show[];
}

interface StatusResult {
  status: WatchStatus;
  rating: number | null;
}

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

      // Update the per-item watchStatus cache immediately.
      queryClient.setQueryData<StatusResult>(
        queryKeys.watchStatus(user.uid, contentType, contentId),
        (prev) => ({ status: targetStatus, rating: prev?.rating ?? null }),
      );

      // Patch any bulk watchStatus caches that include this item.
      const bulkItemKey = `${contentType}:${contentId}`;
      queryClient
        .getQueriesData<Record<string, StatusResult>>({
          queryKey: ["watchStatus", "bulk", user.uid],
        })
        .forEach(([key, data]) => {
          if (data && bulkItemKey in data) {
            queryClient.setQueryData<Record<string, StatusResult>>(key, {
              ...data,
              [bulkItemKey]: { status: targetStatus, rating: data[bulkItemKey].rating },
            });
          }
        });

      // Confirm watchStatus with the server.
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchStatus(user.uid, contentType, contentId),
      });
      // Refetch the target list so server-computed fields (sort_key, is_watched, etc.) are fresh.
      if (newKey) {
        queryClient.invalidateQueries({ queryKey: newKey });
      }
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
