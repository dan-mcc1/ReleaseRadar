import { useState, useMemo } from "react";
import { useShelfCalendarData } from "../../hooks/useShelfCalendarData";
import CalendarMonthGrid from "./CalendarMonthGrid";
import CalendarTimeline from "./CalendarTimeline";
import CalendarDayDetail from "./CalendarDayDetail";
import CalendarSideRail from "./CalendarSideRail";
import {
  buildAllItems,
  getItemsForDate,
  applyFilters,
  getDaysInMonth,
  getWeekDays,
  countUpcomingThisMonth,
} from "../../utils/calendarUtils";

type ViewMode = "month" | "week" | "day";

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  shelfId: number;
  shelfName?: string;
}

export default function ShelfCalendarView({ shelfId, shelfName }: Props) {
  const { shows, movies, isLoading, maybePrefetch } = useShelfCalendarData(shelfId);

  const today = new Date();

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "month"
  );
  const [filterType, setFilterType] = useState<"all" | "tv" | "movie">("all");
  const [watchFilter, setWatchFilter] = useState<"all" | "watched" | "unwatched">("all");
  const [showFilters, setShowFilters] = useState(false);

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

  const upcomingThisMonth = useMemo(
    () => countUpcomingThisMonth(allItems, today, currentMonth, currentYear),
    [allItems, currentMonth, currentYear]
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

  const goToToday = () => {
    const t = new Date();
    setCurrentMonth(t.getMonth());
    setCurrentYear(t.getFullYear());
    setSelectedDate(t);
  };

  const emptyCells = Array(new Date(currentYear, currentMonth, 1).getDay()).fill(null);
  const selectedDayItem = { date: selectedDate, items: selectedDateItems };
  const hasActiveFilters = filterType !== "all" || watchFilter !== "all";

  return (
    <div className="w-full">
      {/* Header */}
      <div className="px-6 lg:px-10 pt-5 bg-neutral-950">
        <p className="font-mono text-sm tracking-[0.12em] uppercase text-neutral-500 mb-3">
          {shelfName ?? "Shelf"} Calendar
          {viewMode === "month" && upcomingThisMonth > 0 && (
            <span className="text-neutral-600">
              {" "}· {upcomingThisMonth} upcoming releases this month
            </span>
          )}
        </p>

        <div className="flex items-center gap-2 flex-wrap mb-5">
          {/* Month + Year heading */}
          <h2
            className="text-5xl tracking-tight leading-none mr-1"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {viewMode === "week" ? (
              <>
                {weekDays[0].date.getMonth() === weekDays[6].date.getMonth()
                  ? `${monthNames[weekDays[0].date.getMonth()]} ${weekDays[0].date.getDate()}–${weekDays[6].date.getDate()}`
                  : `${monthNames[weekDays[0].date.getMonth()].slice(0, 3)} ${weekDays[0].date.getDate()} – ${monthNames[weekDays[6].date.getMonth()].slice(0, 3)} ${weekDays[6].date.getDate()}`}
                {" "}
                <em className="text-primary-400" style={{ fontStyle: "italic" }}>
                  {weekDays[6].date.getFullYear()}
                </em>
              </>
            ) : (
              <>
                {monthNames[currentMonth]}{" "}
                <em className="text-primary-400" style={{ fontStyle: "italic" }}>
                  {currentYear}
                </em>
              </>
            )}
          </h2>

          <div className="flex-1" />

          {/* ← Today → navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrev}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={goToToday}
              className="h-8 px-3 text-xs font-semibold rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white transition-colors"
            >
              Today
            </button>
            <button
              onClick={handleNext}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* View mode toggle */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
            {[
              { mode: "month" as ViewMode, label: "Calendar" },
              { mode: "week" as ViewMode, label: "Timeline" },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === mode || (mode === "month" && viewMode === "day")
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="relative">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border transition-colors ${
                showFilters || hasActiveFilters
                  ? "bg-neutral-800 border-neutral-700 text-white"
                  : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2" />
              </svg>
              Filters
              {hasActiveFilters && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400" />
              )}
            </button>

            {showFilters && (
              <div className="absolute right-0 top-full mt-2 z-20 w-56 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl p-3 flex flex-col gap-3">
                <div>
                  <p className="font-mono text-[10px] tracking-widest uppercase text-neutral-500 mb-2">Type</p>
                  <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
                    {(["all", "movie", "tv"] as const).map((value, idx, arr) => (
                      <button
                        key={value}
                        onClick={() => setFilterType(value)}
                        className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                          filterType === value
                            ? "bg-primary-600 text-white"
                            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                        } ${idx < arr.length - 1 ? "border-r border-neutral-700" : ""}`}
                      >
                        {value === "all" ? "All" : value === "movie" ? "Movies" : "TV"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[10px] tracking-widest uppercase text-neutral-500 mb-2">Status</p>
                  <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
                    {(["all", "unwatched", "watched"] as const).map((value, idx, arr) => (
                      <button
                        key={value}
                        onClick={() => setWatchFilter(value)}
                        className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                          watchFilter === value
                            ? "bg-primary-600 text-white"
                            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                        } ${idx < arr.length - 1 ? "border-r border-neutral-700" : ""}`}
                      >
                        {value === "all" ? "All" : value === "watched" ? "Watched" : "Unwatched"}
                      </button>
                    ))}
                  </div>
                </div>
                {hasActiveFilters && (
                  <button
                    onClick={() => { setFilterType("all"); setWatchFilter("all"); }}
                    className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors text-left"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content: calendar grid + side rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 px-6 lg:px-10 py-2 items-start">
        <div>
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
            <CalendarTimeline
              weekDays={weekDays}
              today={today}
              isLoading={isLoading}
            />
          )}

          {viewMode === "day" && (
            <CalendarDayDetail
              containerRef={{ current: null }}
              selectedDate={selectedDate}
              items={selectedDateItems}
              headingSize="xl"
            />
          )}
        </div>

        <div>
          <CalendarSideRail
            todayItems={applyFilters(getItemsForDate(allItems, today), filterType, watchFilter)}
            selectedDate={selectedDate}
            selectedDateItems={selectedDateItems}
            onResetToToday={goToToday}
            onSyncCalendar={() => {}}
            showExtras={false}
          />
        </div>
      </div>
    </div>
  );
}
