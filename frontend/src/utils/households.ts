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
