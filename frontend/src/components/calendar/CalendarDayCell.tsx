// frontend/src/components/calendar/CalendarDayCell.tsx
import { BASE_IMAGE_URL } from "../../constants";
import { toLocalISODate } from "../../utils/date";
import {
  episodeCode,
  episodeTag,
  formatAirTimeToLocal,
  groupItemsByShow,
} from "../../utils/calendarUtils";
import type { CalendarItem, DayItem, TvItem } from "../../utils/calendarUtils";

interface Props {
  day: DayItem;
  isCompact?: boolean;
  isSelected: boolean;
  isToday: boolean;
  isLoading: boolean;
  onSelect: (date: Date) => void;
}

const dayLabelFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

/**
 * One title on a day: a movie, an episode, or several episodes of one show
 * (counted in the corner). It's a picture only: the day's button covers the
 * whole cell, and picking the day lists its releases, with their links,
 * beside the grid.
 */
function Tile({ items }: { items: CalendarItem[] }) {
  const first = items[0];
  const show = first.showData;
  const stacked = items.length > 1;

  let name: string;
  let badge: string;
  let extra: string | null = null;
  let time: string | null = null;
  if (first.type === "movie") {
    name = first.title;
    badge = "Movie";
  } else {
    const episodes = items as TvItem[];
    name = first.showData.name;
    const code = episodeCode(episodes);
    badge = code ?? `${items.length} episodes`;
    extra = stacked ? null : (episodeTag(episodes)?.short ?? null);
    time = formatAirTimeToLocal(
      first.showData.air_time,
      first.showData.air_timezone,
      first.air_date,
    );
  }

  return (
    <div aria-hidden="true" className="relative mt-1.5 h-10 sm:h-[78px] rounded-md sm:rounded-lg">
      <span className="absolute inset-0 rounded-[inherit] overflow-hidden bg-neutral-800">
        {show.backdrop_path && (
          <img
            src={`${BASE_IMAGE_URL}/w780${show.backdrop_path}`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <span className="absolute inset-0 bg-black/45" />
      </span>
      <span className="absolute inset-0 flex items-center justify-center px-1.5 sm:px-2 sm:pb-4">
        {show.logo_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w300${show.logo_path}`}
            alt=""
            className="max-h-5 sm:max-h-9 max-w-full object-contain drop-shadow-md"
          />
        ) : (
          <span className="text-white text-caption sm:text-label font-semibold text-center line-clamp-2 leading-tight drop-shadow">
            {name}
          </span>
        )}
      </span>
      {stacked && (
        <span className="absolute top-1.5 right-1.5 hidden sm:block rounded px-1.5 py-[3px] bg-black/80 text-caption leading-none font-medium text-white tabular">
          {items.length} eps
        </span>
      )}
      <span className="absolute inset-x-1.5 bottom-1.5 hidden sm:flex items-end justify-between gap-1.5 text-caption leading-none tabular">
        <span className="min-w-0 truncate rounded px-1.5 py-[3px] bg-black/80 font-mono text-white">
          {badge}
          {extra && <span className="hidden @min-[210px]:inline"> · {extra}</span>}
        </span>
        {time && (
          <span className="flex-shrink-0 hidden @min-[150px]:block pb-[3px] text-neutral-100 drop-shadow">
            {time}
          </span>
        )}
      </span>
    </div>
  );
}

export default function CalendarDayCell({
  day,
  isCompact = false,
  isSelected,
  isToday,
  isLoading,
  onSelect,
}: Props) {
  const cellItems: CalendarItem[] = day.items ?? [];
  const groups = groupItemsByShow(cellItems);
  const count = cellItems.length;

  return (
    <div
      className={`@container relative px-1 sm:px-2 py-1.5 sm:py-2 transition-colors duration-150 ${
        isCompact ? "min-h-20 sm:min-h-[156px]" : "min-h-32 sm:min-h-48"
      } ${
        isToday
          ? "bg-primary-500/[0.13] ring-1 ring-inset ring-primary-500"
          : isSelected
            ? "bg-neutral-800 ring-1 ring-inset ring-neutral-500"
            : "bg-neutral-900 hover:bg-neutral-850"
      }`}
    >
      {/* The day's button covers the whole cell, tiles included. */}
      <button
        type="button"
        onClick={() => onSelect(day.date)}
        aria-pressed={isSelected}
        aria-label={`${dayLabelFormatter.format(day.date)}${
          count > 0 ? `, ${count} ${count === 1 ? "release" : "releases"}` : ""
        }`}
        className={`block cursor-pointer text-label tabular after:absolute after:inset-0 after:z-10 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary-400 ${
          isToday
            ? "font-semibold text-primary-300"
            : isSelected
              ? "font-medium text-neutral-100"
              : "font-medium text-neutral-400"
        }`}
      >
        <time dateTime={toLocalISODate(day.date)}>
          {day.date.getDate()}
        </time>
        {isToday && <span className="hidden @min-[110px]:inline"> · Today</span>}
      </button>

      {isLoading
        ? Array.from({ length: day.date.getDate() % 3 === 0 ? 2 : 1 }).map(
            (_, idx) => (
              <div
                key={idx}
                className="mt-1.5 h-10 sm:h-[78px] rounded-md sm:rounded-lg bg-neutral-800 animate-pulse"
              />
            ),
          )
        : groups.map((g) =>
            g.kind === "single" ? (
              <Tile key={`${g.item.type}-${g.item.id}`} items={[g.item]} />
            ) : (
              <Tile key={`show-${g.showId}`} items={g.items} />
            ),
          )}
    </div>
  );
}
