import { memo, useState } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { ChevronDoubleUpIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CheckIcon, IconButton } from "./ui";
import type { Episode } from "../types/calendar";
import {
  episodeKind,
  formatAirDate,
  formatRuntime,
  isUnaired,
  type EpisodeKind,
} from "../utils/episodes";

const TAGS: Record<EpisodeKind, { label: string; classes: string }> = {
  show_premiere: {
    label: "Series Premiere",
    classes: "bg-highlight-600/20 text-highlight-300 border border-highlight-500/40",
  },
  season_premiere: {
    label: "Season Premiere",
    classes: "bg-primary-600/20 text-primary-300 border border-primary-500/40",
  },
  season_finale: {
    label: "Season Finale",
    classes: "bg-warning-600/20 text-warning-300 border border-warning-500/40",
  },
  series_finale: {
    label: "Series Finale",
    classes: "bg-error-700/20 text-error-300 border border-error-500/40",
  },
  mid_season: {
    label: "Mid-Season Finale",
    classes: "bg-warning-600/20 text-warning-300 border border-warning-500/40",
  },
};

export function getEpisodeTag(
  kind: EpisodeKind | null,
): { label: string; classes: string } | null {
  return kind ? TAGS[kind] : null;
}

/** "Airs Nov 20, 2026" or "Unaired"; null once it has aired. */
export function unairedLabel(airDate: string | null | undefined): string | null {
  if (!isUnaired(airDate)) return null;
  return airDate ? `Airs ${formatAirDate(airDate)}` : "Unaired";
}

interface EpisodeRowProps {
  episode: Episode;
  showId: number;
  isWatched: boolean;
  isToggling: boolean;
  isLoggedIn: boolean;
  hideOverview: boolean;
  onToggle: (seasonNumber: number, episodeNumber: number) => void;
  /** For the finale tag: series finale only when the show has ended... */
  inProduction?: boolean | null;
  /** ...and this is its last season. */
  lastSeason?: number | null;
  /** Show "Mark watched up to here": earlier aired episodes are still unwatched. */
  canWatchThrough?: boolean;
  onWatchThrough?: (seasonNumber: number, episodeNumber: number) => void;
}

const EpisodeRow = memo(function EpisodeRow({
  episode: ep,
  showId,
  isWatched: watched,
  isToggling: toggling,
  isLoggedIn,
  hideOverview,
  onToggle,
  inProduction,
  lastSeason,
  canWatchThrough = false,
  onWatchThrough,
}: EpisodeRowProps) {
  const [revealed, setRevealed] = useState(false);
  const overviewHidden = hideOverview && !revealed && !!ep.overview;
  const tag = getEpisodeTag(
    episodeKind(ep.season_number, ep.episode_number, ep.episode_type, inProduction, lastSeason),
  );
  const unaired = unairedLabel(ep.air_date);
  const details = [
    ep.air_date ? formatAirDate(ep.air_date) : "Air date TBA",
    ep.runtime ? formatRuntime(ep.runtime) : null,
  ].filter(Boolean).join(" · ");
  // Unaired episodes can't be marked, but one marked earlier can be unmarked.
  const toggleDisabled = toggling || (!!unaired && !watched);

  return (
    <div className="flex gap-3 items-start">
      <Link
        to={`/tv/${showId}/episode/${ep.season_number}/${ep.episode_number}`}
        className="flex gap-3 items-start flex-1 min-w-0 hover:opacity-90 transition-opacity"
      >
        {ep.still_path ? (
          <div className="relative flex-shrink-0">
            <img
              src={`${BASE_IMAGE_URL}/w500${ep.still_path}`}
              alt={ep.name}
              className={`w-28 sm:w-40 h-auto rounded-control object-cover ${unaired ? "opacity-60" : ""}`}
            />
            {tag && (
              <span
                className={`absolute bottom-1.5 left-1.5 text-caption font-semibold px-1.5 py-0.5 rounded backdrop-blur-sm ${tag.classes}`}
              >
                {tag.label}
              </span>
            )}
          </div>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-medium text-neutral-100 hover:text-primary-300 transition-colors">
              {ep.episode_number}. {ep.name}
            </p>
            {tag && (
              <span className={`text-caption font-semibold px-1.5 py-0.5 rounded ${tag.classes}`}>
                {tag.label}
              </span>
            )}
            {unaired && (
              <span className="text-caption font-semibold px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                {unaired}
              </span>
            )}
          </div>
          <p className="text-neutral-400 text-sm tabular">{details}</p>
          {overviewHidden ? (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRevealed(true);
              }}
              className="mt-1 inline-flex items-center gap-1.5 text-caption font-medium text-warning-400 hover:text-warning-300"
            >
              <ExclamationTriangleIcon className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
              Hidden — click to reveal
            </button>
          ) : (
            <p className="text-sm text-neutral-300 mt-1">{ep.overview}</p>
          )}
        </div>
      </Link>
      {isLoggedIn && (
        <div className="flex items-center gap-1.5 mt-0.5">
          {canWatchThrough && !watched && !unaired && onWatchThrough && (
            <IconButton
              label="Mark watched up to here"
              size="sm"
              onClick={() => onWatchThrough(ep.season_number, ep.episode_number)}
              disabled={toggling}
              icon={<ChevronDoubleUpIcon className="w-4 h-4" aria-hidden="true" />}
            />
          )}
          <IconButton
            label={
              watched
                ? "Mark as unwatched"
                : unaired
                  ? "Can't mark an episode that hasn't aired"
                  : "Mark as watched"
            }
            size="sm"
            pressed={watched}
            variant="secondary"
            onClick={() => onToggle(ep.season_number, ep.episode_number)}
            disabled={toggleDisabled}
            icon={
              toggling ? (
                <span
                  className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <CheckIcon />
              )
            }
          />
        </div>
      )}
    </div>
  );
});

export default EpisodeRow;

export function epKey(seasonNumber: number, episodeNumber: number) {
  return `${seasonNumber}_${episodeNumber}`;
}
