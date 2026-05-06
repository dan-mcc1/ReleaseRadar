// frontend/src/components/calendar/CalendarHeader.tsx
interface Props {
  upcomingThisMonth: number;
  todayItemCount: number;
  viewMode: "month" | "week" | "day";
  onGoToToday: () => void;
}

export default function CalendarHeader({ upcomingThisMonth, todayItemCount, viewMode, onGoToToday }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-700 px-4 sm:px-6 py-3 sm:py-4 bg-neutral-900">
      <div className="flex items-center gap-3">
        <span className="text-lg sm:text-2xl font-bold text-white">Release Radar</span>
        {viewMode === "month" && upcomingThisMonth > 0 && (
          <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-600/20 text-primary-400 border border-primary-600/30">
            {upcomingThisMonth} upcoming
          </span>
        )}
        {todayItemCount > 0 && (
          <button
            onClick={onGoToToday}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-primary-600 text-white hover:bg-primary-500 active:bg-primary-700 transition-colors shadow-sm"
          >
            {todayItemCount} airing today
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
      <button
        onClick={onGoToToday}
        className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-500 transition-colors"
      >
        Today
      </button>
    </header>
  );
}
