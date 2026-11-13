// frontend/src/components/calendar/CalendarSideRail.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_IMAGE_URL } from "../../constants";
import { apiFetch } from "../../utils/apiFetch";
import { toLocalISODate } from "../../utils/date";
import { useAuthUser } from "../../hooks/useAuthUser";
import {
  setCalendarItemWatched,
  type WatchTarget,
} from "../../hooks/useChunkedCalendar";
import { useToggleEpisode } from "../../hooks/api/useEpisodes";
import { useFriendsActivity } from "../../hooks/api/useActivity";
import { useToast } from "../Toast";
import { buttonClass } from "../ui";
import {
  episodeCode,
  episodeTag,
  episodeTitle,
  formatAirTimeToLocal,
  groupItemsByShow,
  itemDate,
} from "../../utils/calendarUtils";
import type {
  CalendarItem,
  DayItem,
  EpisodeTag,
  TvItem,
} from "../../utils/calendarUtils";
import ServicesHint from "./ServicesHint";

interface Props {
  todayItems: CalendarItem[];
  selectedDate: Date;
  selectedDateItems: CalendarItem[];
  onResetToToday: () => void;
  onSyncCalendar: () => void;
  /** Friend activity and calendar sync, which only the main calendar has. */
  showExtras?: boolean;
  /** The days after today that have releases; shown as "Next 7 days". */
  upcoming?: DayItem[];
  isLoading?: boolean;
}

const CARD = "bg-neutral-900 border border-neutral-800 rounded-surface p-4";
// Section headings inside the rail's panels.
const LABEL = "text-label font-semibold text-neutral-200";
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400";
const ROW = "flex items-center gap-3 py-2 border-t border-neutral-800 min-w-0";
const DETAIL_ROW = "flex items-start gap-3 py-2.5 border-t border-neutral-800 min-w-0";
const OVERVIEW = "mt-1 text-label text-neutral-400 line-clamp-3";
const TITLE = `block truncate rounded-sm text-sm font-semibold text-neutral-100 hover:text-primary-300 transition-colors ${FOCUS}`;
const SUB = "truncate text-xs text-neutral-400";
const SUB_LINK = `rounded-sm hover:text-neutral-100 transition-colors ${FOCUS}`;

const TAG_TONES: Record<EpisodeTag["tone"], string> = {
  premiere: "bg-primary-400 text-neutral-950",
  finale: "bg-warning-400 text-neutral-950",
  end: "bg-error-400 text-neutral-950",
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : "", m > 0 ? `${m}m` : ""].filter(Boolean).join(" ");
}

function airTime(item: TvItem): string | null {
  return formatAirTimeToLocal(
    item.showData.air_time,
    item.showData.air_timezone,
    item.air_date,
  );
}

function episodePath(item: TvItem): string {
  return `/tv/${item.showData.id}/episode/${item.season_number}/${item.episode_number}`;
}

function watchTarget(item: CalendarItem): WatchTarget {
  return item.type === "tv"
    ? {
        type: "tv",
        showId: item.showData.id,
        seasonNumber: item.season_number,
        episodeNumber: item.episode_number,
      }
    : { type: "movie", movieId: item.showData.id };
}

// Watched changes are sent one at a time, in the order they were made, so
// marking then unmarking an episode can't reach the server the other way round.
let sending: Promise<void> = Promise.resolve();

/**
 * Marks calendar items watched or unwatched. The calendar shows the change
 * straight away; the requests follow, and whatever didn't save is put back.
 */
function useMarkWatched() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const toggleEpisode = useToggleEpisode();
  const toast = useToast();

  async function send(item: CalendarItem, watched: boolean) {
    if (item.type === "tv") {
      await toggleEpisode.mutateAsync({
        showId: item.showData.id,
        seasonNumber: item.season_number,
        episodeNumber: item.episode_number,
        watched: !watched, // the hook takes the state being left
      });
      return;
    }
    const res = await apiFetch(`/watched/${watched ? "add" : "remove"}`, {
      method: watched ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content_type: "movie",
        content_id: item.showData.id,
      }),
    });
    if (!res.ok) throw new Error("Failed to update watched");
  }

  /** `name` is what the failure message calls them, e.g. the show's name. */
  return function markWatched(items: CalendarItem[], watched: boolean, name: string) {
    if (!user) return;
    const uid = user.uid;
    const show = (item: CalendarItem, value: boolean) =>
      setCalendarItemWatched(queryClient, uid, watchTarget(item), value);

    for (const item of items) show(item, watched);
    sending = sending.then(async () => {
      let failed = false;
      for (const item of items) {
        if (!failed) {
          try {
            await send(item, watched);
            continue;
          } catch {
            failed = true;
          }
        }
        show(item, !watched); // this one and the ones after it never saved
      }
      if (failed) toast.error(`Couldn't update ${name}. Try again.`);
    });
  };
}

