import { useQueries, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import type { Movie, Show, Person, CollectionResult } from "../../types/calendar";

interface SearchResults {
  movies: Movie[];
  shows: Show[];
  people: Person[];
  collections: CollectionResult[];
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.search(query),
    queryFn: ({ signal }) =>
      queryFetch<SearchResults>(`/search?query=${encodeURIComponent(query)}`, { signal }),
    enabled: query.length > 0,
  });
}

interface TrendingResults {
  results: (Movie | Show)[];
  total_pages: number;
}

export function useTrending(type: "movie" | "tv", page: number) {
  return useQuery({
    queryKey: queryKeys.trending(type, page),
    queryFn: ({ signal }) =>
      queryFetch<TrendingResults>(`/search/${type}/trending?page=${page}`, { signal }),
  });
}

/** TMDb pages shown per page of Browse: 60 titles, five full rows of 12. */
export const BROWSE_PAGE_SPAN = 3;

/**
 * One page of Browse: TMDb's trending list (no genre) or a genre's most
 * popular titles, BROWSE_PAGE_SPAN TMDb pages at a time. Uses the same cache
 * entries as useTrending / useGenreResults.
 */
export function useBrowsePage(type: "movie" | "tv", genreId: number | null, page: number) {
  const first = (page - 1) * BROWSE_PAGE_SPAN + 1;
  const tmdbPages = Array.from({ length: BROWSE_PAGE_SPAN }, (_, i) => first + i).filter(
    (p) => p <= 500, // TMDb's limit
  );
  return useQueries({
    queries: tmdbPages.map((p) =>
      genreId === null
        ? {
            queryKey: queryKeys.trending(type, p),
            queryFn: ({ signal }: { signal: AbortSignal }) =>
              queryFetch<TrendingResults>(`/search/${type}/trending?page=${p}`, { signal }).then(
                (d) => ({ results: d.results, total_pages: d.total_pages }),
              ),
          }
        : {
            queryKey: queryKeys.genreResults(type, genreId, p),
            queryFn: ({ signal }: { signal: AbortSignal }) =>
              queryFetch<{ movies: Movie[]; shows: Show[]; total_pages: number }>(
                `/search?genre_id=${genreId}&type=${type}&page=${p}`,
                { signal },
              ),
          },
    ),
    combine: (results) => {
      const seen = new Set<number>();
      const items: (Movie | Show)[] = [];
      for (const r of results) {
        const d = r.data as
          | { results?: (Movie | Show)[]; movies?: Movie[]; shows?: Show[] }
          | undefined;
        // A title can move up a page between two requests; show it once.
        for (const item of d?.results ?? [...(d?.movies ?? []), ...(d?.shows ?? [])]) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            items.push(item);
          }
        }
      }
      const tmdbTotal = Math.min(500, results[0]?.data?.total_pages ?? 1);
      return {
        items,
        totalPages: Math.max(1, Math.ceil(tmdbTotal / BROWSE_PAGE_SPAN)),
        // Drawn once all have answered (they run in parallel), so rows don't
        // grow under the pointer. Only the first failing is an error; a
        // later one just means fewer titles.
        isPending: results.some((r) => r.isPending),
        isError: results[0]?.isError ?? false,
        refetch: () => results.forEach((r) => r.refetch()),
      };
    },
  });
}

export function useTrendingMulti() {
  return useQuery({
    queryKey: queryKeys.trendingMulti(),
    queryFn: ({ signal }) =>
      queryFetch<{ movies: Movie[]; shows: Show[] }>("/search/multi/trending", { signal }),
  });
}

interface UpcomingResults {
  results: (Movie | Show)[];
  total_pages: number;
}

export function useUpcoming(
  type: "movie" | "tv",
  page: number,
  minDate: string,
  maxDate: string,
) {
  return useQuery({
    queryKey: queryKeys.upcoming(type, page, minDate, maxDate),
    queryFn: ({ signal }) =>
      queryFetch<UpcomingResults>(
        `/search/${type}/upcoming?min_date=${minDate}&max_date=${maxDate}&page=${page}`,
        { signal },
      ),
  });
}

export function useComingSoon(minDate: string, maxDate: string) {
  return useQuery({
    queryKey: queryKeys.comingSoon(minDate, maxDate),
    queryFn: async ({ signal }) => {
      const data = await queryFetch<{ results: Movie[] }>(
        `/search/movie/upcoming?${new URLSearchParams({ min_date: minDate, max_date: maxDate })}`,
        { signal },
      );
      return data.results;
    },
  });
}

interface GenreItem {
  id: number;
  name: string;
}

interface GenreList {
  movie: GenreItem[];
  tv: GenreItem[];
}

export function useAiringToday() {
  return useQuery({
    queryKey: queryKeys.airingToday(),
    queryFn: ({ signal }) => queryFetch<{ results: Show[]; total_pages: number }>("/search/tv/airing-today", { signal }),
  });
}

export function useNowPlaying() {
  return useQuery({
    queryKey: queryKeys.nowPlaying(),
    queryFn: ({ signal }) => queryFetch<{ results: Movie[]; total_pages: number }>("/search/movie/now-playing", { signal }),
  });
}

export function usePopularMulti() {
  return useQuery({
    queryKey: queryKeys.popularMulti(),
    queryFn: ({ signal }) => queryFetch<{ movies: Movie[]; shows: Show[] }>("/search/multi/popular", { signal }),
  });
}

export function useTopRatedMulti() {
  return useQuery({
    queryKey: queryKeys.topRatedMulti(),
    queryFn: ({ signal }) => queryFetch<{ movies: Movie[]; shows: Show[] }>("/search/multi/top-rated", { signal }),
  });
}

export function useGenres() {
  return useQuery({
    queryKey: queryKeys.genres(),
    queryFn: ({ signal }) => queryFetch<GenreList>("/search/genres", { signal }),
    staleTime: Infinity,
  });
}

export function useGenreResults(
  type: string,
  genreId: number,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.genreResults(type, genreId, page),
    queryFn: ({ signal }) =>
      queryFetch<{ movies: Movie[]; shows: Show[]; total_pages: number }>(
        `/search?genre_id=${genreId}&type=${type}&page=${page}`,
        { signal },
      ),
    enabled,
  });
}
