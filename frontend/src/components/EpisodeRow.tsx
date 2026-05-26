import { memo, useState } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
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
              className="w-28 sm:w-40 h-auto rounded-md object-cover"
            />
            {(() => {
              const tag = getEpisodeTag(ep.episode_type);
              return tag ? (
                <span
                  className={`absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded backdrop-blur-sm ${tag.classes}`}
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
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tag.classes}`}>
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
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-warning-400 hover:text-warning-300"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Hidden — click to reveal
            </button>
          ) : (
            <p className="text-sm text-neutral-300 mt-1">{ep.overview}</p>
          )}
        </div>
      </Link>
      {isLoggedIn && (
        <button
          onClick={() => onToggle(ep.season_number, ep.episode_number)}
          disabled={toggling}
          title={watched ? "Mark as unwatched" : "Mark as watched"}
          className={`flex-shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 disabled:opacity-50 ${
            watched
              ? "bg-success-700/40 border border-success-600/60 text-success-400 hover:bg-error-900/30 hover:border-error-600/40 hover:text-error-400"
              : "bg-neutral-700 border border-neutral-600 text-neutral-400 hover:bg-success-900/30 hover:border-success-600/40 hover:text-success-400"
          }`}
        >
          {toggling ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : watched ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
});

export default EpisodeRow;

export function epKey(seasonNumber: number, episodeNumber: number) {
  return `${seasonNumber}_${episodeNumber}`;
}
