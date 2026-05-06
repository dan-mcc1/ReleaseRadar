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
    queryFn: () =>
      queryFetch<SearchResults>(`/search?query=${encodeURIComponent(query)}`),
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
    queryFn: () =>
      queryFetch<TrendingResults>(`/search/${type}/trending?page=${page}`),
  });
}

export function useTrendingMulti() {
  return useQuery({
    queryKey: queryKeys.trendingMulti(),
    queryFn: () =>
      queryFetch<{ movies: Movie[]; shows: Show[] }>("/search/multi/trending"),
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
    queryFn: () =>
      queryFetch<UpcomingResults>(
        `/search/${type}/upcoming?min_date=${minDate}&max_date=${maxDate}&page=${page}`,
      ),
  });
}

export function useComingSoon(minDate: string, maxDate: string) {
  return useQuery({
    queryKey: queryKeys.comingSoon(),
    queryFn: async () => {
      const data = await queryFetch<{ results: Movie[] }>(
        `/search/movie/upcoming?${new URLSearchParams({ min_date: minDate, max_date: maxDate })}`,
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

export function useGenres() {
  return useQuery({
    queryKey: queryKeys.genres(),
    queryFn: () => queryFetch<GenreList>("/search/genres"),
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
    queryFn: () =>
      queryFetch<{ movies: Movie[]; shows: Show[]; total_pages: number }>(
        `/search?genre_id=${genreId}&type=${type}&page=${page}`,
      ),
    enabled,
  });
}
