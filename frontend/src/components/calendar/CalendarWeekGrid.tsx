// frontend/src/components/calendar/CalendarWeekGrid.tsx
import CalendarDayCell from "./CalendarDayCell";
import type { DayItem } from "../../utils/calendarUtils";

const DAY_NAMES = [["S", "un"], ["M", "on"], ["T", "ue"], ["W", "ed"], ["Th", "u"], ["F", "ri"], ["S", "at"]];

interface Props {
  weekDays: DayItem[];
  today: Date;
  selectedDate: DayItem;
  isLoading: boolean;
  onSelectDay: (date: Date) => void;
}

export default function CalendarWeekGrid({ weekDays, today, selectedDate, isLoading, onSelectDay }: Props) {
  return (
    <div className="flex flex-auto flex-col">
      <div className="grid grid-cols-7 border-b border-neutral-700 bg-neutral-900">
        {weekDays.map((day, i) => {
          const isToday = day.date.toDateString() === today.toDateString();
          return (
            <div
              key={i}
              className={`flex flex-col items-center py-3 border-r border-neutral-700 last:border-r-0 ${isToday ? "bg-primary-600/20" : ""}`}
            >
              <span className={`text-xs uppercase tracking-wide font-medium ${isToday ? "text-primary-400" : "text-neutral-500"}`}>
                {DAY_NAMES[i][0]}{DAY_NAMES[i][1]}
              </span>
              <span className={`mt-1 text-xl font-bold ${isToday ? "text-primary-400" : "text-neutral-200"}`}>
                {day.date.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex-auto bg-neutral-700">
        <div className="w-full grid grid-cols-7 gap-px">
          {weekDays.map((day) => (
            <CalendarDayCell
              key={day.date.toISOString()}
              day={day}
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
