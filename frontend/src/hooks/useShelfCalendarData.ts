import { useAuthUser } from "./useAuthUser";
import { useChunkedCalendar } from "./useChunkedCalendar";

/** A shelf's calendar around (year, month), the month on screen. */
export function useShelfCalendarData(shelfId: number, year: number, month: number) {
  const user = useAuthUser();
  return useChunkedCalendar(
    ["shelves", user?.uid ?? "", shelfId, "calendarData"],
    (from, to) => `/shelf/${shelfId}/calendar?from_date=${from}&to_date=${to}`,
    year,
    month,
    !!user,
  );
}
