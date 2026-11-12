import { useState, useMemo } from "react";
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterIcon,
  IconButton,
  Segmented,
} from "../ui";
import { useShelfCalendarData } from "../../hooks/useShelfCalendarData";
import CalendarMonthGrid from "./CalendarMonthGrid";
import CalendarTimeline from "./CalendarTimeline";
import CalendarDayDetail from "./CalendarDayDetail";
import CalendarSideRail from "./CalendarSideRail";
import {
  buildAllItems,
  indexItemsByDate,
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
  const today = new Date();

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const { shows, movies, isLoading } = useShelfCalendarData(shelfId, currentYear, currentMonth);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "month"
  );
  const [filterType, setFilterType] = useState<"all" | "tv" | "movie">("all");
  const [watchFilter, setWatchFilter] = useState<"all" | "watched" | "unwatched">("all");
  const [showFilters, setShowFilters] = useState(false);

  const allItems = useMemo(() => buildAllItems({ shows, movies }), [shows, movies]);
  const itemsByDate = useMemo(() => indexItemsByDate(allItems), [allItems]);

  const daysOfMonth = useMemo(
    () => getDaysInMonth(currentMonth, currentYear, itemsByDate, filterType, watchFilter),
    [currentMonth, currentYear, itemsByDate, filterType, watchFilter]
  );

  const weekDays = useMemo(
    () => getWeekDays(selectedDate, itemsByDate, filterType, watchFilter),
    [selectedDate, itemsByDate, filterType, watchFilter]
  );

  const selectedDateItems = useMemo(
    () => applyFilters(getItemsForDate(itemsByDate, selectedDate), filterType, watchFilter),
    [selectedDate, itemsByDate, filterType, watchFilter]
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
    } else if (viewMode === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 7);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 1);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
    }
  };

  const handleNext = () => {
    if (viewMode === "month") {
      const newMonth = currentMonth === 11 ? 0 : currentMonth + 1;
      const newYear = currentMonth === 11 ? currentYear + 1 : currentYear;
      setCurrentMonth(newMonth);
      setCurrentYear(newYear);
      setSelectedDate(new Date(newYear, newMonth, 1));
    } else if (viewMode === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 7);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
    } else {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 1);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setSelectedDate(d);
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
        <div className="flex items-end gap-2 flex-wrap mb-5">
          <div className="flex-1 basis-60 min-w-0 mr-1">
            <h2 className="text-heading font-semibold text-neutral-50">
              {viewMode === "week"
                ? weekDays[0].date.getMonth() === weekDays[6].date.getMonth()
                  ? `${monthNames[weekDays[0].date.getMonth()]} ${weekDays[0].date.getDate()}–${weekDays[6].date.getDate()} ${weekDays[6].date.getFullYear()}`
                  : `${monthNames[weekDays[0].date.getMonth()].slice(0, 3)} ${weekDays[0].date.getDate()} – ${monthNames[weekDays[6].date.getMonth()].slice(0, 3)} ${weekDays[6].date.getDate()} ${weekDays[6].date.getFullYear()}`
                : `${monthNames[currentMonth]} ${currentYear}`}
            </h2>
            <p className="mt-1 text-body text-neutral-400">
              {shelfName ?? "Shelf"} calendar
              {viewMode === "month" &&
                upcomingThisMonth > 0 &&
                ` · ${upcomingThisMonth} upcoming ${upcomingThisMonth === 1 ? "release" : "releases"} this month`}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <IconButton
              label="Previous"
              icon={<ChevronLeftIcon />}
              variant="secondary"
              shape="square"
              onClick={handlePrev}
            />
            <Button onClick={goToToday}>Today</Button>
            <IconButton
              label="Next"
              icon={<ChevronRightIcon />}
              variant="secondary"
              shape="square"
              onClick={handleNext}
            />
          </div>

          <Segmented
            label="View"
            value={viewMode === "week" ? "week" : "month"}
            onChange={(mode) => setViewMode(mode)}
            options={[
              { value: "month", label: "Calendar" },
              { value: "week", label: "Timeline" },
            ]}
          />

          {/* Filters */}
          <div className="relative">
            <Button
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              icon={<FilterIcon />}
              className={showFilters || hasActiveFilters ? "border-neutral-500" : undefined}
            >
              Filters
              {hasActiveFilters && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400" aria-hidden="true" />
              )}
            </Button>

            {showFilters && (
              <div className="absolute right-0 top-full mt-2 z-20 w-max rounded-surface border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/50 p-4 flex flex-col items-start gap-4">
                <div>
                  <p className="mb-2 text-caption text-neutral-400">Type</p>
                  <Segmented
                    label="Type"
                    value={filterType}
                    onChange={setFilterType}
                    options={[
                      { value: "all", label: "All" },
                      { value: "movie", label: "Movies" },
                      { value: "tv", label: "TV" },
                    ]}
                  />
                </div>
                <div>
                  <p className="mb-2 text-caption text-neutral-400">Status</p>
                  <Segmented
                    label="Status"
                    value={watchFilter}
                    onChange={setWatchFilter}
                    options={[
                      { value: "all", label: "All" },
                      { value: "unwatched", label: "Unwatched" },
                      { value: "watched", label: "Watched" },
                    ]}
                  />
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
            todayItems={applyFilters(getItemsForDate(itemsByDate, today), filterType, watchFilter)}
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
