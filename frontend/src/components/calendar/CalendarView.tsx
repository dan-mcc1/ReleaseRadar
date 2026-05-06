import { useState, useMemo, useRef } from "react";
import "react-datepicker/dist/react-datepicker.css";
import CalendarSyncModal from "../CalendarSyncModal";
import { useAuthUser } from "../../hooks/useAuthUser";
import { useCalendarData } from "../../hooks/useCalendarData";
import CalendarHeader from "./CalendarHeader";
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
  countUpcomingThisMonth,
} from "../../utils/calendarUtils";

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function CalendarView() {
  const user = useAuthUser();
  const { shows, movies, isLoading, maybePrefetch } = useCalendarData();

  const today = new Date();
  const episodeListRef = useRef<HTMLDivElement>(null);

  // UI state only
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "month",
  );
  const [filterType, setFilterType] = useState<"all" | "tv" | "movie">("all");
  const [watchFilter, setWatchFilter] = useState<"all" | "watched" | "unwatched">("all");
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Derivation chain — all useMemo
  const allItems = useMemo(
    () => buildAllItems({ shows, movies }),
    [shows, movies],
  );

  const daysOfMonth = useMemo(
    () => getDaysInMonth(currentMonth, currentYear, allItems, filterType, watchFilter),
    [currentMonth, currentYear, allItems, filterType, watchFilter],
  );

  const weekDays = useMemo(
    () => getWeekDays(selectedDate, allItems, filterType, watchFilter),
    [selectedDate, allItems, filterType, watchFilter],
  );

  const selectedDateItems = useMemo(
    () => applyFilters(getItemsForDate(allItems, selectedDate), filterType, watchFilter),
    [selectedDate, allItems, filterType, watchFilter],
  );

  const upcomingThisMonth = useMemo(
    () => countUpcomingThisMonth(allItems, today, currentMonth, currentYear),
    [allItems, currentMonth, currentYear],
  );

  const todayItemCount = useMemo(
    () => applyFilters(getItemsForDate(allItems, today), filterType, watchFilter).length,
    [allItems, filterType, watchFilter],
  );

  // Navigation handlers — only set date/month/year state + call maybePrefetch
  const handlePrev = () => {
    if (viewMode === "month") {
      const newMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const newYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      setCurrentMonth(newMonth);
      setCurrentYear(newYear);
      setSelectedDate(new Date(newYear, newMonth, 1));
      maybePrefetch(newYear, newMonth);
    } else if (viewMode === "week") {
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() - 7);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setSelectedDate(newDate);
      maybePrefetch(newDate.getFullYear(), newDate.getMonth());
    } else {
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() - 1);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setSelectedDate(newDate);
      maybePrefetch(newDate.getFullYear(), newDate.getMonth());
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
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() + 7);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setSelectedDate(newDate);
      maybePrefetch(newDate.getFullYear(), newDate.getMonth());
    } else {
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() + 1);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setSelectedDate(newDate);
      maybePrefetch(newDate.getFullYear(), newDate.getMonth());
    }
  };

  const getCenterLabel = (): string => {
    if (viewMode === "month")
      return `${monthNames[currentMonth]} ${currentYear}`;
    if (viewMode === "week") {
      const start = weekDays[0].date;
      const end = weekDays[6].date;
      if (start.getMonth() === end.getMonth())
        return `${monthNames[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
      return `${monthNames[start.getMonth()].slice(0, 3)} ${start.getDate()} - ${monthNames[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
    }
    return selectedDate.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const emptyCells = Array(new Date(currentYear, currentMonth, 1).getDay()).fill(null);

  // CalendarMonthGrid and WeekGrid still expect DayItem for selectedDate comparison
  const selectedDayItem = { date: selectedDate, items: selectedDateItems };

  return (
    <div className="lg:flex lg:h-full lg:flex-col max-w-7xl mx-auto">
      <CalendarHeader
        upcomingThisMonth={upcomingThisMonth}
        todayItemCount={todayItemCount}
        viewMode={viewMode}
        onGoToToday={() => {
          const t = new Date();
          setCurrentMonth(t.getMonth());
          setCurrentYear(t.getFullYear());
          setSelectedDate(t);
        }}
      />

      <CalendarControls
        viewMode={viewMode}
        onViewChange={setViewMode}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
        watchFilter={watchFilter}
        onWatchFilterChange={setWatchFilter}
        centerLabel={getCenterLabel()}
        onPrev={handlePrev}
        onNext={handleNext}
        user={user}
        onSyncCalendar={() => setShowSyncModal(true)}
        showWatchlist={showWatchlist}
        onOpenWatchlist={() => setShowWatchlist(true)}
        onCloseWatchlist={() => setShowWatchlist(false)}
      />

      {/* Initial-release disclaimer */}
      <div className="px-4 py-1.5 bg-neutral-900/60 border-b border-neutral-700/50 flex items-center gap-1.5">
        <svg
          className="w-3 h-3 text-neutral-500 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-xs text-neutral-500">
          Shows initial air dates only — reruns are not included.
        </p>
      </div>

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

      {viewMode !== "day" && (
        <CalendarDayDetail
          containerRef={episodeListRef}
          selectedDate={selectedDate}
          items={selectedDateItems}
        />
      )}

      {viewMode === "day" && (
        <CalendarDayDetail
          containerRef={episodeListRef}
          selectedDate={selectedDate}
          items={selectedDateItems}
          headingSize="xl"
        />
      )}

      <CalendarSyncModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
      />
    </div>
  );
}