function CheckButton({
  name,
  watched,
  onClick,
}: {
  /** What it marks, e.g. "S5 E7 of Abbott Elementary". */
  name: string;
  watched: boolean;
  onClick: () => void;
}) {
  const label = watched ? `Mark ${name} unwatched` : `Mark ${name} watched`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={watched}
      aria-label={label}
      title={label}
      className={`flex-none w-11 h-11 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${FOCUS} ${
        watched
          ? "bg-primary-500 border-primary-500 text-neutral-950 hover:bg-primary-400 hover:border-primary-400"
          : "border-neutral-700 text-neutral-300 hover:border-primary-400 hover:text-primary-300"
      }`}
    >
      <Tick className="w-4 h-4" />
    </button>
  );
}

function Tick({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Thumb({
  to,
  path,
  large = false,
}: {
  to: string;
  path: string | null | undefined;
  /** The day card's size; it grows with the card. */
  large?: boolean;
}) {
  // The title beside it links to the same place, so this one stays out of
  // the tab order and the accessibility tree.
  return (
    <Link
      to={to}
      tabIndex={-1}
      aria-hidden="true"
      className={`relative flex-none aspect-video rounded-lg overflow-hidden bg-neutral-800 border border-white/10 ${
        large ? "w-28 @min-[480px]:w-40" : "w-24"
      }`}
    >
      {path && (
        <img
          src={`${BASE_IMAGE_URL}/w300${path}`}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </Link>
  );
}

function TagChip({ tag }: { tag: EpisodeTag }) {
  return (
    <span
      className={`flex-none rounded-full px-2 py-0.5 text-caption font-semibold ${TAG_TONES[tag.tone]}`}
    >
      {tag.label}
    </span>
  );
}

/**
 * One episode in the day card: its own still, name and overview. `grouped`
 * is an episode listed under its show's heading, which already names the show.
 */
function EpisodeDetail({
  episode,
  grouped = false,
  shortCode = false,
  canMark,
  onMark,
}: {
  episode: TvItem;
  grouped?: boolean;
  /** "E3" instead of "S2 E3", when the heading gives the season. */
  shortCode?: boolean;
  canMark: boolean;
  onMark: () => void;
}) {
  const show = episode.showData;
  const to = episodePath(episode);
  const title = episodeTitle(episode.name);
  const code = `S${episode.season_number} E${episode.episode_number}`;
  const time = airTime(episode);
  const tag = episodeTag([episode]);

  return (
    <div className={grouped ? "flex items-start gap-3 py-2 min-w-0" : DETAIL_ROW}>
      <Thumb to={to} path={episode.still_path ?? show.backdrop_path} large />
      <div className="flex-1 min-w-0">
        {grouped ? (
          <Link to={to} className={TITLE}>
            <span className="font-mono">
              {shortCode ? `E${episode.episode_number}` : code}
            </span>
            {title && ` · ${title}`}
          </Link>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <Link to={`/tv/${show.id}`} className={`${TITLE} min-w-0`}>
                {show.name}
              </Link>
              {tag && <TagChip tag={tag} />}
            </div>
            <p className={SUB}>
              <Link to={to} className={SUB_LINK}>
                <span className="font-mono text-neutral-200">{code}</span>
                {title && ` · ${title}`}
              </Link>
              {time && ` · ${time}`}
            </p>
          </>
        )}
        {episode.overview && <p className={OVERVIEW}>{episode.overview}</p>}
      </div>
      {canMark && (
        <CheckButton
          name={`${code} of ${show.name}`}
          watched={episode.is_watched}
          onClick={onMark}
        />
      )}
    </div>
  );
}

/** Whether there's anything to say about an episode beyond its number. */
function hasDetails(episode: TvItem): boolean {
  return episodeTitle(episode.name) !== null || !!episode.overview;
}

/**
 * An episode with no name or overview yet, as a chip: a row for it would be
 * a still beside an episode number. On a day that has arrived the chip is
 * its watched button.
 */
function EpisodeChip({
  episode,
  shortCode,
  canMark,
  onMark,
}: {
  episode: TvItem;
  shortCode: boolean;
  canMark: boolean;
  onMark: () => void;
}) {
  const code = `S${episode.season_number} E${episode.episode_number}`;
  const text = shortCode ? `E${episode.episode_number}` : code;
  if (!canMark) {
    return (
      <span className="h-8 px-3 rounded-full border border-neutral-800 inline-flex items-center font-mono text-xs text-neutral-300">
        {text}
      </span>
    );
  }
  const name = `${code} of ${episode.showData.name}`;
  const label = episode.is_watched ? `Mark ${name} unwatched` : `Mark ${name} watched`;
  return (
    <button
      type="button"
      onClick={onMark}
      aria-pressed={episode.is_watched}
      aria-label={label}
      title={label}
      className={`h-10 pl-3.5 pr-3 rounded-full border inline-flex items-center gap-2 font-mono text-xs transition-colors cursor-pointer ${FOCUS} ${
        episode.is_watched
          ? "bg-primary-500 border-primary-500 text-neutral-950 font-semibold hover:bg-primary-400 hover:border-primary-400"
          : "border-neutral-700 text-neutral-200 hover:border-primary-400 hover:text-primary-300"
      }`}
    >
      {text}
      <Tick className="w-3.5 h-3.5" />
    </button>
  );
}

// Episodes of one drop listed before "Show N more".
const EPISODES_SHOWN = 3;

/**
 * One title on a day: a movie, an episode, or a show's several episodes.
 * `detailed` is the day card: episode stills, overviews and, for a day that
 * has arrived, the watched buttons. Otherwise it's one short line per title.
 */
function ReleaseRow({ items, detailed }: { items: CalendarItem[]; detailed: boolean }) {
  const markWatched = useMarkWatched();
  const [expanded, setExpanded] = useState(false);

  const first = items[0];
  // You can't have watched what hasn't come out.
  const canMark = detailed && itemDate(first) <= toLocalISODate(new Date());

  if (first.type === "movie") {
    const to = `/movie/${first.showData.id}`;
    return (
      <div className={detailed ? DETAIL_ROW : ROW}>
        <Thumb to={to} path={first.showData.backdrop_path} large={detailed} />
        <div className="flex-1 min-w-0">
          <Link to={to} className={TITLE}>
            {first.title}
          </Link>
          <p className={SUB}>
            Movie{first.runtime > 0 && ` · ${formatRuntime(first.runtime)}`}
          </p>
          {detailed && first.overview && <p className={OVERVIEW}>{first.overview}</p>}
        </div>
        {canMark && (
          <CheckButton
            name={first.title}
            watched={first.is_watched}
            onClick={() => markWatched([first], !first.is_watched, first.title)}
          />
        )}
      </div>
    );
  }

  const episodes = items as TvItem[];
  const show = first.showData;
  const showPath = `/tv/${show.id}`;
  const tag = episodeTag(episodes);
  const time = airTime(first);
  const code = episodeCode(episodes);

  if (!detailed) {
    return (
      <div className={ROW}>
        <Thumb to={showPath} path={show.backdrop_path} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link to={showPath} className={`${TITLE} min-w-0`}>
              {show.name}
            </Link>
            {tag && <TagChip tag={tag} />}
          </div>
          <p className={SUB}>
            {episodes.length > 1 && `${episodes.length} episodes`}
            {episodes.length > 1 && code && " · "}
            {code && <span className="font-mono text-neutral-200">{code}</span>}
            {time && ` · ${time}`}
          </p>
        </div>
      </div>
    );
  }

  if (episodes.length === 1) {
    return (
      <EpisodeDetail
        episode={first}
        canMark={canMark}
        onMark={() => markWatched([first], !first.is_watched, show.name)}
      />
    );
  }

  const allWatched = episodes.every((e) => e.is_watched);
  // Episodes with a name or overview get a row each; the rest get a chip.
  const known = episodes.filter(hasDetails);
  const bare = episodes.filter((e) => !hasDetails(e));
  // Not worth a "Show 1 more".
  const collapsible = known.length > EPISODES_SHOWN + 1;
  const listed = collapsible && !expanded ? known.slice(0, EPISODES_SHOWN) : known;
  // With no rows under it, the heading carries the show's picture and chips.
  const headingOnly = known.length === 0;
  // Chips that can't be pressed only repeat the heading's "E1–E3".
  const chips = bare.length > 0 && (canMark || !headingOnly) && (
    <div className="mt-2 mb-1.5 flex flex-wrap gap-2">
      {bare.map((episode) => (
        <EpisodeChip
          key={episode.id}
          episode={episode}
          shortCode={code !== null}
          canMark={canMark}
          onMark={() => markWatched([episode], !episode.is_watched, show.name)}
        />
      ))}
    </div>
  );
  return (
    <div className="border-t border-neutral-800 pt-2.5 pb-1 flex flex-col">
      <div
        className={`flex gap-3 min-w-0 ${headingOnly ? "items-start pb-1.5" : "items-center"}`}
      >
        {headingOnly && <Thumb to={showPath} path={show.backdrop_path} large />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link to={showPath} className={`${TITLE} min-w-0`}>
              {show.name}
            </Link>
            {tag && <TagChip tag={tag} />}
          </div>
          <p className={SUB}>
            {episodes.length} new episodes
            {code && (
              <>
                {" · "}
                <span className="font-mono text-neutral-200">{code}</span>
              </>
            )}
            {time && ` · ${time}`}
          </p>
          {headingOnly && chips}
        </div>
        {canMark && (
          // Words, not another tick: each episode under it has its own.
          <button
            type="button"
            onClick={() =>
              markWatched(
                allWatched ? episodes : episodes.filter((e) => !e.is_watched),
                !allWatched,
                show.name,
              )
            }
            aria-label={`Mark all ${episodes.length} episodes of ${show.name} ${
              allWatched ? "unwatched" : "watched"
            }`}
            className={`flex-none h-9 px-3 rounded-lg border border-neutral-700 text-xs font-medium text-neutral-200 hover:border-primary-400 hover:text-primary-300 transition-colors cursor-pointer ${FOCUS}`}
          >
            {allWatched ? "Unmark all" : "Mark all"}
          </button>
        )}
      </div>
      {listed.map((episode) => (
        <EpisodeDetail
          key={episode.id}
          episode={episode}
          grouped
          shortCode={code !== null}
          canMark={canMark}
          onMark={() => markWatched([episode], !episode.is_watched, show.name)}
        />
      ))}
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={`self-start py-2 rounded-sm text-caption font-medium text-neutral-400 hover:text-neutral-100 transition-colors cursor-pointer ${FOCUS}`}
        >
          {expanded ? "Show fewer" : `Show ${known.length - EPISODES_SHOWN} more`}
        </button>
      )}
      {!headingOnly && chips}
    </div>
  );
}

function ReleaseRows({ items, detailed }: { items: CalendarItem[]; detailed: boolean }) {
  return (
    <>
      {groupItemsByShow(items).map((g) =>
        g.kind === "single" ? (
          <ReleaseRow
            key={`${g.item.type}-${g.item.id}`}
            items={[g.item]}
            detailed={detailed}
          />
        ) : (
          <ReleaseRow
            key={`show-${g.showId}-${itemDate(g.items[0])}`}
            items={g.items}
            detailed={detailed}
          />
        ),
      )}
    </>
  );
}

/** "5 episodes from 3 shows · 1 movie" */
function summarize(items: CalendarItem[]): string {
  const episodes = items.filter((i) => i.type === "tv");
  const shows = new Set(episodes.map((e) => e.showData.id)).size;
  const movies = items.length - episodes.length;
  const parts: string[] = [];
  if (episodes.length > 0) {
    parts.push(
      shows === episodes.length
        ? plural(episodes.length, "episode")
        : `${plural(episodes.length, "episode")} from ${plural(shows, "show")}`,
    );
  }
  if (movies > 0) parts.push(plural(movies, "movie"));
  return parts.join(" · ");
}

function RowSkeleton() {
  return (
    <div className={`${ROW} animate-pulse`} aria-hidden="true">
      <div className="flex-none w-24 aspect-video rounded-lg bg-neutral-800" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-2/3 rounded bg-neutral-800" />
        <div className="h-2.5 w-1/3 rounded bg-neutral-800" />
      </div>
    </div>
  );
}

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function UpcomingCard({ days }: { days: DayItem[] }) {
  return (
    <section className={CARD} aria-labelledby="calendar-next-week">
      <h2 id="calendar-next-week" className={LABEL}>
        Next 7 days
      </h2>
      {days.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">Nothing new in the next week.</p>
      ) : (
        days.map((day) => (
          <div key={day.date.toISOString()}>
            <h3 className="mt-3 mb-1.5 text-caption font-semibold text-neutral-400 tabular">
              {weekdayFormatter.format(day.date)} {day.date.getDate()}
            </h3>
            <ReleaseRows items={day.items ?? []} detailed={false} />
          </div>
        ))
      )}
    </section>
  );
}

type ActivityType =
  | "watched"
  | "currently_watching"
  | "want_to_watch"
  | "rated"
  | "episode_watched";

interface ActivityItem {
  id: number;
  username: string | null;
  activity_type: ActivityType;
  content_type: "movie" | "tv";
  content_id: number;
  content_title: string | null;
  content_poster_path: string | null;
  rating?: number | null;
  created_at: string;
}

const ACTIVITY_VERBS: Record<ActivityType, string> = {
  watched: "finished",
  currently_watching: "started",
  want_to_watch: "wants to watch",
  rated: "rated",
  episode_watched: "watched an episode of",
};

function timeAgo(isoString: string): string {
  const mins = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return plural(hours, "hour") + " ago";
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function FriendActivityCard() {
  const { data, isLoading } = useFriendsActivity();
  const items: ActivityItem[] = Array.isArray(data) ? data.slice(0, 4) : [];

  return (
    <section className={CARD} aria-labelledby="calendar-friend-activity">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <h2 id="calendar-friend-activity" className={LABEL}>
          Friend activity
        </h2>
        {items.length > 0 && (
          <Link
            to="/activity"
            className={`rounded-sm text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors ${FOCUS}`}
          >
            See all
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3 pt-1.5 animate-pulse" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-8 h-12 rounded-md bg-neutral-800 flex-none" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 rounded bg-neutral-800" />
                <div className="h-2.5 w-1/3 rounded bg-neutral-800" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="pt-1.5 text-sm text-neutral-400">
          What your friends watch and rate will show up here.
        </p>
      ) : (
        items.map((item, index) => {
          const to = `/${item.content_type === "movie" ? "movie" : "tv"}/${item.content_id}`;
          return (
            <div
              key={item.id}
              className={`${ROW} ${index === 0 ? "border-t-0" : ""}`}
            >
              <Link
                to={to}
                tabIndex={-1}
                aria-hidden="true"
                className="flex-none w-8 aspect-[2/3] rounded-md overflow-hidden bg-neutral-800 border border-white/10"
              >
                {item.content_poster_path && (
                  <img
                    src={`${BASE_IMAGE_URL}/w185${item.content_poster_path}`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <Link
                  to={to}
                  className={`block truncate rounded-sm text-sm font-medium text-neutral-100 hover:text-primary-300 transition-colors ${FOCUS}`}
                >
                  {item.username ?? "Someone"} {ACTIVITY_VERBS[item.activity_type]}{" "}
                  {item.content_title ?? "a title"}
                </Link>
                <p className={SUB}>
                  {item.rating != null && `Rated it ${item.rating} of 5 · `}
                  {timeAgo(item.created_at)}
                </p>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

const selectedDayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default function CalendarSideRail({
  todayItems,
  selectedDate,
  selectedDateItems,
  onResetToToday,
  onSyncCalendar,
  showExtras = true,
  upcoming,
  isLoading = false,
}: Props) {
  const isToday = selectedDate.toDateString() === new Date().toDateString();
  const dayItems = isToday ? todayItems : selectedDateItems;

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-neutral-800)_transparent]">
      {/* The selected day, which is today until another is picked */}
      <section
        data-tour="calendar-episode-list"
        className={`${CARD} @container`}
        aria-labelledby="calendar-day-heading"
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="calendar-day-heading"
            className="text-title font-semibold text-neutral-50"
          >
            {isToday ? "Today" : selectedDayFormatter.format(selectedDate)}
          </h2>
          {!isToday && (
            <button
              type="button"
              onClick={onResetToToday}
              className={`flex-none h-9 px-3 rounded-lg border border-neutral-700 bg-neutral-800 text-xs font-medium text-neutral-200 hover:bg-neutral-700 hover:text-white transition-colors cursor-pointer ${FOCUS}`}
            >
              Back to today
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="mt-3">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : dayItems.length === 0 ? (
          <p className="mt-1 text-label text-neutral-400">Nothing scheduled.</p>
        ) : (
          <>
            <p className="mt-1 mb-2.5 text-label text-neutral-400">
              {summarize(dayItems)}
            </p>
            <ReleaseRows items={dayItems} detailed />
          </>
        )}
      </section>

      {upcoming && !isLoading && <UpcomingCard days={upcoming} />}

      {showExtras && <ServicesHint />}

      {showExtras && <FriendActivityCard />}

      {showExtras && (
        <section className={`${CARD} flex flex-wrap items-center gap-x-4 gap-y-3`}>
          <div className="flex-1 basis-48 min-w-0">
            <h2 className="text-sm font-semibold text-neutral-100">
              Sync with your calendar
            </h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              Drop releases straight into Google, iCal or Outlook.
            </p>
          </div>
          <button
            type="button"
            onClick={onSyncCalendar}
            className={buttonClass("secondary")}
          >
            Connect
          </button>
        </section>
      )}
    </div>
  );
}
