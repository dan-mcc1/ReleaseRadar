import { useQuery } from "@tanstack/react-query";
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
    queryKey: queryKeys.upcoming(type, page),
    queryFn: ({ signal }) =>
      queryFetch<UpcomingResults>(
        `/search/${type}/upcoming?min_date=${minDate}&max_date=${maxDate}&page=${page}`,
        { signal },
      ),
  });
}

export function useComingSoon(minDate: string, maxDate: string) {
  return useQuery({
    queryKey: queryKeys.comingSoon(),
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
