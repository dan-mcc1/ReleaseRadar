import { useState, useEffect, useRef } from "react";
import type { Show, Movie, Episode, CalendarData } from "../types/calendar";
import "react-datepicker/dist/react-datepicker.css";
import WatchlistModal from "./WatchlistModal";
import { User } from "firebase/auth";
import DailyEpisodeList from "./DailyEpisodeList";
import { BASE_IMAGE_URL } from "../constants";
import { parseLocalDate, toLocalISODate } from "../utils/date";

interface Day {
  date: Date;
  items?: CalendarItem[];
}

interface CalendarProps {
  calendarData: CalendarData;
  setCalendarData: React.Dispatch<React.SetStateAction<CalendarData>>;
  showWatchlist: boolean;
  setShowWatchlist: React.Dispatch<React.SetStateAction<boolean>>;
  user: User | null;
  watchedEpisodeKeys?: Set<string>;
  isLoading?: boolean;
  onSyncCalendar?: () => void;
}

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
    };

export type ViewMode = "month" | "week" | "day";

export default function CalendarComponent({
  calendarData = { shows: [], movies: [] },
  setCalendarData,
  showWatchlist = false,
  setShowWatchlist,
  user,
  watchedEpisodeKeys = new Set(),
  isLoading = false,
  onSyncCalendar,
}: CalendarProps) {
  const allItems: CalendarItem[] = [
    ...calendarData.shows.flatMap((show) =>
      (show.episodes ?? []).map((ep) => ({
        ...ep,
        showData: show.show,
        type: "tv" as const,
      }))
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
    })),
  ];

  const [filterType, setFilterType] = useState<"all" | "tv" | "movie">("all");
  const [watchFilter, setWatchFilter] = useState<"all" | "watched" | "unwatched">("all");
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "month"
  );
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isItemWatched = (item: CalendarItem): boolean => {
    if (item.type === "movie") return item.showData.isWatched === true;
    return watchedEpisodeKeys.has(
      `${item.show_id}_${item.season_number}_${item.episode_number}`
    );
  };

  const getFilteredItems = (items: CalendarItem[]) => {
    let filtered = filterType === "all" ? items : items.filter((item) => item.type === filterType);
    if (watchFilter === "watched") filtered = filtered.filter(isItemWatched);
    if (watchFilter === "unwatched") filtered = filtered.filter((item) => !isItemWatched(item));
    return filtered;
  };

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [daysOfMonth, setDaysOfMonth] = useState<Day[]>([]);
  const [selectedDate, setSelectedDate] = useState<Day>({
    date: today,
    items: allItems,
  });

  function getItemsForDate(date: Date): CalendarItem[] {
    const isoDate = toLocalISODate(date);
    return getFilteredItems(
      allItems.filter(
        (item) =>
          (item.type === "tv" && item.air_date === isoDate) ||
          (item.type === "movie" && item.release_date === isoDate)
      )
    );
  }

  function setItemsForDay(date: Date) {
    setSelectedDate({ date, items: getItemsForDate(date) });
  }

  const handleGoToToday = () => {
    const todayDate = new Date();
    setCurrentMonth(todayDate.getMonth());
    setCurrentYear(todayDate.getFullYear());
    setItemsForDay(todayDate);
  };

  const getDaysInMonth = (month: number, year: number) => {
    const date = new Date(year, month, 1);
    const days: Day[] = [];
    while (date.getMonth() === month) {
      const isoDate = toLocalISODate(date);
      const todaysItems = getFilteredItems(
        allItems.filter(
          (item) =>
            (item.type === "tv" && item.air_date === isoDate) ||
            (item.type === "movie" && item.release_date === isoDate)
        )
      );
      days.push({ date: new Date(date), items: todaysItems });
      date.setDate(date.getDate() + 1);
    }
    return days;
  };

  const getWeekDays = (): Day[] => {
    const date = selectedDate.date;
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { date: d, items: getItemsForDate(d) };
    });
  };

  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();

  const handlePrevMonth = () => {
    const newMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const newYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
    setItemsForDay(new Date(newYear, newMonth, 1));
  };

  const handleNextMonth = () => {
    const newMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const newYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
    setItemsForDay(new Date(newYear, newMonth, 1));
  };

  const handlePrev = () => {
    if (viewMode === "month") {
      handlePrevMonth();
    } else if (viewMode === "week") {
      const newDate = new Date(selectedDate.date);
      newDate.setDate(newDate.getDate() - 7);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setItemsForDay(newDate);
    } else {
      const newDate = new Date(selectedDate.date);
      newDate.setDate(newDate.getDate() - 1);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setItemsForDay(newDate);
    }
  };

  const handleNext = () => {
    if (viewMode === "month") {
      handleNextMonth();
    } else if (viewMode === "week") {
      const newDate = new Date(selectedDate.date);
      newDate.setDate(newDate.getDate() + 7);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setItemsForDay(newDate);
    } else {
      const newDate = new Date(selectedDate.date);
      newDate.setDate(newDate.getDate() + 1);
      setCurrentMonth(newDate.getMonth());
      setCurrentYear(newDate.getFullYear());
      setItemsForDay(newDate);
    }
  };

  useEffect(() => {
    setItemsForDay(today);
  }, [calendarData]);

  useEffect(() => {
    setDaysOfMonth(getDaysInMonth(currentMonth, currentYear));
  }, [currentMonth, currentYear, calendarData]);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const dayNames = [
    ["S", "un"], ["M", "on"], ["T", "ue"], ["W", "ed"],
    ["Th", "u"], ["F", "ri"], ["S", "at"],
  ];

  const getCenterLabel = (): string => {
    if (viewMode === "month") {
      return `${monthNames[currentMonth]} ${currentYear}`;
    } else if (viewMode === "week") {
      const days = getWeekDays();
      const start = days[0].date;
      const end = days[6].date;
      if (start.getMonth() === end.getMonth()) {
        return `${monthNames[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`;
      }
      return `${monthNames[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${monthNames[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
    } else {
      return selectedDate.date.toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  };

  const emptyCells = Array(firstDayOfWeek).fill(null);

  // Count upcoming items this month for the header stat
  const upcomingThisMonth = allItems.filter((item) => {
    const dateStr = item.type === "tv" ? item.air_date : item.release_date;
    if (!dateStr) return false;
    const d = parseLocalDate(dateStr);
    return d >= today && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const DayCell = ({
    day,
    isCompact = false,
  }: {
    day: Day;
    isCompact?: boolean;
  }) => {
    const isToday = day.date.toDateString() === today.toDateString();
    const isSelected = selectedDate.date.toDateString() === day.date.toDateString();
    const isoDate = toLocalISODate(day.date);
    const cellItems = getFilteredItems(
      allItems.filter(
        (item) =>
          (item.type === "tv" && item.air_date === isoDate) ||
          (item.type === "movie" && item.release_date === isoDate)
      )
    );

    return (
      <div
        onClick={() => setItemsForDay(day.date)}
        className={`relative px-1 sm:px-2 py-1 sm:py-2 overflow-y-auto border border-slate-700/50 cursor-pointer transition-colors duration-150 ${
          isCompact ? "min-h-20 sm:min-h-32" : "min-h-32 sm:min-h-48"
        } ${
          isToday
            ? "bg-blue-700 font-bold"
            : isSelected
            ? "bg-slate-700 ring-2 ring-inset ring-blue-500"
            : "bg-slate-800 hover:bg-slate-750"
        }`}
        style={!isToday && !isSelected ? { backgroundColor: 'rgb(28 36 52)' } : undefined}
      >
        <time
          dateTime={isoDate}
          className={`text-xs sm:text-sm font-semibold ${
            isToday ? "text-white" : isSelected ? "text-blue-300" : "text-slate-300"
          }`}
        >
          {day.date.getDate()}
        </time>

        {isLoading ? (
          Array.from({ length: day.date.getDate() % 3 === 0 ? 2 : 1 }).map((_, idx) => (
            <div key={idx} className="mt-1 h-8 sm:h-14 rounded-md bg-slate-700 animate-pulse" />
          ))
        ) : (
          cellItems.map((item, idx) => {
            const title =
              "episode_number" in item
                ? `${item.showData.name} - ${item.name}`
                : item.title;

            return (
              <div
                key={idx}
                className="relative mt-1 h-8 sm:h-14 rounded-md overflow-hidden group"
              >
                {item.showData.backdrop_path && (
                  <img
                    src={`${BASE_IMAGE_URL}/w780${item.showData.backdrop_path}`}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-black/50" />
                <div className="relative z-10 flex h-full items-center justify-center px-1">
                  {item.showData.logo_path ? (
                    <img
                      src={`${BASE_IMAGE_URL}/w300${item.showData.logo_path}`}
                      alt={title}
                      className="max-h-5 sm:max-h-9 object-contain drop-shadow-md"
                    />
                  ) : (
                    <span className="text-white text-[7px] sm:text-[9px] font-semibold text-center line-clamp-2 drop-shadow">
                      {title}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  };

  return (
    <div className="lg:flex lg:h-full lg:flex-col max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-700 px-4 sm:px-6 py-3 sm:py-4 bg-slate-900">
        <div className="flex items-center gap-3">
          <span className="text-lg sm:text-2xl font-bold text-white">Watch Calendar</span>
          {viewMode === "month" && upcomingThisMonth > 0 && (
            <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-600/30">
              {upcomingThisMonth} upcoming
            </span>
          )}
        </div>
        <button
          onClick={handleGoToToday}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
        >
          Today
        </button>
      </header>

      {/* Controls bar */}
      <div className="border-b border-slate-700 bg-slate-900">
        {/* Mobile-only: period navigation row */}
        <div className="flex sm:hidden items-center justify-between px-4 pt-2 pb-1">
          <button
            onClick={handlePrev}
            className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-sm font-semibold text-slate-100 text-center">
            {getCenterLabel()}
          </div>
          <button
            onClick={handleNext}
            className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Main controls row */}
        <div className="relative flex items-center gap-2 px-4 py-2.5">
          {/* LEFT: view toggle + filter dropdown */}
          <div className="flex items-center gap-2">
            {/* View mode */}
            <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden">
              {(["day", "week", "month"] as ViewMode[]).map((mode, idx, arr) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`py-1.5 text-xs sm:text-sm font-medium capitalize transition-colors px-2 sm:px-3
                    ${viewMode === mode ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"}
                    ${idx < arr.length - 1 ? "border-r border-slate-600" : ""}
                  `}
                >
                  <span className="sm:hidden">{mode === "month" ? "Mo" : mode === "week" ? "Wk" : "Day"}</span>
                  <span className="hidden sm:inline">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                </button>
              ))}
            </div>

            {/* Filter dropdown */}
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setShowFilters((v) => !v)}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border transition-colors
                  ${showFilters ? "bg-slate-700 border-slate-500 text-white" : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"}
                `}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2" />
                </svg>
                <span className="hidden sm:inline">Filter</span>
                {(filterType !== "all" || watchFilter !== "all") && (
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                )}
              </button>

              {showFilters && (
                <div className="absolute left-0 top-full mt-1.5 z-20 w-56 rounded-xl border border-slate-600 bg-slate-800 shadow-xl p-3 flex flex-col gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Type</p>
                    <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden w-full">
                      {(["all", "movie", "tv"] as const).map((value, idx, arr) => {
                        const label = value === "all" ? "All" : value === "movie" ? "Movies" : "TV";
                        return (
                          <button
                            key={value}
                            onClick={() => { setFilterType(value); setItemsForDay(selectedDate.date); }}
                            className={`flex-1 py-1.5 text-sm font-medium transition-colors
                              ${filterType === value ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"}
                              ${idx < arr.length - 1 ? "border-r border-slate-600" : ""}
                            `}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Status</p>
                    <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden w-full">
                      {(["all", "unwatched", "watched"] as const).map((value, idx, arr) => {
                        const label = value === "all" ? "All" : value === "watched" ? "Watched" : "Unwatched";
                        return (
                          <button
                            key={value}
                            onClick={() => { setWatchFilter(value); setItemsForDay(selectedDate.date); }}
                            className={`flex-1 py-1.5 text-sm font-medium transition-colors
                              ${watchFilter === value ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"}
                              ${idx < arr.length - 1 ? "border-r border-slate-600" : ""}
                            `}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(filterType !== "all" || watchFilter !== "all") && (
                    <button
                      onClick={() => { setFilterType("all"); setWatchFilter("all"); setItemsForDay(selectedDate.date); }}
                      className="text-xs text-slate-400 hover:text-white transition-colors text-left"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CENTER: Period navigation (desktop only) */}
          <div className="hidden sm:flex absolute left-1/2 -translate-x-1/2 items-center gap-1">
            <button
              onClick={handlePrev}
              className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="px-3 text-base font-semibold text-slate-100 whitespace-nowrap min-w-[180px] text-center">
              {getCenterLabel()}
            </div>
            <button
              onClick={handleNext}
              className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* RIGHT: Sync + Watchlist */}
          <div className="ml-auto flex items-center gap-2">
            {user && onSyncCalendar && (
              <button
                onClick={onSyncCalendar}
                title="Sync with Google Calendar, Outlook, or Apple Calendar"
                className="rounded-lg bg-slate-700 border border-slate-600 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-200 hover:bg-slate-600 hover:text-white transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Sync
              </button>
            )}
            {user && (
              <>
                <button
                  onClick={() => setShowWatchlist(true)}
                  className="rounded-lg bg-slate-700 border border-slate-600 px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-200 hover:bg-slate-600 hover:text-white transition-colors"
                >
                  <span className="sm:hidden">List</span>
                  <span className="hidden sm:inline">Watchlist</span>
                </button>
                <WatchlistModal
                  isOpen={showWatchlist}
                  onClose={() => setShowWatchlist(false)}
                  setCalendarData={setCalendarData}
                  calendarData={calendarData}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── MONTH VIEW ── */}
      {viewMode === "month" && (
        <div className="flex flex-auto flex-col">
          <div className="grid grid-cols-7 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 bg-slate-900 border-b border-slate-700">
            {dayNames.map(([letter, full], i) => (
              <div key={i} className="py-2.5">
                <span className="sm:hidden">{letter}</span>
                <span className="hidden sm:inline">{letter}{full}</span>
              </div>
            ))}
          </div>

          <div className="flex-auto bg-slate-700 grid-rows-auto">
            <div className="w-full grid grid-cols-7 gap-px">
              {emptyCells.map((_, idx) => (
                <div
                  key={`empty-${idx}`}
                  className="bg-slate-950 min-h-[5rem] sm:min-h-[8rem] max-h-[14rem]"
                />
              ))}
              {daysOfMonth.map((day) => (
                <DayCell key={day.date.toISOString()} day={day} isCompact />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── WEEK VIEW ── */}
      {viewMode === "week" && (
        <div className="flex flex-auto flex-col">
          <div className="grid grid-cols-7 border-b border-slate-700 bg-slate-900">
            {getWeekDays().map((day, i) => {
              const isToday = day.date.toDateString() === today.toDateString();
              return (
                <div
                  key={i}
                  className={`flex flex-col items-center py-3 border-r border-slate-700 last:border-r-0 ${
                    isToday ? "bg-blue-600/20" : ""
                  }`}
                >
                  <span className={`text-xs uppercase tracking-wide font-medium ${isToday ? "text-blue-400" : "text-slate-500"}`}>
                    {dayNames[i][0]}{dayNames[i][1]}
                  </span>
                  <span className={`mt-1 text-xl font-bold ${isToday ? "text-blue-400" : "text-slate-200"}`}>
                    {day.date.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex-auto bg-slate-700">
            <div className="w-full grid grid-cols-7 gap-px">
              {getWeekDays().map((day) => (
                <DayCell key={day.date.toISOString()} day={day} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SELECTED DAY DETAIL (month & week views) ── */}
      {viewMode !== "day" && (
        <div className="border-t border-slate-700 bg-slate-900/50 px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-lg font-semibold text-slate-100">
              {selectedDate.date.toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </h2>
            {selectedDate.items && selectedDate.items.length > 0 && (
              <span className="text-xs text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                {getFilteredItems(selectedDate.items).length} item{getFilteredItems(selectedDate.items).length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {selectedDate.items && selectedDate.items.length > 0 ? (
              <DailyEpisodeList dailyItems={getFilteredItems(selectedDate.items)} />
            ) : (
              <p className="text-slate-500 italic">Nothing scheduled for this day.</p>
            )}
          </div>
        </div>
      )}

      {/* ── DAY VIEW ── */}
      {viewMode === "day" && (
        <div className="px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold text-slate-100">
              {selectedDate.date.toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </h2>
            {selectedDate.items && selectedDate.items.length > 0 && (
              <span className="text-xs text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                {getFilteredItems(selectedDate.items).length} item{getFilteredItems(selectedDate.items).length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {selectedDate.items && selectedDate.items.length > 0 ? (
              <DailyEpisodeList dailyItems={getFilteredItems(selectedDate.items)} />
            ) : (
              <p className="text-slate-500 italic">Nothing scheduled for this day.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
