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
}

export default function CalendarMonthGrid({
  days,
  emptyCells,
  today,
  selectedDate,
  isLoading,
  onSelectDay,
}: Props) {
  return (
    <div className="flex flex-auto flex-col bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-neutral-800">
        {DAY_NAMES.map(([letter, full], i) => (
          <div key={i} className="py-3 px-2 sm:px-3">
            <span className="font-mono text-[10px] sm:text-[11px] tracking-[0.06em] uppercase text-neutral-500">
              <span className="sm:hidden">{letter}</span>
              <span className="hidden sm:inline">{letter}{full}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Grid body */}
      <div className="flex-auto bg-neutral-800">
        <div className="w-full grid grid-cols-7 gap-px">
          {emptyCells.map((_, idx) => (
            <div
              key={`empty-${idx}`}
              className="bg-neutral-950/60 min-h-[5rem] sm:min-h-[8rem] h-full"
            />
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
        </div>
      </div>
    </div>
  );
}
