import { formatLocalDate, toLocalISODate } from "./date";

export type EpisodeKind =
  | "show_premiere"
  | "season_premiere"
  | "season_finale"
  | "series_finale"
  | "mid_season";

const STORED_KINDS = new Set<string>([
  "show_premiere",
  "season_premiere",
  "season_finale",
  "series_finale",
  "mid_season",
]);

/**
 * What kind of episode this is, for its tag. Takes TMDb's raw type ("finale",
 * "mid_season", "standard") or one the backend already stored. Same rules as
 * the backend's _compute_episode_type, except specials never get a tag and a
 * finale is only the series finale in the show's last season.
 */
export function episodeKind(
  seasonNumber: number,
  episodeNumber: number,
  episodeType: string | null | undefined,
  inProduction?: boolean | null,
  lastSeason?: number | null,
): EpisodeKind | null {
  if (seasonNumber === 0) return null;
  if (episodeType && STORED_KINDS.has(episodeType)) return episodeType as EpisodeKind;
  if (episodeNumber === 1) return seasonNumber === 1 ? "show_premiere" : "season_premiere";
  if (episodeType === "finale") {
    const inLastSeason = lastSeason == null || seasonNumber >= lastSeason;
    return inProduction === false && inLastSeason ? "series_finale" : "season_finale";
  }
  if (episodeType === "mid_season") return "mid_season";
  return null;
}

/** True when the episode has no air date yet, or airs after today (local). */
export function isUnaired(airDate: string | null | undefined, today = toLocalISODate(new Date())): boolean {
  return !airDate || airDate > today;
}

/** "Nov 12, 2026": the one date format for seasons and episodes. */
export function formatAirDate(iso: string): string {
  return formatLocalDate(iso, { year: "numeric", month: "short", day: "numeric" });
}

/** "1h 5m", "45m". */
export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null].filter(Boolean).join(" ");
}

export function seasonLabel(seasonNumber: number, name?: string | null): string {
  if (name) return name;
  return seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`;
}

interface EpisodeRef {
  season_number: number;
  episode_number: number;
  air_date: string | null;
}

/** The backend's answer: per stored season, the first aired unwatched episode. */
export interface EpisodeGaps {
  first_unwatched: Record<string, number>;
  stored_seasons: number[];
}

/**
 * Whether marking `ep` watched "up to here" would mark anything else: an aired,
 * unwatched episode earlier in its season, or (outside specials) an earlier
 * season with one. For seasons the backend has stored, `gaps` answers exactly;
 * for any others it falls back to comparing the watched count with
 * episode_count, which counts unaired episodes too.
 */
export function hasUnwatchedBefore(
  ep: EpisodeRef,
  seasonEpisodes: EpisodeRef[],
  isWatched: (seasonNumber: number, episodeNumber: number) => boolean,
  earlierSeasons: { season_number: number; episode_count: number }[] = [],
  watchedCountBySeason: Map<number, number> = new Map(),
  gaps?: EpisodeGaps,
  today = toLocalISODate(new Date()),
): boolean {
  const gapInSeason = seasonEpisodes.some(
    (other) =>
      other.season_number === ep.season_number &&
      other.episode_number < ep.episode_number &&
      !isUnaired(other.air_date, today) &&
      !isWatched(other.season_number, other.episode_number),
  );
  if (gapInSeason || ep.season_number === 0) return gapInSeason;
  const stored = new Set(gaps?.stored_seasons ?? []);
  return earlierSeasons.some((s) => {
    if (s.season_number <= 0 || s.season_number >= ep.season_number) return false;
    if (gaps && stored.has(s.season_number)) {
      return String(s.season_number) in gaps.first_unwatched;
    }
    return s.episode_count > 0 && (watchedCountBySeason.get(s.season_number) ?? 0) < s.episode_count;
  });
}
