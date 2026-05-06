// frontend/src/components/calendar/CalendarDayCell.tsx
import { BASE_IMAGE_URL } from "../../constants";
import { toLocalISODate } from "../../utils/date";
import { formatAirTimeToLocal } from "../../utils/calendarUtils";
import type { CalendarItem, DayItem } from "../../utils/calendarUtils";

interface Props {
  day: DayItem;
  isCompact?: boolean;
  isSelected: boolean;
  isToday: boolean;
  isLoading: boolean;
  onSelect: (date: Date) => void;
}

export default function CalendarDayCell({
  day,
  isCompact = false,
  isSelected,
  isToday,
  isLoading,
  onSelect,
}: Props) {
  const isoDate = toLocalISODate(day.date);
  const cellItems: CalendarItem[] = day.items ?? [];

  return (
    <div
      onClick={() => onSelect(day.date)}
      className={`relative px-1 sm:px-2 py-1 sm:py-2 overflow-y-auto border border-neutral-700/50 cursor-pointer transition-colors duration-150 ${
        isCompact ? "min-h-20 sm:min-h-32" : "min-h-32 sm:min-h-48"
      } ${
        isToday
          ? "bg-primary-900 font-bold"
          : isSelected
            ? "bg-neutral-700 ring-2 ring-inset ring-primary-500"
            : "bg-neutral-800 hover:bg-neutral-750"
      }`}
    >
      <time
        dateTime={isoDate}
        className={`text-xs sm:text-sm font-semibold ${
          isToday ? "text-white" : isSelected ? "text-primary-300" : "text-neutral-300"
        }`}
      >
        {day.date.getDate()}
      </time>

      {isLoading
        ? Array.from({ length: day.date.getDate() % 3 === 0 ? 2 : 1 }).map((_, idx) => (
            <div key={idx} className="mt-1 h-8 sm:h-14 rounded-md bg-neutral-700 animate-pulse" />
          ))
        : cellItems.map((item, idx) => {
            const title =
              "episode_number" in item
                ? `${item.showData.name} - ${item.name}`
                : item.title;
            return (
              <div key={idx} className="relative mt-1 h-8 sm:h-14 rounded-md overflow-hidden group">
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
                {item.type === "tv" &&
                  formatAirTimeToLocal(item.showData.air_time, item.showData.air_timezone) && (
                    <div className="absolute bottom-0.5 right-1 z-10 hidden sm:block text-white/75 text-[7px] font-medium drop-shadow">
                      {formatAirTimeToLocal(item.showData.air_time, item.showData.air_timezone)}
                    </div>
                  )}
              </div>
            );
          })}
    </div>
  );
}
