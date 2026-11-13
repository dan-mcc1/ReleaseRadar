import type { Candidate, PickReasonItem } from "../hooks/api/useHouseholds";
import { episodeCode } from "../utils/households";

export type Namer = (userId: string) => string;

/** "1h 45m", "1h", "45m" */
export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "You, Sam and Jo"; the current user comes first. */
export function joinNames(ids: string[], nameOf: Namer, uid: string | undefined): string {
  const sorted = [...ids].sort((a, b) => Number(b === uid) - Number(a === uid));
  const names = sorted.map(nameOf);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function reasonText(
  reason: PickReasonItem,
  present: string[],
  nameOf: Namer,
  uid: string | undefined,
): string {
  switch (reason.type) {
    case "next_episode": {
      const everyone = present.length > 2 && present.every((u) => reason.user_ids.includes(u));
      if (everyone) return "Next episode for all of you";
      const names = joinNames(reason.user_ids, nameOf, uid);
      return `Next episode for ${names.replace(/^You\b/, "you")}`;
    }
    case "shared_list": {
      const by = reason.user_id && reason.user_id !== uid ? ` · added by ${nameOf(reason.user_id)}` : "";
      return `On your Watch together list${by}`;
    }
    case "want": {
      if (reason.user_ids.length > 2) return "All of you want to watch this";
      if (reason.user_ids.length === 1) {
        const id = reason.user_ids[0];
        return id === uid ? "You want to watch this" : `${nameOf(id)} wants to watch this`;
      }
      return `${joinNames(reason.user_ids, nameOf, uid)} both want to watch this`;
    }
    case "recommended": {
      if (!reason.because) return "Recommended for you";
      if (reason.basis === "lists") return `Because ${reason.because} is on your lists`;
      const who = present.length > 2 ? "all" : present.length === 2 ? "both" : null;
      return `Because you ${who ? `${who} ` : ""}watched ${reason.because}`;
    }
  }
}

export function describe(pick: Pick<Candidate, "content_type" | "runtime" | "episode" | "reasons">): { label: string; runtime: string | null } {
  if (pick.content_type === "movie") {
    return { label: "Movie", runtime: pick.runtime ? formatRuntime(pick.runtime) : null };
  }
  const runtime = pick.runtime ? `${pick.runtime} min` : null;
  const ep = pick.episode;
  if (!ep) return { label: "Series", runtime };
  const unstarted =
    ep.season_number === 1 &&
    ep.episode_number === 1 &&
    !pick.reasons.some((r) => r.type === "next_episode");
  if (unstarted) return { label: "Start S1 E1", runtime };
  return { label: ep.name ? `${episodeCode(ep)} · ${ep.name}` : episodeCode(ep), runtime };
}
