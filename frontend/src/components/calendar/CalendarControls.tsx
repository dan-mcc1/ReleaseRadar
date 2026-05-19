// frontend/src/components/calendar/CalendarControls.tsx
import { useRef, useState } from "react";
import { User } from "firebase/auth";

export type ViewMode = "month" | "week" | "day";

interface Props {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  filterType: "all" | "tv" | "movie";
  onFilterTypeChange: (v: "all" | "tv" | "movie") => void;
  watchFilter: "all" | "watched" | "unwatched";
  onWatchFilterChange: (v: "all" | "watched" | "unwatched") => void;
  currentlyWatchingFilter: boolean;
  onCurrentlyWatchingFilterChange: (v: boolean) => void;
  centerLabel: string;
  onPrev: () => void;
  onNext: () => void;
  user: User | null;
  onSyncCalendar: () => void;
  showActions?: boolean;
}

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

export default function CalendarControls({
  viewMode,
  onViewChange,
  filterType,
  onFilterTypeChange,
  watchFilter,
  onWatchFilterChange,
  currentlyWatchingFilter,
  onCurrentlyWatchingFilterChange,
  centerLabel,
  onPrev,
  onNext,
}: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const hasActiveFilters = filterType !== "all" || watchFilter !== "all" || currentlyWatchingFilter;

  return (
    <div className="border-b border-neutral-800 bg-neutral-950">
      {/* Mobile period nav */}
      <div className="flex lg:hidden items-center justify-between px-6 pt-3 pb-1.5">
        <button
          onClick={onPrev}
          className="h-9 w-9 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors border border-neutral-800"
        >
          <ChevronLeft />
        </button>
        <span className="text-sm font-semibold text-neutral-100">{centerLabel}</span>
        <button
          onClick={onNext}
          className="h-9 w-9 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors border border-neutral-800"
        >
          <ChevronRight />
        </button>
      </div>

      <div className="flex items-center gap-3 px-6 lg:px-10 py-3">
        {/* View mode toggle (mobile / ShelfCalendar usage) */}
        <div className="flex lg:hidden items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
          {(["day", "week", "month"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onViewChange(mode)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                viewMode === mode
                  ? "bg-neutral-700 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {mode === "month" ? "Mo" : mode === "week" ? "Wk" : "Day"}
            </button>
          ))}
        </div>

        {/* Filter dropdown */}
        <div className="relative" ref={filterRef}>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showFilters || hasActiveFilters
                ? "bg-neutral-800 border-neutral-700 text-white"
                : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2" />
            </svg>
            <span>Filters</span>
            {hasActiveFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary-400" />
            )}
          </button>

          {showFilters && (
            <div className="absolute left-0 top-full mt-2 z-20 w-56 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl p-3 flex flex-col gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-widest uppercase text-neutral-500 mb-2">Type</p>
                <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
                  {(["all", "movie", "tv"] as const).map((value, idx, arr) => (
                    <button
                      key={value}
                      onClick={() => onFilterTypeChange(value)}
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
                      onClick={() => onWatchFilterChange(value)}
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
              <div>
                <p className="font-mono text-[10px] tracking-widest uppercase text-neutral-500 mb-2">Show</p>
                <button
                  onClick={() => onCurrentlyWatchingFilterChange(!currentlyWatchingFilter)}
                  className={`w-full flex items-center gap-2 py-1.5 px-3 text-xs font-medium rounded-lg border transition-colors ${
                    currentlyWatchingFilter
                      ? "bg-highlight-600 border-highlight-500 text-white"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${currentlyWatchingFilter ? "bg-white animate-pulse" : "bg-neutral-500"}`} />
                  Currently Watching only
                </button>
              </div>
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    onFilterTypeChange("all");
                    onWatchFilterChange("all");
                    onCurrentlyWatchingFilterChange(false);
                  }}
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
  );
}
