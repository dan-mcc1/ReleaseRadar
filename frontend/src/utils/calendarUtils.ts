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

// Collapse multiple same-show episodes into one group so a binge drop doesn't
// dominate the side rail or a calendar day cell. Movies and one-off TV items
// stay as singletons; order of first appearance is preserved.
export type ItemGroup =
  | { kind: "single"; item: CalendarItem }
  | { kind: "show-group"; showId: number; items: CalendarItem[] };

export function groupItemsByShow(items: CalendarItem[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  const tvIndex = new Map<number, number>();
  for (const item of items) {
    if (item.type === "tv") {
      const showId = item.showData.id;
      const at = tvIndex.get(showId);
      if (at !== undefined) {
        const g = groups[at];
        if (g.kind === "show-group") g.items.push(item);
      } else {
        tvIndex.set(showId, groups.length);
        groups.push({ kind: "show-group", showId, items: [item] });
      }
    } else {
      groups.push({ kind: "single", item });
    }
  }
  return groups;
}

// Items keyed by "YYYY-MM-DD" (episode air date / movie release date), built
// once per data change so each calendar day is a lookup instead of a scan.
export type ItemsByDate = Map<string, CalendarItem[]>;

export function indexItemsByDate(allItems: CalendarItem[]): ItemsByDate {
  const byDate: ItemsByDate = new Map();
  for (const item of allItems) {
    const date = item.type === "tv" ? item.air_date : item.release_date;
    if (!date) continue;
    const list = byDate.get(date);
    if (list) list.push(item);
    else byDate.set(date, [item]);
  }
  return byDate;
}

export function getItemsForDate(
  byDate: ItemsByDate,
  date: Date,
): CalendarItem[] {
  return byDate.get(toLocalISODate(date)) ?? [];
}

export interface CurrentlyWatchingIds {
  showIds: Set<number>;
  movieIds: Set<number>;
}

export function applyFilters(
  items: CalendarItem[],
  filterType: "all" | "tv" | "movie",
  watchFilter: "all" | "watched" | "unwatched",
  currentlyWatching?: CurrentlyWatchingIds,
): CalendarItem[] {
  let filtered =
    filterType === "all" ? items : items.filter((i) => i.type === filterType);
  if (watchFilter === "watched") filtered = filtered.filter((i) => i.is_watched);
  if (watchFilter === "unwatched") filtered = filtered.filter((i) => !i.is_watched);
  if (currentlyWatching) {
    filtered = filtered.filter((i) =>
      i.type === "tv"
        ? currentlyWatching.showIds.has(i.showData.id)
        : currentlyWatching.movieIds.has((i.showData as Movie).id),
    );
  }
  return filtered;
}

export interface DayItem {
  date: Date;
  items?: CalendarItem[];
}

export function getDaysInMonth(
  month: number,
  year: number,
  byDate: ItemsByDate,
  filterType: "all" | "tv" | "movie",
  watchFilter: "all" | "watched" | "unwatched",
  currentlyWatching?: CurrentlyWatchingIds,
): DayItem[] {
  const date = new Date(year, month, 1);
  const days: DayItem[] = [];
  while (date.getMonth() === month) {
    const raw = getItemsForDate(byDate, date);
    days.push({
      date: new Date(date),
      items: applyFilters(raw, filterType, watchFilter, currentlyWatching),
    });
    date.setDate(date.getDate() + 1);
  }
  return days;
}

export function getWeekDays(
  selectedDate: Date,
  byDate: ItemsByDate,
  filterType: "all" | "tv" | "movie",
  watchFilter: "all" | "watched" | "unwatched",
  currentlyWatching?: CurrentlyWatchingIds,
): DayItem[] {
  const start = new Date(selectedDate);
  start.setDate(selectedDate.getDate() - selectedDate.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const raw = getItemsForDate(byDate, d);
    return { date: d, items: applyFilters(raw, filterType, watchFilter, currentlyWatching) };
  });
}

// Shows store the network's wall-clock air time ("21:00") and its IANA zone.
// TVmaze leaves the zone blank for some web channels; assume Eastern, as the
// backend's push alerts and iCal feed do (app/services/air_time.py).
export const DEFAULT_AIR_TIMEZONE = "America/New_York";

// Intl.DateTimeFormat is expensive to construct; keep one per zone.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = zoneFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    zoneFormatters.set(timeZone, fmt);
  }
  return fmt;
}

// How far timeZone's wall clock is ahead of UTC at instant, in ms.
function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts: Record<string, number> = {};
  for (const p of zoneFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

function knownZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_AIR_TIMEZONE;
  try {
    zoneFormatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_AIR_TIMEZONE; // RangeError: not a zone this browser knows
  }
}

/**
 * The instant an episode airs: airDate ("YYYY-MM-DD") at time24 ("HH:MM")
 * on sourceTimeZone's clock. Null without a usable time or date.
 */
export function airInstant(
  airDate: string | null | undefined,
  time24: string | null | undefined,
  sourceTimeZone: string | null | undefined,
): Date | null {
  if (!airDate || !time24) return null;
  const [year, month, day] = airDate.split("-").map(Number);
  const [hour, minute = 0] = time24.split(":").map(Number);
  if ([year, month, day, hour, minute].some(Number.isNaN)) return null;
  const zone = knownZone(sourceTimeZone);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at the wall time is a guess; recheck it at the instant
  // that guess gives, which differs only across a DST change.
  const guess = wall - zoneOffsetMs(zone, wall);
  return new Date(wall - zoneOffsetMs(zone, guess));
}

const localTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const localWeekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
});

/**
 * The air time on the viewer's clock, e.g. "6:00 PM". When that lands on a
 * different local day than airDate (a 9 PM Eastern show seen from Tokyo), the
 * local weekday is added: "10:00 AM Fri". Without airDate, today is used.
 */
export function formatAirTimeToLocal(
  time24: string | null | undefined,
  sourceTimeZone: string | null | undefined,
  airDate?: string | null,
): string | null {
  const date = airDate || toLocalISODate(new Date());
  const instant = airInstant(date, time24, sourceTimeZone);
  if (!instant) return null;
  const time = localTimeFormatter.format(instant);
  return toLocalISODate(instant) === date
    ? time
    : `${time} ${localWeekdayFormatter.format(instant)}`;
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
