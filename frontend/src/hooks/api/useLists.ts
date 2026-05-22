import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch, checkedFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";
import type { Movie, Show } from "../../types/calendar";

interface ListData {
  movies: Movie[];
  shows: Show[];
}

export function useWatchlist(enabled = true) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.watchlist(user?.uid ?? ""),
    queryFn: () => queryFetch<ListData>("/watchlist"),
    enabled: !!user && enabled,
  });
}

export function useWatched(enabled = true) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.watched(user?.uid ?? ""),
    queryFn: () => queryFetch<ListData>("/watched"),
    enabled: !!user && enabled,
  });
}

export function useCurrentlyWatching() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.currentlyWatching(user?.uid ?? ""),
    queryFn: () => queryFetch<ListData>("/currently-watching"),
    enabled: !!user,
  });
}

export function useFavorites() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.favorites(user?.uid ?? ""),
    queryFn: () => queryFetch<ListData>("/favorites"),
    enabled: !!user,
  });
}

export function useFavoriteStatus(contentType: string, contentId: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.favoriteStatus(user?.uid ?? "", contentType, contentId),
    queryFn: () =>
      queryFetch<{ favorited: boolean }>(
        `/favorites/status?content_type=${contentType}&content_id=${contentId}`,
      ),
    enabled: !!user,
  });
}

export function useToggleFavorite() {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      favorited,
    }: {
      contentType: string;
      contentId: number;
      favorited: boolean;
    }) => {
      const method = favorited ? "DELETE" : "POST";
      const endpoint = favorited ? "/favorites/remove" : "/favorites/add";
      await checkedFetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType, content_id: contentId }),
      });
      return !favorited;
    },
    onMutate: async ({ contentType, contentId, favorited }) => {
      if (!user) return;
      const key = queryKeys.favoriteStatus(user.uid, contentType, contentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ favorited: boolean }>(key);
      queryClient.setQueryData<{ favorited: boolean }>(key, { favorited: !favorited });
      return { previous };
    },
    onError: (_err, { contentType, contentId }, ctx) => {
      if (!user || ctx?.previous === undefined) return;
      queryClient.setQueryData(
        queryKeys.favoriteStatus(user.uid, contentType, contentId),
        ctx.previous,
      );
    },
    onSettled: (_newState, _err, { contentType, contentId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.favoriteStatus(user.uid, contentType, contentId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.favorites(user.uid),
      });
    },
  });
}

export function useRemoveFromList() {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      list,
      contentType,
      contentId,
    }: {
      list: "watchlist" | "watched" | "currently-watching";
      contentType: string;
      contentId: number;
    }) => {
      await checkedFetch(`/${list}/remove`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType, content_id: contentId }),
      });
    },
    onMutate: async ({ list, contentType, contentId }) => {
      if (!user) return;
      const keyMap = {
        watchlist: queryKeys.watchlist(user.uid),
        watched: queryKeys.watched(user.uid),
        "currently-watching": queryKeys.currentlyWatching(user.uid),
      };
      const key = keyMap[list];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ListData>(key);
      if (previous) {
        queryClient.setQueryData<ListData>(key, {
          movies: contentType === "movie"
            ? previous.movies.filter((m) => m.id !== contentId)
            : previous.movies,
          shows: contentType === "tv"
            ? previous.shows.filter((s) => s.id !== contentId)
            : previous.shows,
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous || !context?.key) return;
      queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.profileSummary(user.uid),
      });
    },
  });
}

export function useReorderWatchlist() {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      beforeId,
      afterId,
    }: {
      contentType: "movie" | "tv";
      contentId: number;
      beforeId: number | null;
      afterId: number | null;
    }) => {
      const res = await apiFetch("/watchlist/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          before_id: beforeId,
          after_id: afterId,
        }),
      });
      if (!res.ok) throw new Error("Failed to reorder");
      return res.json() as Promise<{ movies: Movie[]; shows: Show[] }>;
    },
    onMutate: async ({ contentType, contentId, beforeId, afterId }) => {
      if (!user) return;
      const key = queryKeys.watchlist(user.uid);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ movies: Movie[]; shows: Show[] }>(key);

      if (previous) {
        // Build combined list, reorder, split back out
        const movies = previous.movies.map((m) => ({ ...m, _type: "movie" as const }));
        const shows = previous.shows.map((s) => ({ ...s, _type: "tv" as const }));
        const combined = [...movies, ...shows].sort(
          (a, b) => (a.sort_key ?? 0) - (b.sort_key ?? 0),
        );

        const movedIdx = combined.findIndex(
          (i) => i._type === contentType && i.id === contentId,
        );
        if (movedIdx !== -1) {
          const [moved] = combined.splice(movedIdx, 1);
          // afterId = item that will be below; beforeId fallback for move-to-bottom
          const afterIdx =
            afterId !== null
              ? combined.findIndex((i) => i.watchlist_id === afterId)
              : beforeId !== null
                ? combined.findIndex((i) => i.watchlist_id === beforeId) + 1
                : combined.length;
          combined.splice(afterIdx === -1 ? combined.length : afterIdx, 0, moved);
        }

        // Re-assign temporary sort_keys for optimistic display
        const reordered = combined.map((item, idx) => ({ ...item, sort_key: (idx + 1) * 1000 }));
        queryClient.setQueryData(key, {
          movies: reordered.filter((i) => i._type === "movie").map(({ _type, ...m }) => m),
          shows: reordered.filter((i) => i._type === "tv").map(({ _type, ...s }) => s),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(queryKeys.watchlist(user.uid), context.previous);
    },
    onSuccess: (data) => {
      if (!user) return;
      queryClient.setQueryData(queryKeys.watchlist(user.uid), data);
    },
  });
}
