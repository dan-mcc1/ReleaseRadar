import type { ServiceOverview, ServiceRelease } from "../hooks/api/useStreamingServices";
import { parseLocalDate, toLocalISODate } from "./date";
import { formatAirDate } from "./episodes";

/** "Season 5 premiere", "New episode · S2 E5", "Series premiere", "Movie". */
export function releaseLabel(r: ServiceRelease): string {
  switch (r.kind) {
    case "series_premiere":
      return "Series premiere";
    case "season_premiere":
      return `Season ${r.season_number} premiere`;
    case "episode":
      return `New episode · S${r.season_number} E${r.episode_number}`;
    default:
      return "Movie";
  }
}

export function daysUntil(iso: string, today = toLocalISODate(new Date())): number {
  const ms = parseLocalDate(iso).getTime() - parseLocalDate(today).getTime();
  return Math.round(ms / 86_400_000);
}

/** "Today", "Tomorrow", "In 6 days", then the date itself. */
export function whenLabel(iso: string, today = toLocalISODate(new Date())): string {
  const days = daysUntil(iso, today);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  return formatAirDate(iso);
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", or the date. */
export function agoLabel(atIso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(atIso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `on ${formatAirDate(toLocalISODate(new Date(atIso)))}`;
}

function months(days: number): string {
  const m = Math.round(days / 30);
  return m === 1 ? "month" : `${m} months`;
}

/** The one sentence under a service's name explaining its verdict. */
export function verdictLine(
  s: ServiceOverview,
  lookaheadDays: number,
  recentDays: number,
  now = new Date(),
): string {
  const next = s.next_release;
  if (s.verdict === "paused") {
    const since = s.paused_at ? `Paused since ${formatAirDate(toLocalISODate(new Date(s.paused_at)))}.` : "Paused.";
    // Reminders are for premieres and movies, not each weekly episode.
    const premiere = s.next_premiere;
    if (premiere) {
      return `${since} We'll remind you a week before ${premiere.title} (${formatAirDate(premiere.date)}).`;
    }
    return `${since} We'll remind you a week before something from your list premieres here.`;
  }
  if (s.verdict === "pause") {
    const quiet = `Nothing from your list in the next ${months(lookaheadDays)}, and you haven't used it in ${recentDays} days.`;
    // Anything sooner would have made it "keep", so this is always a date.
    if (next) return `${quiet} Next up: ${next.title} on ${formatAirDate(next.date)}.`;
    return `${quiet} Nothing on your list is announced for it yet.`;
  }
  if (s.upcoming_count > 0) {
    const n = s.upcoming_count;
    return `${n} ${n === 1 ? "title" : "titles"} from your list in the next ${months(lookaheadDays)}.`;
  }
  const used = s.last_used ? agoLabel(s.last_used.at, now) : "recently";
  return `Nothing new from your list in the next ${months(lookaheadDays)}, but you used it ${used}.`;
}
