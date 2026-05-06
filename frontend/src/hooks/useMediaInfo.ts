import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./api/queryKeys";
import { queryFetch } from "./api/queryFetch";
import { useWatchStatus } from "./api/useWatchStatus";
import { useAggregateRating, useExternalScores } from "./api/useReviews";
import type { WatchStatus } from "../components/WatchButton";
import type { ExternalScores, AggregateRating } from "../types/media";

interface UseMediaInfoOptions {
  contentType: "movie" | "tv";
  id: string | undefined;
  fetchUrl: string;
}

export interface UseMediaInfoResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  initialStatus: WatchStatus | undefined;
  initialRating: number | null | undefined;
  statusReady: boolean;
  externalScores: ExternalScores | null;
  aggRating: AggregateRating | null;
}

export function useMediaInfo<T extends { id: number; external_ids?: { imdb_id?: string } }>(
  options: UseMediaInfoOptions,
): UseMediaInfoResult<T> {
  const { contentType, id, fetchUrl } = options;

  // Main data fetch
  const mediaQuery = useQuery({
    queryKey: queryKeys.mediaDetail(contentType, id ?? ""),
    queryFn: async () => {
      const rawData = await queryFetch<any>(fetchUrl);
      if (rawData["watch/providers"]?.["results"]?.["US"]) {
        return { ...rawData, providers: rawData["watch/providers"]["results"]["US"] } as T;
      }
      return rawData as T;
    },
    enabled: !!id,
  });

  // Watch status (depends on media data for content ID)
  const statusQuery = useWatchStatus(contentType, mediaQuery.data?.id ?? 0);

  // Aggregate rating
  const aggQuery = useAggregateRating(contentType, id ?? "");

  // External scores (depends on imdb_id from main data)
  const imdbId = mediaQuery.data?.external_ids?.imdb_id;
  const scoresQuery = useExternalScores(imdbId);

  return {
    data: mediaQuery.data,
    loading: mediaQuery.isPending,
    error: mediaQuery.error?.message ?? null,
    initialStatus: statusQuery.data?.status,
    initialRating: statusQuery.data?.rating ?? null,
    statusReady: statusQuery.isFetched || !statusQuery.isLoading,
    externalScores: scoresQuery.data && Object.keys(scoresQuery.data).length > 0
      ? scoresQuery.data
      : null,
    aggRating: aggQuery.data ?? null,
  };
}
