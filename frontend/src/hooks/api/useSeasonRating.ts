import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export interface SeasonRating {
  id: number;
  show_id: number;
  season_number: number;
  rating: number;
  rated_at: string;
}

export interface SeasonRatingAggregate {
  average: number | null;
  count: number;
}

interface MutationContext {
  previousRating: SeasonRating | null | undefined;
  previousAggregate: SeasonRatingAggregate | undefined;
}

function applyRatingDelta(
  agg: SeasonRatingAggregate | undefined,
  oldRating: number | null,
  newRating: number | null,
): SeasonRatingAggregate | undefined {
  if (!agg) return agg;
  const oldCount = agg.count;
  const oldAvg = agg.average ?? 0;
  const oldSum = oldAvg * oldCount;
  const sumDelta =
    (newRating ?? 0) - (oldRating ?? 0);
  const countDelta =
    (newRating !== null ? 1 : 0) - (oldRating !== null ? 1 : 0);
  const newCount = oldCount + countDelta;
  const newSum = oldSum + sumDelta;
  return {
    count: newCount,
    average: newCount > 0 ? newSum / newCount : null,
  };
}

export function useMySeasonRating(showId: number, seasonNumber: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.seasonRating(user?.uid ?? "", showId, seasonNumber),
    queryFn: ({ signal }) =>
      queryFetch<SeasonRating | null>(
        `/season-rating?show_id=${showId}&season_number=${seasonNumber}`,
        { signal },
      ),
    enabled: !!user && showId > 0 && seasonNumber > 0,
  });
}

export function useSeasonRatingAggregate(showId: number, seasonNumber: number) {
  return useQuery({
    queryKey: queryKeys.seasonRatingAggregate(showId, seasonNumber),
    queryFn: ({ signal }) =>
      queryFetch<SeasonRatingAggregate>(
        `/season-rating/aggregate?show_id=${showId}&season_number=${seasonNumber}`,
        { signal },
      ),
    enabled: showId > 0 && seasonNumber > 0,
  });
}

export function useUpsertSeasonRating() {
  const queryClient = useQueryClient();
  const user = useAuthUser();
  return useMutation<
    SeasonRating,
    Error,
    { showId: number; seasonNumber: number; rating: number },
    MutationContext
  >({
    mutationFn: async (vars) => {
      const res = await apiFetch("/season-rating", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_id: vars.showId,
          season_number: vars.seasonNumber,
          rating: vars.rating,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to rate season");
      }
      return res.json() as Promise<SeasonRating>;
    },
    onMutate: async ({ showId, seasonNumber, rating }) => {
      const ratingKey = queryKeys.seasonRating(
        user?.uid ?? "",
        showId,
        seasonNumber,
      );
      const aggregateKey = queryKeys.seasonRatingAggregate(showId, seasonNumber);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: ratingKey }),
        queryClient.cancelQueries({ queryKey: aggregateKey }),
      ]);

      const previousRating = queryClient.getQueryData<SeasonRating | null>(
        ratingKey,
      );
      const previousAggregate =
        queryClient.getQueryData<SeasonRatingAggregate>(aggregateKey);

      queryClient.setQueryData<SeasonRating | null>(ratingKey, {
        id: previousRating?.id ?? -1,
        show_id: showId,
        season_number: seasonNumber,
        rating,
        rated_at: previousRating?.rated_at ?? new Date().toISOString(),
      });

      queryClient.setQueryData<SeasonRatingAggregate | undefined>(
        aggregateKey,
        applyRatingDelta(previousAggregate, previousRating?.rating ?? null, rating),
      );

      return { previousRating, previousAggregate };
    },
    onError: (_err, { showId, seasonNumber }, context) => {
      if (!context) return;
      queryClient.setQueryData(
        queryKeys.seasonRating(user?.uid ?? "", showId, seasonNumber),
        context.previousRating,
      );
      queryClient.setQueryData(
        queryKeys.seasonRatingAggregate(showId, seasonNumber),
        context.previousAggregate,
      );
    },
    onSettled: (_data, _err, { showId, seasonNumber }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.seasonRating(user?.uid ?? "", showId, seasonNumber),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.seasonRatingAggregate(showId, seasonNumber),
      });
    },
  });
}

export function useDeleteSeasonRating() {
  const queryClient = useQueryClient();
  const user = useAuthUser();
  return useMutation<
    void,
    Error,
    { showId: number; seasonNumber: number },
    MutationContext
  >({
    mutationFn: async (vars) => {
      const res = await apiFetch("/season-rating", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_id: vars.showId,
          season_number: vars.seasonNumber,
        }),
      });
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to clear rating");
      }
    },
    onMutate: async ({ showId, seasonNumber }) => {
      const ratingKey = queryKeys.seasonRating(
        user?.uid ?? "",
        showId,
        seasonNumber,
      );
      const aggregateKey = queryKeys.seasonRatingAggregate(showId, seasonNumber);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: ratingKey }),
        queryClient.cancelQueries({ queryKey: aggregateKey }),
      ]);

      const previousRating = queryClient.getQueryData<SeasonRating | null>(
        ratingKey,
      );
      const previousAggregate =
        queryClient.getQueryData<SeasonRatingAggregate>(aggregateKey);

      queryClient.setQueryData<SeasonRating | null>(ratingKey, null);
      queryClient.setQueryData<SeasonRatingAggregate | undefined>(
        aggregateKey,
        applyRatingDelta(previousAggregate, previousRating?.rating ?? null, null),
      );

      return { previousRating, previousAggregate };
    },
    onError: (_err, { showId, seasonNumber }, context) => {
      if (!context) return;
      queryClient.setQueryData(
        queryKeys.seasonRating(user?.uid ?? "", showId, seasonNumber),
        context.previousRating,
      );
      queryClient.setQueryData(
        queryKeys.seasonRatingAggregate(showId, seasonNumber),
        context.previousAggregate,
      );
    },
    onSettled: (_data, _err, { showId, seasonNumber }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.seasonRating(user?.uid ?? "", showId, seasonNumber),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.seasonRatingAggregate(showId, seasonNumber),
      });
    },
  });
}
