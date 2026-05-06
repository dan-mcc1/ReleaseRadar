// frontend/src/components/calendar/CalendarControls.tsx
import { useRef, useState } from "react";
import { User } from "firebase/auth";
import WatchlistModal from "../WatchlistModal";

export type ViewMode = "month" | "week" | "day";

interface Props {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  filterType: "all" | "tv" | "movie";
  onFilterTypeChange: (v: "all" | "tv" | "movie") => void;
  watchFilter: "all" | "watched" | "unwatched";
  onWatchFilterChange: (v: "all" | "watched" | "unwatched") => void;
  centerLabel: string;
  onPrev: () => void;
  onNext: () => void;
  user: User | null;
  onSyncCalendar: () => void;
  showWatchlist: boolean;
  onOpenWatchlist: () => void;
  onCloseWatchlist: () => void;
}

export default function CalendarControls({
  viewMode, onViewChange,
  filterType, onFilterTypeChange,
  watchFilter, onWatchFilterChange,
  centerLabel, onPrev, onNext,
  user, onSyncCalendar,
  showWatchlist, onOpenWatchlist, onCloseWatchlist,
}: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const ChevronLeft = () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
  const ChevronRight = () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );

  return (
    <div className="border-b border-neutral-700 bg-neutral-900">
      {/* Mobile period nav */}
      <div className="flex lg:hidden items-center justify-between px-4 pt-2 pb-1">
        <button onClick={onPrev} className="h-8 w-8 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors">
          <ChevronLeft />
        </button>
        <div className="text-sm font-semibold text-neutral-100 text-center">{centerLabel}</div>
        <button onClick={onNext} className="h-8 w-8 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors">
          <ChevronRight />
        </button>
      </div>

      <div className="relative flex items-center gap-2 px-4 py-2.5">
        {/* LEFT: view toggle + filter */}
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="inline-flex rounded-lg border border-neutral-600 overflow-hidden">
            {(["day", "week", "month"] as ViewMode[]).map((mode, idx, arr) => (
              <button
                key={mode}
                onClick={() => onViewChange(mode)}
                className={`py-1.5 text-xs sm:text-sm font-medium capitalize transition-colors px-2 sm:px-3
                  ${viewMode === mode ? "bg-primary-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"}
                  ${idx < arr.length - 1 ? "border-r border-neutral-600" : ""}`}
              >
                <span className="sm:hidden">{mode === "month" ? "Mo" : mode === "week" ? "Wk" : "Day"}</span>
                <span className="hidden sm:inline capitalize">{mode}</span>
              </button>
            ))}
          </div>

          {/* Filter dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border transition-colors
                ${showFilters ? "bg-neutral-700 border-neutral-500 text-white" : "bg-neutral-800 border-neutral-600 text-neutral-300 hover:bg-neutral-700 hover:text-white"}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2" />
              </svg>
              <span className="hidden sm:inline">Filter</span>
              {(filterType !== "all" || watchFilter !== "all") && (
                <span className="w-2 h-2 rounded-full bg-primary-400" />
              )}
            </button>

            {showFilters && (
              <div className="absolute left-0 top-full mt-1.5 z-20 w-56 rounded-xl border border-neutral-600 bg-neutral-800 shadow-xl p-3 flex flex-col gap-3">
                <div>
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Type</p>
                  <div className="inline-flex rounded-lg border border-neutral-600 overflow-hidden w-full">
                    {(["all", "movie", "tv"] as const).map((value, idx, arr) => (
                      <button key={value} onClick={() => onFilterTypeChange(value)}
                        className={`flex-1 py-1.5 text-sm font-medium transition-colors
                          ${filterType === value ? "bg-primary-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"}
                          ${idx < arr.length - 1 ? "border-r border-neutral-600" : ""}`}
                      >
                        {value === "all" ? "All" : value === "movie" ? "Movies" : "TV"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Status</p>
                  <div className="inline-flex rounded-lg border border-neutral-600 overflow-hidden w-full">
                    {(["all", "unwatched", "watched"] as const).map((value, idx, arr) => (
                      <button key={value} onClick={() => onWatchFilterChange(value)}
                        className={`flex-1 py-1.5 text-sm font-medium transition-colors
                          ${watchFilter === value ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"}
                          ${idx < arr.length - 1 ? "border-r border-neutral-600" : ""}`}
                      >
                        {value === "all" ? "All" : value === "watched" ? "Watched" : "Unwatched"}
                      </button>
                    ))}
                  </div>
                </div>
                {(filterType !== "all" || watchFilter !== "all") && (
                  <button
                    onClick={() => { onFilterTypeChange("all"); onWatchFilterChange("all"); }}
                    className="text-xs text-neutral-400 hover:text-white transition-colors text-left"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* CENTER: desktop period nav */}
        <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center gap-1">
          <button onClick={onPrev} className="h-8 w-8 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors">
            <ChevronLeft />
          </button>
          <div className="px-3 text-base font-semibold text-neutral-100 whitespace-nowrap min-w-[180px] text-center">
            {centerLabel}
          </div>
          <button onClick={onNext} className="h-8 w-8 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors">
            <ChevronRight />
          </button>
        </div>

        {/* RIGHT: Sync + Watchlist */}
        <div className="ml-auto flex items-center gap-2">
          {user && (
            <button
              onClick={onSyncCalendar}
              title="Sync with Google Calendar, Outlook, or Apple Calendar"
              className="rounded-lg bg-neutral-700 border border-neutral-600 px-3 py-1.5 text-xs sm:text-sm font-medium text-neutral-200 hover:bg-neutral-600 hover:text-white transition-colors flex items-center gap-1.5"
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
                onClick={onOpenWatchlist}
                className="rounded-lg bg-neutral-700 border border-neutral-600 px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-neutral-200 hover:bg-neutral-600 hover:text-white transition-colors"
              >
                <span className="sm:hidden">List</span>
                <span className="hidden sm:inline">Watchlist</span>
              </button>
              <WatchlistModal
                isOpen={showWatchlist}
                onClose={onCloseWatchlist}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
