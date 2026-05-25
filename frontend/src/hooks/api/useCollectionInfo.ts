import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";
import type { Collection } from "../../types/calendar";

export interface CollectionWatchStatus {
  total_parts: number;
  released_parts: number;
  watched_parts: number;
  finished: boolean;
}

export function useBulkCollectionStatus(collectionIds: number[]) {
  const user = useAuthUser();
  const uid = user?.uid;
  const key = [...collectionIds].sort((a, b) => a - b).join(",");
  return useQuery({
    queryKey: ["collections", "status", "bulk", uid ?? "", key],
    queryFn: ({ signal }) =>
      queryFetch<Record<string, CollectionWatchStatus>>(
        "/collections/status/bulk",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collection_ids: collectionIds }),
          signal,
        },
      ),
    enabled: !!uid && collectionIds.length > 0,
    staleTime: 30_000,
  });
}

export function useCollectionInfo(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.collection(id ?? ""),
    queryFn: ({ signal }) => queryFetch<Collection>(`/collections/${id}`, { signal }),
    enabled: !!id,
  });
}

export type CollectionSummary = {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  size?: number;
  avg_rating?: number | null;
  popularity?: number | null;
  min_year?: number | null;
  max_year?: number | null;
};

export type CollectionBrowsePage = {
  page: number;
  page_size: number;
  total: number;
  results: CollectionSummary[];
};

export type BrowseSort =
  | "name"
  | "size"
  | "rating"
  | "popularity"
  | "earliest"
  | "latest";

export type BrowseFilters = {
  min_size?: number;
  max_size?: number;
  min_rating?: number;
  year_from?: number;
  year_to?: number;
  genre_id?: number;
  sort?: BrowseSort;
  direction?: "asc" | "desc";
};

export const NATURAL_SORT_DIRECTION: Record<BrowseSort, "asc" | "desc"> = {
  name: "asc",
  size: "desc",
  rating: "desc",
  popularity: "desc",
  earliest: "asc",
  latest: "desc",
};

function buildBrowseQS(page: number, pageSize: number, filters: BrowseFilters): string {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("page_size", String(pageSize));
  if (filters.sort) p.set("sort", filters.sort);
  if (filters.direction) p.set("direction", filters.direction);
  if (filters.min_size != null) p.set("min_size", String(filters.min_size));
  if (filters.max_size != null) p.set("max_size", String(filters.max_size));
  if (filters.min_rating != null) p.set("min_rating", String(filters.min_rating));
  if (filters.year_from != null) p.set("year_from", String(filters.year_from));
  if (filters.year_to != null) p.set("year_to", String(filters.year_to));
  if (filters.genre_id != null) p.set("genre_id", String(filters.genre_id));
  return p.toString();
}

export function useCollectionsBrowse(
  page: number,
  pageSize: number = 30,
  filters: BrowseFilters = {},
) {
  const qs = buildBrowseQS(page, pageSize, filters);
  return useQuery({
    queryKey: queryKeys.collectionsBrowse(page, pageSize, qs),
    queryFn: ({ signal }) =>
      queryFetch<CollectionBrowsePage>(`/collections/browse?${qs}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useCollectionsSearch(query: string, limit: number = 25) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.collectionsSearch(trimmed, limit),
    queryFn: ({ signal }) =>
      queryFetch<{ results: CollectionSummary[] }>(
        `/collections/search?query=${encodeURIComponent(trimmed)}&limit=${limit}`,
        { signal },
      ),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
  });
}

export type CollectionGenre = {
  id: number;
  name: string;
  collection_count: number;
};

export function useCollectionGenres() {
  return useQuery({
    queryKey: queryKeys.collectionGenres(),
    queryFn: ({ signal }) =>
      queryFetch<{ genres: CollectionGenre[] }>(`/collections/genres`, { signal }),
    staleTime: 1000 * 60 * 10,
  });
}

export type CollectionStats = {
  collection_id: number;
  count: number;
  avg_rating: number | null;
  highest_rating: number | null;
  lowest_rating: number | null;
  avg_runtime: number | null;
  total_runtime: number | null;
  avg_budget: number | null;
  total_budget: number | null;
  avg_revenue: number | null;
  total_revenue: number | null;
  min_year: number | null;
  max_year: number | null;
  genres: { id: number; name: string; count: number }[];
};

export function useCollectionStats(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.collectionStats(id ?? ""),
    queryFn: ({ signal }) =>
      queryFetch<CollectionStats>(`/collections/${id}/stats`, { signal }),
    enabled: !!id,
  });
}

export type MyCollectionCard = CollectionSummary & {
  released_parts?: number;
  watched_parts?: number;
};

export type MyCollectionsResponse = {
  favorites: CollectionSummary[];
  finished: MyCollectionCard[];
  in_progress: MyCollectionCard[];
};

export type CollectionRanking = { movie_id: number; rank: number };

export function useCollectionRanking(id: string | undefined) {
  const user = useAuthUser();
  const uid = user?.uid;
  return useQuery({
    queryKey: queryKeys.collectionRanking(uid ?? "", id ?? ""),
    queryFn: ({ signal }) =>
      queryFetch<{ ranking: CollectionRanking[] }>(
        `/collections/${id}/ranking`,
        { signal },
      ),
    enabled: !!uid && !!id,
  });
}

export function useSetCollectionRanking(id: string | undefined) {
  const user = useAuthUser();
  const uid = user?.uid;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedMovieIds: number[]) =>
      queryFetch<{ ranking: CollectionRanking[] }>(
        `/collections/${id}/ranking`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ordered_movie_ids: orderedMovieIds }),
        },
      ),
    onMutate: async (orderedMovieIds) => {
      if (!uid || !id) return;
      const key = queryKeys.collectionRanking(uid, id);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ ranking: CollectionRanking[] }>(key);
      qc.setQueryData<{ ranking: CollectionRanking[] }>(key, {
        ranking: orderedMovieIds.map((mid, i) => ({
          movie_id: mid,
          rank: i + 1,
        })),
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (!uid || !id || !ctx?.prev) return;
      qc.setQueryData(queryKeys.collectionRanking(uid, id), ctx.prev);
    },
    onSettled: () => {
      if (!uid || !id) return;
      qc.invalidateQueries({
        queryKey: queryKeys.collectionRanking(uid, id),
      });
    },
  });
}

export function useMyCollections(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.myCollections(),
    queryFn: ({ signal }) =>
      queryFetch<MyCollectionsResponse>(`/collections/mine`, { signal }),
    enabled,
  });
}
