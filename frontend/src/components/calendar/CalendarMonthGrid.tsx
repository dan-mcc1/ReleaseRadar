// frontend/src/components/calendar/CalendarMonthGrid.tsx
import CalendarDayCell from "./CalendarDayCell";
import type { DayItem } from "../../utils/calendarUtils";

const DAY_NAMES = [["S", "un"], ["M", "on"], ["T", "ue"], ["W", "ed"], ["Th", "u"], ["F", "ri"], ["S", "at"]];

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
    <div className="flex flex-auto flex-col">
      <div className="grid grid-cols-7 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500 bg-neutral-900 border-b border-neutral-700">
        {DAY_NAMES.map(([letter, full], i) => (
          <div key={i} className="py-2.5">
            <span className="sm:hidden">{letter}</span>
            <span className="hidden sm:inline">{letter}{full}</span>
          </div>
        ))}
      </div>
      <div className="flex-auto bg-neutral-700 grid-rows-auto">
        <div className="w-full grid grid-cols-7 gap-px">
          {emptyCells.map((_, idx) => (
            <div key={`empty-${idx}`} className="bg-neutral-950 min-h-[5rem] sm:min-h-[8rem] max-h-[14rem]" />
          ))}
          {days.map((day) => (
            <CalendarDayCell
              key={day.date.toISOString()}
              day={day}
              isCompact
              isSelected={selectedDate.date.toDateString() === day.date.toDateString()}
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
