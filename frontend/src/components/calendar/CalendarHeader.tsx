// frontend/src/components/calendar/CalendarHeader.tsx
interface Props {
  upcomingThisMonth: number;
  todayItemCount: number;
  viewMode: "month" | "week" | "day";
  onGoToToday: () => void;
}

export default function CalendarHeader({
  upcomingThisMonth,
  todayItemCount,
  viewMode,
  onGoToToday,
}: Props) {
  return (
    <header
      data-tour="calendar-view"
      className="px-6 lg:px-10 py-4 bg-neutral-950 border-b border-neutral-800 flex items-center gap-4"
    >
      <div>
        <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-neutral-500">
          Your calendar
          {viewMode === "month" && upcomingThisMonth > 0 && (
            <span className="text-neutral-600">
              {" "}
              · {upcomingThisMonth} upcoming releases this month
            </span>
          )}
        </p>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {todayItemCount > 0 && (
          <button
            onClick={onGoToToday}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-500/15 text-primary-400 border border-primary-500/25 hover:bg-primary-500/25 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
            {todayItemCount} airing today
          </button>
        )}
        <button
          onClick={onGoToToday}
          className="px-4 py-1.5 text-sm font-semibold rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white transition-colors"
        >
          Today
        </button>
      </div>
    </header>
  );
}
