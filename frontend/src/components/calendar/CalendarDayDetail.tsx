// frontend/src/components/calendar/CalendarDayDetail.tsx
import { RefObject } from "react";
import DayScheduleView from "../DayScheduleView";
import type { CalendarItem } from "../../utils/calendarUtils";

interface Props {
  containerRef?: RefObject<HTMLDivElement | null>;
  selectedDate: Date;
  items: CalendarItem[];
  headingSize?: "lg" | "xl";
}

export default function CalendarDayDetail({
  containerRef,
  selectedDate,
  items,
  headingSize = "lg",
}: Props) {
  return (
    <div ref={containerRef} className="border-t border-neutral-700 bg-neutral-900/50 px-4 sm:px-6 py-4 sm:py-6">
      <div className="flex items-center gap-3 mb-4">
        <h2
          className={`${headingSize === "xl" ? "text-xl" : "text-lg"} font-semibold text-neutral-100`}
        >
          {selectedDate.toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </h2>
        {items.length > 0 && (
          <span className="text-xs text-neutral-400 bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">
            {items.length} item{items.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {items.length > 0 ? (
          <DayScheduleView items={items} />
        ) : (
          <p className="text-neutral-500 italic">Nothing scheduled for this day.</p>
        )}
      </div>
    </div>
  );
}
