import { useState, useMemo, useRef } from "react";
import { useShelfCalendarData } from "../../hooks/useShelfCalendarData";
import CalendarControls, { ViewMode } from "./CalendarControls";
import CalendarMonthGrid from "./CalendarMonthGrid";
import CalendarWeekGrid from "./CalendarWeekGrid";
import CalendarDayDetail from "./CalendarDayDetail";
import {
  buildAllItems,
  getItemsForDate,
  applyFilters,
  getDaysInMonth,
  getWeekDays,
} from "../../utils/calendarUtils";
import { useAuthUser } from "../../hooks/useAuthUser";

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  shelfId: number;
}

export default function ShelfCalendarView({ shelfId }: Props) {
  const user = useAuthUser();
  const { shows, movies, isLoading, maybePrefetch } = useShelfCalendarData(shelfId);

  const today = new Date();
  const episodeListRef = useRef<HTMLDivElement>(null);

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "month"
  );
  const [filterType, setFilterType] = useState<"all" | "tv" | "movie">("all");
  const [watchFilter, setWatchFilter] = useState<"all" | "watched" | "unwatched">("all");

  const allItems = useMemo(() => buildAllItems({ shows, movies }), [shows, movies]);

  const daysOfMonth = useMemo(
    () => getDaysInMonth(currentMonth, currentYear, allItems, filterType, watchFilter),
    [currentMonth, currentYear, allItems, filterType, watchFilter]
  );

  const weekDays = useMemo(
    () => getWeekDays(selectedDate, allItems, filterType, watchFilter),
    [selectedDate, allItems, filterType, watchFilter]
  );

  const selectedDateItems = useMemo(
    () => applyFilters(getItemsForDate(allItems, selectedDate), filterType, watchFilter),
    [selectedDate, allItems, filterType, watchFilter]
  );

  const handlePrev = () => {
    if (viewMode === "month") {
      const newMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const newYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      setCurrentMonth(newMonth);
      setCurrentYear(newYear);
      setSelectedDate(new Date(newYear, newMonth, 1));
      maybePrefetch(newYear, newMonth);
    } else if (viewMode === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 7);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
      maybePrefetch(d.getFullYear(), d.getMonth());
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 1);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
      maybePrefetch(d.getFullYear(), d.getMonth());
    }
  };

  const handleNext = () => {
    if (viewMode === "month") {
      const newMonth = currentMonth === 11 ? 0 : currentMonth + 1;
      const newYear = currentMonth === 11 ? currentYear + 1 : currentYear;
      setCurrentMonth(newMonth);
      setCurrentYear(newYear);
      setSelectedDate(new Date(newYear, newMonth, 1));
      maybePrefetch(newYear, newMonth);
    } else if (viewMode === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 7);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
      maybePrefetch(d.getFullYear(), d.getMonth());
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 1);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
      maybePrefetch(d.getFullYear(), d.getMonth());
    }
  };

  const getCenterLabel = (): string => {
    if (viewMode === "month") return `${monthNames[currentMonth]} ${currentYear}`;
    if (viewMode === "week") {
      const start = weekDays[0].date;
      const end = weekDays[6].date;
      if (start.getMonth() === end.getMonth())
        return `${monthNames[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
      return `${monthNames[start.getMonth()].slice(0, 3)} ${start.getDate()} - ${monthNames[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
    }
    return selectedDate.toLocaleDateString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
    });
  };

  const emptyCells = Array(new Date(currentYear, currentMonth, 1).getDay()).fill(null);
  const selectedDayItem = { date: selectedDate, items: selectedDateItems };

  return (
    <div className="lg:flex lg:h-full lg:flex-col">
      <CalendarControls
        viewMode={viewMode}
        onViewChange={setViewMode}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
        watchFilter={watchFilter}
        onWatchFilterChange={setWatchFilter}
        currentlyWatchingFilter={false}
        onCurrentlyWatchingFilterChange={() => {}}
        centerLabel={getCenterLabel()}
        onPrev={handlePrev}
        onNext={handleNext}
        user={user}
        onSyncCalendar={() => {}}
        showActions={false}
      />

      {viewMode === "month" && (
        <CalendarMonthGrid
          days={daysOfMonth}
          emptyCells={emptyCells}
          today={today}
          selectedDate={selectedDayItem}
          isLoading={isLoading}
          onSelectDay={(date) => {
            setSelectedDate(date);
            setCurrentMonth(date.getMonth());
            setCurrentYear(date.getFullYear());
          }}
        />
      )}

      {viewMode === "week" && (
        <CalendarWeekGrid
          weekDays={weekDays}
          today={today}
          selectedDate={selectedDayItem}
          isLoading={isLoading}
          onSelectDay={(date) => {
            setSelectedDate(date);
            setCurrentMonth(date.getMonth());
            setCurrentYear(date.getFullYear());
          }}
        />
      )}

      <CalendarDayDetail
        containerRef={episodeListRef}
        selectedDate={selectedDate}
        items={selectedDateItems}
        headingSize={viewMode === "day" ? "xl" : undefined}
      />
    </div>
  );
}
