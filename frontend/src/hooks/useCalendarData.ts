// frontend/src/hooks/useCalendarData.ts
import { useAuthUser } from "./useAuthUser";
import { useChunkedCalendar } from "./useChunkedCalendar";

// Prefix key used by invalidation callers. React Query prefix-matches, so this
// invalidates every loaded chunk of the calendar cache.
export function calendarQueryKey(uid: string) {
  return ["calendar", uid] as const;
}

// Every item carries is_watched, so the watched/unwatched filter is applied
// in the browser and one cache serves all filters.
function calendarUrl(from: string, to: string): string {
  const params = new URLSearchParams({ from_date: from, to_date: to });
  return `/calendar?${params.toString()}`;
}

/** The signed-in user's calendar around (year, month), the month on screen. */
export function useCalendarData(year: number, month: number) {
  const user = useAuthUser();
  return useChunkedCalendar(
    calendarQueryKey(user?.uid ?? ""),
    calendarUrl,
    year,
    month,
    !!user,
    true, // saved to IndexedDB
  );
}
