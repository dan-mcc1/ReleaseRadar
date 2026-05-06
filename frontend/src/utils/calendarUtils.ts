// frontend/src/utils/calendarUtils.ts
import type { CalendarData, Show, Movie, Episode } from "../types/calendar";
import { toLocalISODate, parseLocalDate } from "./date";

export type CalendarItem =
  | (Episode & { type: "tv"; showData: Show })
  | {
      id: number;
      title: string;
      poster_path: string | null;
      overview: string;
      release_date: string;
      bg_color?: string;
      showData: Movie;
      type: "movie";
      runtime: number;
      is_watched: boolean;
    };

export function buildAllItems(calendarData: CalendarData): CalendarItem[] {
  return [
    ...calendarData.shows.flatMap((show) =>
      (show.episodes ?? []).map((ep) => ({
        ...ep,
        showData: show.show,
        type: "tv" as const,
      })),
    ),
    ...calendarData.movies.map((movie) => ({
      id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      overview: movie.overview,
      release_date: movie.release_date,
      bg_color: movie.bg_color,
      showData: movie,
      type: "movie" as const,
      air_date: movie.release_date,
      runtime: movie.runtime,
      is_watched: movie.is_watched,
    })),
  ];
}

export function getItemsForDate(
  allItems: CalendarItem[],
  date: Date,
): CalendarItem[] {
  const isoDate = toLocalISODate(date);
  return allItems.filter(
    (item) =>
      (item.type === "tv" && item.air_date === isoDate) ||
      (item.type === "movie" && item.release_date === isoDate),
  );
}

export function applyFilters(
  items: CalendarItem[],
  filterType: "all" | "tv" | "movie",
  watchFilter: "all" | "watched" | "unwatched",
): CalendarItem[] {
  let filtered =
    filterType === "all" ? items : items.filter((i) => i.type === filterType);
  if (watchFilter === "watched") filtered = filtered.filter((i) => i.is_watched);
  if (watchFilter === "unwatched") filtered = filtered.filter((i) => !i.is_watched);
  return filtered;
}

export interface DayItem {
  date: Date;
  items?: CalendarItem[];
}

export function getDaysInMonth(
  month: number,
  year: number,
  allItems: CalendarItem[],
  filterType: "all" | "tv" | "movie",
  watchFilter: "all" | "watched" | "unwatched",
): DayItem[] {
  const date = new Date(year, month, 1);
  const days: DayItem[] = [];
  while (date.getMonth() === month) {
    const raw = getItemsForDate(allItems, date);
    days.push({
      date: new Date(date),
      items: applyFilters(raw, filterType, watchFilter),
    });
    date.setDate(date.getDate() + 1);
  }
  return days;
}

export function getWeekDays(
  selectedDate: Date,
  allItems: CalendarItem[],
  filterType: "all" | "tv" | "movie",
  watchFilter: "all" | "watched" | "unwatched",
): DayItem[] {
  const start = new Date(selectedDate);
  start.setDate(selectedDate.getDate() - selectedDate.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const raw = getItemsForDate(allItems, d);
    return { date: d, items: applyFilters(raw, filterType, watchFilter) };
  });
}

export function formatAirTimeToLocal(
  time24: string | null | undefined,
  sourceTimeZone: string | null | undefined,
): string | null {
  if (!time24 || !sourceTimeZone) return null;
  const [hour, minute] = time24.split(":").map(Number);
  const now = new Date();
  const sourceDateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: sourceTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const sourceDate = new Date(sourceDateStr);
  sourceDate.setHours(hour, minute, 0, 0);
  return sourceDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function countUpcomingThisMonth(
  allItems: CalendarItem[],
  today: Date,
  currentMonth: number,
  currentYear: number,
): number {
  return allItems.filter((item) => {
    const dateStr = item.type === "tv" ? item.air_date : item.release_date;
    if (!dateStr) return false;
    const d = parseLocalDate(dateStr);
    return (
      d >= today &&
      d.getMonth() === currentMonth &&
      d.getFullYear() === currentYear
    );
  }).length;
}
