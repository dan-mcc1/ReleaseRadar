// frontend/src/hooks/useChunkedCalendar.ts
import { useState } from "react";
import {
  useQueries,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ShowWithCalendar, Movie } from "../types/calendar";
import { apiFetch } from "../utils/apiFetch";
import { toLocalISODate } from "../utils/date";
import { calendarPersister, savePersistedQuery } from "../queryPersistence";

// Calendar data loads in 6-month chunks, each its own query. Invalidating the
// calendar refetches every loaded chunk at its own range, so months the user
// scrolled to don't empty out after a refetch.
const CHUNK_MONTHS = 6;
// Months behind and ahead of the one on screen that should already be loaded.
// Together they span less than a chunk, so at most two chunks are wanted.
const LOAD_BEHIND = 3;
const LOAD_AHEAD = 2;
// Marks a chunk's query key; setCalendarItemWatched finds chunks by it.
const CHUNK_KEY = "calendarChunk";

export interface CalendarResponse {
  shows: ShowWithCalendar[];
  movies: Movie[];
}

const EMPTY: CalendarResponse = { shows: [], movies: [] };

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

function chunkRange(base: number, chunk: number): { from: string; to: string } {
  const first = base + chunk * CHUNK_MONTHS;
  const last = first + CHUNK_MONTHS - 1;
  return {
    // Local dates: toISOString() is UTC, which east of UTC turns local
    // midnight on the 1st into the previous day.
    from: toLocalISODate(new Date(Math.floor(first / 12), first % 12, 1)),
    to: toLocalISODate(new Date(Math.floor(last / 12), (last % 12) + 1, 0)),
  };
}

// Chunks cover disjoint date ranges, so a show's episodes in two chunks are
// different episodes and a movie appears in one chunk only.
function mergeChunks(chunks: (CalendarResponse | undefined)[]): CalendarResponse {
  const loaded = chunks.filter((c): c is CalendarResponse => !!c);
  if (loaded.length === 0) return EMPTY;
  if (loaded.length === 1) return loaded[0];
  const shows = new Map<number, ShowWithCalendar>();
  const movies = new Map<number, Movie>();
  for (const chunk of loaded) {
    for (const item of chunk.shows) {
      const prev = shows.get(item.show.id);
      shows.set(
        item.show.id,
        prev ? { ...prev, episodes: [...prev.episodes, ...item.episodes] } : item,
      );
    }
    for (const m of chunk.movies) movies.set(m.id, m);
  }
  return { shows: [...shows.values()], movies: [...movies.values()] };
}

function combineChunks(results: UseQueryResult<CalendarResponse>[]) {
  return {
    data: mergeChunks(results.map((r) => r.data)),
    pending: results.map((r) => r.isPending),
  };
}

/**
 * Calendar data around (year, month), the month on screen. keyPrefix scopes
 * the cache (["calendar", uid], a shelf's key); url builds the request for a
 * date range. Chunks stay loaded once fetched, so today's items and months
 * already visited remain available while the user navigates.
 */
export function useChunkedCalendar(
  keyPrefix: readonly unknown[],
  url: (from: string, to: string) => string,
  year: number,
  month: number,
  enabled: boolean,
  persist = false,
) {
  // Chunks are aligned to the month the calendar opened on, so the first
  // request covers LOAD_BEHIND months back to LOAD_AHEAD months ahead.
  const [base] = useState(() => {
    const today = new Date();
    return monthIndex(today.getFullYear(), today.getMonth()) - LOAD_BEHIND;
  });
  const chunkOf = (idx: number) => Math.floor((idx - base) / CHUNK_MONTHS);
  const viewed = monthIndex(year, month);
  const wanted = [chunkOf(viewed - LOAD_BEHIND), chunkOf(viewed + LOAD_AHEAD)];

  // Loaded chunks, reset when the cache scope (user, shelf) changes. Updated
  // during render, React's pattern for state derived from props.
  const scope = JSON.stringify(keyPrefix);
  const [loaded, setLoaded] = useState<{ scope: string; chunks: number[] }>({
    scope: "",
    chunks: [],
  });
  let chunks = loaded.scope === scope ? loaded.chunks : [];
  const missing = wanted.filter((c, i) => !chunks.includes(c) && wanted.indexOf(c) === i);
  if (missing.length > 0) {
    chunks = [...chunks, ...missing].sort((a, b) => a - b);
    setLoaded({ scope, chunks });
  }

  const { data, pending } = useQueries({
    queries: chunks.map((chunk) => {
      const { from, to } = chunkRange(base, chunk);
      return {
        queryKey: [...keyPrefix, CHUNK_KEY, from],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const res = await apiFetch(url(from, to), { signal });
          if (!res.ok) throw new Error("Failed to fetch calendar data");
          return res.json() as Promise<CalendarResponse>;
        },
        enabled,
        staleTime: 5 * 60 * 1000,
        // Restores the chunk from IndexedDB on its first fetch and saves it
        // after each one.
        persister: persist ? calendarPersister : undefined,
      };
    }),
    combine: combineChunks, // module-level, so stable: results are memoized
  });

  return {
    shows: data.shows,
    movies: data.movies,
    isLoading: pending[chunks.indexOf(chunkOf(viewed))] ?? true,
  };
}

export type WatchTarget =
  | { type: "tv"; showId: number; seasonNumber: number; episodeNumber: number }
  | { type: "movie"; movieId: number };

function withWatched(
  data: CalendarResponse | undefined,
  target: WatchTarget,
  watched: boolean,
): CalendarResponse | undefined {
  if (!data) return data;
  if (target.type === "movie") {
    if (!data.movies.some((m) => m.id === target.movieId)) return data;
    return {
      ...data,
      movies: data.movies.map((m) =>
        m.id === target.movieId ? { ...m, is_watched: watched } : m,
      ),
    };
  }
  const isTarget = (e: ShowWithCalendar["episodes"][number]) =>
    e.season_number === target.seasonNumber &&
    e.episode_number === target.episodeNumber;
  const show = data.shows.find((s) => s.show.id === target.showId);
  if (!show || !show.episodes.some(isTarget)) return data;
  return {
    ...data,
    shows: data.shows.map((s) =>
      s === show
        ? {
            ...s,
            episodes: s.episodes.map((e) =>
              isTarget(e) ? { ...e, is_watched: watched } : e,
            ),
          }
        : s,
    ),
  };
}

/**
 * Mark one episode or movie watched/unwatched in every cached calendar chunk
 * (the main calendar and shelf calendars) instead of refetching them.
 */
export function setCalendarItemWatched(
  queryClient: QueryClient,
  uid: string,
  target: WatchTarget,
  watched: boolean,
) {
  const chunks = queryClient.getQueriesData<CalendarResponse>({
    predicate: (q) => q.queryKey[1] === uid && q.queryKey.includes(CHUNK_KEY),
  });
  // Only the chunks holding the item change, and only those are re-saved.
  for (const [queryKey, data] of chunks) {
    const next = withWatched(data, target, watched);
    if (next === data) continue;
    queryClient.setQueryData(queryKey, next);
    savePersistedQuery(queryClient, queryKey);
  }
}
