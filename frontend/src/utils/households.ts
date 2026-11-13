import type { EpisodeRef } from "../hooks/api/useHouseholds";

/** What to call a person: their display name, else their username. */
export function personName(p: { display_name: string | null; username: string }): string {
  return p.display_name || p.username;
}

/** "S2 E4" */
export function episodeCode(e: EpisodeRef): string {
  return `S${e.season_number} E${e.episode_number}`;
}

/** "Logged for 3 people" */
export function loggedMessage(count: number): string {
  return `Logged for ${count} ${count === 1 ? "person" : "people"}`;
}

/** A text input matching Button's height and radius. */
export const inputClass =
  "h-control min-w-0 rounded-control border border-neutral-700 bg-neutral-900 px-3 text-body text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400";

export const NAME_MAX = 60;

/** Why a household pick was suggested: "Because you both watched Severance". */
export function pickReason(
  pick: { because: { title: string; reason: "watched" | "lists" }[] },
  memberCount: number,
): string | null {
  const seed = pick.because[0];
  if (!seed) return null;
  if (seed.reason === "watched") {
    return `Because you ${memberCount > 2 ? "all" : "both"} watched ${seed.title}`;
  }
  return `Because ${seed.title} is on your lists`;
}

/** How many of tonight's picks are shown after filtering. */
export const SHOWN_PICKS = 30;

const TIME_LIMITS = { short: 35, hour: 70 } as const;
const KID_RATINGS = new Set(["G", "PG", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG"]);

interface FilterablePick {
  content_type: "tv" | "movie";
  runtime: number | null;
  certification: string | null;
  services: unknown[];
}

/**
 * Tonight's filters, on the client. Same rules as the server's
 * household_picks._passes: an episode up to ~35 / ~70 minutes (unknown
 * runtime passes), movies only, on a service someone watching pays for, and
 * kid-friendly by US rating (unknown rating or services never pass, since
 * those are promises).
 */
export function filterPicks<T extends FilterablePick>(
  picks: T[],
  { time, services, kids }: { time: "any" | "short" | "hour" | "movie"; services: boolean; kids: boolean },
): T[] {
  return picks.filter((p) => {
    if (time === "movie" && p.content_type !== "movie") return false;
    if (time === "short" || time === "hour") {
      if (p.content_type === "movie") return false;
      if (p.runtime !== null && p.runtime > TIME_LIMITS[time]) return false;
    }
    if (services && p.services.length === 0) return false;
    if (kids && !KID_RATINGS.has(p.certification ?? "")) return false;
    return true;
  });
}
