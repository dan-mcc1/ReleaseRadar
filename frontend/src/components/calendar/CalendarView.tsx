import { useState, useMemo, useEffect, useRef } from "react";
import { isPremiumFeature } from "../../config/features";
import CalendarSyncModal from "../CalendarSyncModal";
import ProUpgradeModal from "../ProUpgradeModal";
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  IconButton,
  PageHeader,
  Segmented,
  buttonClass,
  cx,
  focusRing,
} from "../ui";
import { useUserMe } from "../../hooks/api/useUser";
import { useCalendarData } from "../../hooks/useCalendarData";
import { useCurrentlyWatching } from "../../hooks/api/useLists";
import CalendarMonthGrid from "./CalendarMonthGrid";
import CalendarTimeline from "./CalendarTimeline";
import CalendarSideRail from "./CalendarSideRail";
import ContinueWatchingStrip from "./ContinueWatchingStrip";
import {
  buildAllItems,
  indexItemsByDate,
  getItemsForDate,
  applyFilters,
  getDaysInMonth,
  getWeekDays,
  countUpcomingThisMonth,
  type CurrentlyWatchingIds,
  type DayItem,
} from "../../utils/calendarUtils";

type ViewMode = "month" | "week";
type TypeFilter = "all" | "tv" | "movie";
type WatchFilter = "all" | "watched" | "unwatched";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function FiltersMenu({
  type,
  onType,
  watch,
  onWatch,
  watchingOnly,
  onWatchingOnly,
}: {
  type: TypeFilter;
  onType: (value: TypeFilter) => void;
  watch: WatchFilter;
  onWatch: (value: WatchFilter) => void;
  watchingOnly: boolean;
  onWatchingOnly: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = type !== "all" || watch !== "all" || watchingOnly;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus(); // not left on the menu that just closed
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cx(buttonClass("secondary"), (open || active) && "border-neutral-500")}
      >
        Filters
        {active && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400" aria-hidden="true" />
            <span className="sr-only">(on)</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 w-max max-w-[calc(100vw-3rem)] rounded-surface border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/50 p-4 flex flex-col items-start gap-4">
          <div>
            <p className="mb-2 text-caption text-neutral-400">Type</p>
            <Segmented
              label="Type"
              value={type}
              onChange={onType}
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
              value={watch}
              onChange={onWatch}
              options={[
                { value: "all", label: "All" },
                { value: "unwatched", label: "Unwatched" },
                { value: "watched", label: "Watched" },
              ]}
            />
          </div>
          <label className="flex items-center gap-2.5 min-h-10 text-label text-neutral-200 cursor-pointer">
            <input
              type="checkbox"
              checked={watchingOnly}
              onChange={(e) => onWatchingOnly(e.target.checked)}
              className="w-4 h-4 accent-primary-500 [color-scheme:dark]"
            />
            Only what I'm currently watching
          </label>
          {active && (
            <button
              type="button"
              onClick={() => {
                onType("all");
                onWatch("all");
                onWatchingOnly(false);
              }}
              className={cx("rounded-sm text-label text-neutral-400 hover:text-neutral-100 transition-colors cursor-pointer", focusRing)}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalendarView() {
  const { data: userMe } = useUserMe();
  const [watchFilter, setWatchFilter] = useState<WatchFilter>("all");
  const { data: cwData } = useCurrentlyWatching();
  const isPremium =
    userMe?.subscription_tier === "premium" ||
    userMe?.subscription_tier === "admin";

  const today = new Date();
  // UI state only
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const { shows, movies, isLoading } = useCalendarData(currentYear, currentMonth);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [filterType, setFilterType] = useState<TypeFilter>("all");
  const [currentlyWatchingFilter, setCurrentlyWatchingFilter] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Derivation chain — all useMemo
  const allItems = useMemo(
    () => buildAllItems({ shows, movies }),
    [shows, movies],
  );
  const itemsByDate = useMemo(() => indexItemsByDate(allItems), [allItems]);

  const cwIds = useMemo((): CurrentlyWatchingIds | undefined => {
    if (!currentlyWatchingFilter || !cwData) return undefined;
    return {
      showIds: new Set(cwData?.shows?.map((s) => s.id) ?? []),
      movieIds: new Set(cwData?.movies?.map((m) => m.id) ?? []),
    };
  }, [currentlyWatchingFilter, cwData]);

  const daysOfMonth = useMemo(
    () =>
      getDaysInMonth(
        currentMonth,
        currentYear,
        itemsByDate,
        filterType,
        watchFilter,
        cwIds,
      ),
    [currentMonth, currentYear, itemsByDate, filterType, watchFilter, cwIds],
  );

  const weekDays = useMemo(
    () => getWeekDays(selectedDate, itemsByDate, filterType, watchFilter, cwIds),
    [selectedDate, itemsByDate, filterType, watchFilter, cwIds],
  );

  const selectedDateItems = useMemo(
    () =>
      applyFilters(
        getItemsForDate(itemsByDate, selectedDate),
        filterType,
        watchFilter,
        cwIds,
      ),
    [selectedDate, itemsByDate, filterType, watchFilter, cwIds],
  );

  // The seven days after today that have something on them.
  const todayKey = today.toDateString();
  const upcoming = useMemo(() => {
    const days: DayItem[] = [];
    for (let offset = 1; offset <= 7; offset++) {
      const date = new Date(todayKey);
      date.setDate(date.getDate() + offset);
      const items = applyFilters(
        getItemsForDate(itemsByDate, date),
        filterType,
        watchFilter,
        cwIds,
      );
      if (items.length > 0) days.push({ date, items });
    }
    return days;
  }, [todayKey, itemsByDate, filterType, watchFilter, cwIds]);

  useEffect(() => {
    const rawItems =
      viewMode === "week"
        ? selectedDateItems
        : weekDays.flatMap((d) => d.items);
    const visibleItems = rawItems.filter(
      (item): item is NonNullable<typeof item> => item != null,
    );
    const urls = new Set<string>();
    for (const item of visibleItems) {
      if (item.showData.backdrop_path)
        urls.add(
          `https://image.tmdb.org/t/p/w780${item.showData.backdrop_path}`,
        );
      if (item.showData.logo_path)
        urls.add(`https://image.tmdb.org/t/p/w185${item.showData.logo_path}`);
    }
    urls.forEach((url) => {
      new Image().src = url;
    });
  }, [viewMode, weekDays, selectedDateItems]);

  const upcomingThisMonth = useMemo(
    () => countUpcomingThisMonth(allItems, today, currentMonth, currentYear),
    [allItems, currentMonth, currentYear],
  );

  // Navigation handlers only set date/month/year state; useCalendarData
  // loads the months around the one on screen.
  const handlePrev = () => {
    if (viewMode === "month") {
      const newMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const newYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      setCurrentMonth(newMonth);
      setCurrentYear(newYear);
      setSelectedDate(new Date(newYear, newMonth, 1));
    } else {
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() - 7);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setSelectedDate(newDate);
    }
  };

  const handleNext = () => {
    if (viewMode === "month") {
      const newMonth = currentMonth === 11 ? 0 : currentMonth + 1;
      const newYear = currentMonth === 11 ? currentYear + 1 : currentYear;
      setCurrentMonth(newMonth);
      setCurrentYear(newYear);
      setSelectedDate(new Date(newYear, newMonth, 1));
    } else {
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() + 7);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setSelectedDate(newDate);
    }
  };

  const emptyCells = Array(
    new Date(currentYear, currentMonth, 1).getDay(),
  ).fill(null);

  // CalendarMonthGrid still expects a DayItem for the selectedDate comparison
  const selectedDayItem = { date: selectedDate, items: selectedDateItems };

  const goToToday = () => {
    const t = new Date();
    setCurrentMonth(t.getMonth());
    setCurrentYear(t.getFullYear());
    setSelectedDate(t);
  };

  const weekStart = weekDays[0].date;
  const weekEnd = weekDays[6].date;
  const heading =
    viewMode === "month"
      ? monthNames[currentMonth]
      : weekStart.getMonth() === weekEnd.getMonth()
        ? `${monthNames[weekStart.getMonth()]} ${weekStart.getDate()}–${weekEnd.getDate()}`
        : `${monthNames[weekStart.getMonth()].slice(0, 3)} ${weekStart.getDate()} – ${monthNames[weekEnd.getMonth()].slice(0, 3)} ${weekEnd.getDate()}`;
  const headingYear = viewMode === "month" ? currentYear : weekEnd.getFullYear();
  const span = viewMode === "month" ? "month" : "week";

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
      <div className="min-w-0 flex flex-col gap-5">
        {/* ── Header ── */}
        <div data-tour="calendar-view">
          <PageHeader
            title={`${heading} ${headingYear}`}
            description={
              viewMode === "month" && upcomingThisMonth > 0
                ? `${upcomingThisMonth} upcoming ${upcomingThisMonth === 1 ? "release" : "releases"} this month`
                : undefined
            }
            actions={
              <>
                <div className="flex items-center gap-1.5">
                  <IconButton
                    label={`Previous ${span}`}
                    icon={<ChevronLeftIcon />}
                    variant="secondary"
                    shape="square"
                    onClick={handlePrev}
                  />
                  <Button onClick={goToToday}>Today</Button>
                  <IconButton
                    label={`Next ${span}`}
                    icon={<ChevronRightIcon />}
                    variant="secondary"
                    shape="square"
                    onClick={handleNext}
                  />
                </div>
                <Segmented
                  label="View"
                  value={viewMode}
                  onChange={setViewMode}
                  options={[
                    { value: "month", label: "Calendar" },
                    { value: "week", label: "Timeline" },
                  ]}
                />
                <FiltersMenu
                  type={filterType}
                  onType={setFilterType}
                  watch={watchFilter}
                  onWatch={setWatchFilter}
                  watchingOnly={currentlyWatchingFilter}
                  onWatchingOnly={setCurrentlyWatchingFilter}
                />
              </>
            }
          />
        </div>

        <ContinueWatchingStrip />

        {viewMode === "month" ? (
          <CalendarMonthGrid
            label={`${monthNames[currentMonth]} ${currentYear}`}
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
        ) : (
          <CalendarTimeline
            weekDays={weekDays}
            today={today}
            isLoading={isLoading}
          />
        )}
      </div>

      <aside aria-label="Today and coming up" className="min-w-0 lg:self-stretch">
        <CalendarSideRail
          todayItems={applyFilters(
            getItemsForDate(itemsByDate, today),
            filterType,
            watchFilter,
            cwIds,
          )}
          selectedDate={selectedDate}
          selectedDateItems={selectedDateItems}
          onResetToToday={goToToday}
          onSyncCalendar={() =>
            !isPremiumFeature("icalSync") || isPremium
              ? setShowSyncModal(true)
              : setShowUpgradeModal(true)
          }
          upcoming={upcoming}
          // Only the first load: a far month still loading doesn't hide
          // today, whose data stays loaded.
          isLoading={isLoading && allItems.length === 0}
        />
      </aside>

      <CalendarSyncModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
      />
      {showUpgradeModal && (
        <ProUpgradeModal
          feature="general"
          onClose={() => setShowUpgradeModal(false)}
        />
      )}
    </div>
  );
}
