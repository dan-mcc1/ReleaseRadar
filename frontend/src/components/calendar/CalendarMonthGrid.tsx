// frontend/src/components/calendar/CalendarMonthGrid.tsx
import CalendarDayCell from "./CalendarDayCell";
import type { DayItem } from "../../utils/calendarUtils";

const DAY_NAMES = [
  ["S", "un"],
  ["M", "on"],
  ["T", "ue"],
  ["W", "ed"],
  ["Th", "u"],
  ["F", "ri"],
  ["S", "at"],
];

interface Props {
  days: DayItem[];
  emptyCells: null[];
  today: Date;
  selectedDate: DayItem;
  isLoading: boolean;
  onSelectDay: (date: Date) => void;
  /** Names the grid for screen readers, e.g. "November 2026". */
  label?: string;
}

const BLANK = "bg-neutral-950/60 min-h-20 sm:min-h-[156px]";

export default function CalendarMonthGrid({
  days,
  emptyCells,
  today,
  selectedDate,
  isLoading,
  onSelectDay,
  label,
}: Props) {
  // Blank cells after the last day too, so the final week is a full row.
  const trailing = (7 - ((emptyCells.length + days.length) % 7)) % 7;

  return (
    <section
      aria-label={label}
      className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden"
    >
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-neutral-800">
        {DAY_NAMES.map(([letter, rest], i) => (
          <div
            key={i}
            className="px-2 sm:px-3 py-2.5 font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-500"
          >
            {letter}
            <span className="hidden sm:inline">{rest}</span>
          </div>
        ))}
      </div>

      {/* Grid body: the gaps show the darker backing as hairlines. */}
      <div className="grid grid-cols-7 gap-px bg-neutral-800">
        {emptyCells.map((_, idx) => (
          <div key={`before-${idx}`} className={BLANK} />
        ))}
        {days.map((day) => (
          <CalendarDayCell
            key={day.date.toISOString()}
            day={day}
            isCompact
            isSelected={
              selectedDate.date.toDateString() === day.date.toDateString()
            }
            isToday={day.date.toDateString() === today.toDateString()}
            isLoading={isLoading}
            onSelect={onSelectDay}
          />
        ))}
        {Array.from({ length: trailing }, (_, idx) => (
          <div key={`after-${idx}`} className={BLANK} />
        ))}
      </div>
    </section>
  );
}
