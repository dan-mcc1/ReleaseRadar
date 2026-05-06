// frontend/src/hooks/useCalendarData.ts
import { useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShowWithCalendar, Movie } from "../types/calendar";
import { useAuthUser } from "./useAuthUser";
import { apiFetch } from "../utils/apiFetch";

const CHUNK_MONTHS = 6;
const PREFETCH_THRESHOLD = CHUNK_MONTHS;

interface CalendarResponse {
  shows: ShowWithCalendar[];
  movies: Movie[];
}

function mkMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthBounds(
  year: number,
  month: number,
): { from: string; to: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: fmt(new Date(year, month, 1)),
    to: fmt(new Date(year, month + 1, 0)),
  };
}

function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function monthOffset(
  y1: number,
  m1: number,
  y2: number,
  m2: number,
): number {
  return (y2 - y1) * 12 + (m2 - m1);
}

function mergeShows(
  existing: ShowWithCalendar[],
  incoming: ShowWithCalendar[],
): ShowWithCalendar[] {
  const showMap = new Map<number, ShowWithCalendar>();
  for (const item of existing) showMap.set(item.show.id, item);
  for (const item of incoming) {
    if (showMap.has(item.show.id)) {
      const prev = showMap.get(item.show.id)!;
      const epIds = new Set(prev.episodes.map((e) => e.id));
      const newEps = item.episodes.filter((e) => !epIds.has(e.id));
      showMap.set(item.show.id, {
        ...prev,
        episodes: [...prev.episodes, ...newEps],
      });
    } else {
      showMap.set(item.show.id, item);
    }
  }
  return Array.from(showMap.values());
}

function mergeMovies(existing: Movie[], incoming: Movie[]): Movie[] {
  const map = new Map<number, Movie>();
  for (const m of existing) map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values());
}

export function calendarQueryKey(uid: string) {
  return ["calendar", uid] as const;
}

// Compute the initial load range (deterministic, based on today)
function initialLoadRange() {
  const today = new Date();
  const yr = today.getFullYear();
  const mo = today.getMonth();
  const start = addMonths(yr, mo, -Math.floor(CHUNK_MONTHS * 1.5));
  const end = addMonths(yr, mo, Math.ceil(CHUNK_MONTHS * 1.5) - 1);
  return { start, end };
}

export function useCalendarData() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const loadedFrom = useRef<string>("");
  const loadedTo = useRef<string>("");
  const fetchingForward = useRef(false);
  const fetchingBackward = useRef(false);

  // Reset boundary tracking when the user changes (prevents stale ranges across accounts)
  useEffect(() => {
    loadedFrom.current = "";
    loadedTo.current = "";
    fetchingForward.current = false;
    fetchingBackward.current = false;
  }, [user?.uid]);

  const { data, isPending, isPlaceholderData } = useQuery<CalendarResponse>({
    queryKey: calendarQueryKey(user?.uid ?? ""),
    queryFn: async () => {
      const { start, end } = initialLoadRange();
      const from = monthBounds(start.year, start.month).from;
      const to = monthBounds(end.year, end.month).to;

      const res = await apiFetch(`/calendar?from_date=${from}&to_date=${to}`);
      if (!res.ok) throw new Error("Failed to fetch calendar data");
      return res.json() as Promise<CalendarResponse>;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: { shows: [], movies: [] },
  });

  // Set boundary refs whenever data resolves — covers both network fetch and cache-hit
  useEffect(() => {
    if (!data || isPending || isPlaceholderData) return;
    if (loadedFrom.current) return; // already set by a fetchChunk call
    const { start, end } = initialLoadRange();
    loadedFrom.current = mkMonthKey(start.year, start.month);
    loadedTo.current = mkMonthKey(end.year, end.month);
  }, [data, isPending]);

  async function fetchChunk(
    fromYear: number,
    fromMonth: number,
    size: number,
    direction: "forward" | "backward",
  ): Promise<void> {
    if (!user) return;
    if (direction === "forward" && fetchingForward.current) return;
    if (direction === "backward" && fetchingBackward.current) return;

    if (direction === "forward") fetchingForward.current = true;
    else fetchingBackward.current = true;

    try {
      const toEnd = addMonths(fromYear, fromMonth, size - 1);
      const from = monthBounds(fromYear, fromMonth).from;
      const to = monthBounds(toEnd.year, toEnd.month).to;

      const res = await apiFetch(`/calendar?from_date=${from}&to_date=${to}`);
      if (!res.ok) return;
      const chunk: CalendarResponse = await res.json();

      queryClient.setQueryData<CalendarResponse>(
        calendarQueryKey(user.uid),
        (prev) => ({
          shows: mergeShows(prev?.shows ?? [], chunk.shows),
          movies: mergeMovies(prev?.movies ?? [], chunk.movies),
        }),
      );

      const fromKey = mkMonthKey(fromYear, fromMonth);
      const toKey = mkMonthKey(toEnd.year, toEnd.month);
      if (!loadedFrom.current || fromKey < loadedFrom.current)
        loadedFrom.current = fromKey;
      if (!loadedTo.current || toKey > loadedTo.current)
        loadedTo.current = toKey;
    } finally {
      if (direction === "forward") fetchingForward.current = false;
      else fetchingBackward.current = false;
    }
  }

  function maybePrefetch(year: number, month: number) {
    if (!loadedFrom.current || !loadedTo.current) return;

    const [toYear, toMonth0] = loadedTo.current.split("-").map(Number);
    const toMonth = toMonth0 - 1;
    const distToEnd = monthOffset(year, month, toYear, toMonth);
    if (distToEnd <= PREFETCH_THRESHOLD && !fetchingForward.current) {
      const next = addMonths(toYear, toMonth, 1);
      fetchChunk(next.year, next.month, CHUNK_MONTHS, "forward");
    }

    const [fromYear, fromMonth0] = loadedFrom.current.split("-").map(Number);
    const fromMonth = fromMonth0 - 1;
    const distToStart = monthOffset(fromYear, fromMonth, year, month);
    if (distToStart <= PREFETCH_THRESHOLD && !fetchingBackward.current) {
      const prev = addMonths(fromYear, fromMonth, -CHUNK_MONTHS);
      fetchChunk(prev.year, prev.month, CHUNK_MONTHS, "backward");
    }
  }

  return {
    shows: data?.shows ?? [],
    movies: data?.movies ?? [],
    isLoading: isPending || isPlaceholderData,
    maybePrefetch,
  };
}
