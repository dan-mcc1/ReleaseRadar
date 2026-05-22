import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch, checkedFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";
import type { Movie, Show } from "../../types/calendar";

interface ForYouData {
  movies: Movie[];
  shows: Show[];
  seed_count: number;
}

export function useForYou(mode: string) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.forYou(user?.uid ?? "", mode),
    queryFn: ({ signal }) =>
      queryFetch<ForYouData>(`/recommendations/for-you?mode=${mode}`, { signal }),
    enabled: !!user,
  });
}

export function useForYouPreview() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.forYou(user?.uid ?? "", "default"),
    queryFn: ({ signal }) =>
      queryFetch<{ movies: Movie[]; shows: Show[] }>("/recommendations/for-you", { signal }),
    enabled: !!user,
  });
}

export function useRecommendationsInbox() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.recommendationsInbox(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch("/recommendations/inbox", { signal }),
    enabled: !!user,
  });
}

export function useUnreadRecCount() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.unreadRecCount(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch<{ count: number }>("/recommendations/unread-count", { signal }),
    enabled: !!user,
  });
}

export function useSendRecommendation() {
  return useMutation({
    mutationFn: (payload: {
      recipient_username: string;
      content_type: string;
      content_id: number;
      content_title: string;
      content_poster_path: string;
      message: string;
    }) =>
      checkedFetch("/recommendations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
  });
}

export function useMarkRecRead() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recommendationId: number) =>
      checkedFetch(`/recommendations/${recommendationId}/read`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.recommendationsInbox(user.uid),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.unreadRecCount(user.uid),
      });
    },
  });
}

export function useDeleteRecommendation() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recommendationId: number) =>
      checkedFetch(`/recommendations/${recommendationId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.recommendationsInbox(user.uid),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.unreadRecCount(user.uid),
      });
    },
  });
}
