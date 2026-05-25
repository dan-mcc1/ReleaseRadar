import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch, checkedFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";
import type { AggregateRating, ExternalScores } from "../../types/media";

interface Review {
  id: number;
  user_id: string;
  username: string;
  review_text: string;
  is_spoiler: boolean;
  rating: number | null;
  created_at: string;
  updated_at: string;
  like_count: number;
  user_has_liked: boolean;
}

export function useReviews(contentType: string, contentId: number, sort: "newest" | "top" = "newest") {
  return useQuery({
    queryKey: [...queryKeys.reviews(contentType, contentId), sort],
    queryFn: ({ signal }) =>
      queryFetch<Review[]>(
        `/reviews?content_type=${contentType}&content_id=${contentId}&sort=${sort}`,
        { signal },
      ),
  });
}

export function useAggregateRating(contentType: string, id: string) {
  return useQuery({
    queryKey: queryKeys.aggregateRating(contentType, id),
    queryFn: ({ signal }) =>
      queryFetch<AggregateRating>(
        `/reviews/aggregate?content_type=${contentType}&content_id=${id}`,
        { signal },
      ),
    enabled: !!id,
  });
}

export function useExternalScores(imdbId: string | undefined) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.externalScores(imdbId ?? ""),
    queryFn: ({ signal }) =>
      queryFetch<ExternalScores>(
        `/reviews/external-scores?imdb_id=${encodeURIComponent(imdbId!)}`,
        { signal },
      ),
    enabled: !!imdbId && !!user,
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      reviewText,
      isSpoiler,
    }: {
      contentType: string;
      contentId: number;
      reviewText: string;
      isSpoiler?: boolean;
    }) => {
      const res = await apiFetch("/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          review_text: reviewText,
          is_spoiler: !!isSpoiler,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to submit review");
      }
      return res.json() as Promise<Review>;
    },
    onSuccess: (_, { contentType, contentId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.reviews(contentType, contentId),
      });
    },
  });
}

export function useDeleteReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
    }: {
      contentType: string;
      contentId: number;
    }) => {
      await checkedFetch("/reviews", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
        }),
      });
    },
    onSuccess: (_, { contentType, contentId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.reviews(contentType, contentId),
      });
    },
  });
}

export function useLikeReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      reviewId: number;
      contentType: string;
      contentId: number;
    }) => {
      const res = await apiFetch(`/reviews/${vars.reviewId}/like`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to toggle like");
      }
      return res.json() as Promise<{ liked: boolean; like_count: number }>;
    },
    onMutate: async ({ reviewId, contentType, contentId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reviews(contentType, contentId) });
      const previousData = queryClient.getQueriesData<Review[]>({
        queryKey: queryKeys.reviews(contentType, contentId),
      });
      queryClient.setQueriesData<Review[]>(
        { queryKey: queryKeys.reviews(contentType, contentId) },
        (old) =>
          old?.map((r) =>
            r.id === reviewId
              ? {
                  ...r,
                  user_has_liked: !r.user_has_liked,
                  like_count: r.user_has_liked ? r.like_count - 1 : r.like_count + 1,
                }
              : r
          ),
      );
      return { previousData };
    },
    onError: (_err, { contentType, contentId }, context) => {
      context?.previousData.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews(contentType, contentId) });
    },
    onSettled: (_data, _err, { contentType, contentId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews(contentType, contentId) });
    },
  });
}
