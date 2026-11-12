import { memo, useState } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CheckIcon, IconButton } from "./ui";
import type { Episode } from "../types/calendar";

export function getEpisodeTag(
  episodeType: string | null | undefined,
): { label: string; classes: string } | null {
  switch (episodeType) {
    case "show_premiere":
      return {
        label: "Series Premiere",
        classes:
          "bg-highlight-600/20 text-highlight-300 border border-highlight-500/40",
      };
    case "season_premiere":
      return {
        label: "Season Premiere",
        classes:
          "bg-primary-600/20 text-primary-300 border border-primary-500/40",
      };
    case "season_finale":
      return {
        label: "Season Finale",
        classes:
          "bg-warning-600/20 text-warning-300 border border-warning-500/40",
      };
    case "series_finale":
      return {
        label: "Series Finale",
        classes: "bg-error-700/20 text-error-300 border border-error-500/40",
      };
    case "mid_season":
      return {
        label: "Mid-Season Finale",
        classes:
          "bg-warning-600/20 text-warning-300 border border-warning-500/40",
      };
    default:
      return null;
  }
}

interface EpisodeRowProps {
  episode: Episode;
  showId: number;
  isWatched: boolean;
  isToggling: boolean;
  isLoggedIn: boolean;
  hideOverview: boolean;
  onToggle: (seasonNumber: number, episodeNumber: number) => void;
}

const EpisodeRow = memo(function EpisodeRow({
  episode: ep,
  showId,
  isWatched: watched,
  isToggling: toggling,
  isLoggedIn,
  hideOverview,
  onToggle,
}: EpisodeRowProps) {
  const [revealed, setRevealed] = useState(false);
  const overviewHidden = hideOverview && !revealed && !!ep.overview;
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
              className="w-28 sm:w-40 h-auto rounded-control object-cover"
            />
            {(() => {
              const tag = getEpisodeTag(ep.episode_type);
              return tag ? (
                <span
                  className={`absolute bottom-1.5 left-1.5 text-caption font-semibold px-1.5 py-0.5 rounded backdrop-blur-sm ${tag.classes}`}
                >
                  {tag.label}
                </span>
              ) : null;
            })()}
          </div>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-medium text-neutral-100 hover:text-primary-300 transition-colors">
              {ep.episode_number}. {ep.name}
            </p>
            {(() => {
              const tag = getEpisodeTag(ep.episode_type);
              return tag ? (
                <span className={`text-caption font-semibold px-1.5 py-0.5 rounded ${tag.classes}`}>
                  {tag.label}
                </span>
              ) : null;
            })()}
          </div>
          <p className="text-neutral-400 text-sm">
            {ep.air_date
              ? new Date(ep.air_date + "T00:00:00").toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : "N/A"}{" "}
            | Runtime:{" "}
            {ep.runtime ? (
              <>
                {Math.floor(ep.runtime / 60) > 0 && `${Math.floor(ep.runtime / 60)}h `}
                {ep.runtime % 60 > 0 && `${ep.runtime % 60}m`}
              </>
            ) : (
              "N/A"
            )}
          </p>
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
        <IconButton
          label={watched ? "Mark as unwatched" : "Mark as watched"}
          size="sm"
          pressed={watched}
          variant="secondary"
          onClick={() => onToggle(ep.season_number, ep.episode_number)}
          disabled={toggling}
          className="mt-0.5"
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
      )}
    </div>
  );
});

export default EpisodeRow;

export function epKey(seasonNumber: number, episodeNumber: number) {
  return `${seasonNumber}_${episodeNumber}`;
}
