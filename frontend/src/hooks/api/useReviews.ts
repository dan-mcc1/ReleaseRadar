import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";
import type { AggregateRating, ExternalScores } from "../../types/media";

interface Review {
  id: number;
  user_id: string;
  username: string;
  review_text: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

export function useReviews(contentType: string, contentId: number) {
  return useQuery({
    queryKey: queryKeys.reviews(contentType, contentId),
    queryFn: () =>
      queryFetch<Review[]>(
        `/reviews?content_type=${contentType}&content_id=${contentId}`,
      ),
  });
}

export function useAggregateRating(contentType: string, id: string) {
  return useQuery({
    queryKey: queryKeys.aggregateRating(contentType, id),
    queryFn: () =>
      queryFetch<AggregateRating>(
        `/reviews/aggregate?content_type=${contentType}&content_id=${id}`,
      ),
    enabled: !!id,
  });
}

export function useExternalScores(imdbId: string | undefined) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.externalScores(imdbId ?? ""),
    queryFn: () =>
      queryFetch<ExternalScores>(
        `/reviews/external-scores?imdb_id=${encodeURIComponent(imdbId!)}`,
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
    }: {
      contentType: string;
      contentId: number;
      reviewText: string;
    }) => {
      const res = await apiFetch("/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          review_text: reviewText,
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
      await apiFetch("/reviews", {
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
