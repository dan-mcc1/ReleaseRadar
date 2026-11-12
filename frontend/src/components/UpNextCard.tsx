import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { useNextEpisode, useToggleEpisode } from "../hooks/api/useEpisodes";
import { useNotificationPrefs } from "../hooks/api/useNotifications";
import { unairedLabel } from "./EpisodeRow";
import { useToast } from "./Toast";
import { Button, Card, CheckIcon } from "./ui";

/**
 * The next episode to watch, with one click to log it. After each click the
 * card moves on to the episode after, so a run of episodes is a run of clicks.
 */
export default function UpNextCard({ showId }: { showId: number }) {
  const { data: next, isFetching } = useNextEpisode(showId);
  const toggle = useToggleEpisode();
  const toast = useToast();
  const { data: prefs } = useNotificationPrefs();
  // A still can give a scene away, so it waits until the episode is watched.
  // The title stays: every episode list shows titles.
  const hideStill = prefs?.hide_spoilers ?? true;

  if (!next || next.finished) return null;

  const unaired = unairedLabel(next.air_date);
  const href = `/tv/${showId}/episode/${next.season_number}/${next.episode_number}`;

  const markWatched = () =>
    toggle.mutate(
      {
        showId,
        seasonNumber: next.season_number,
        episodeNumber: next.episode_number,
        watched: false,
      },
      { onError: () => toast.error("Couldn't mark that episode. Try again.") },
    );

  return (
    <Card padding="sm" className="flex items-center gap-4">
      {next.still_path && !hideStill && (
        <Link to={href} className="flex-shrink-0 hover:opacity-90 transition-opacity">
          <img
            src={`${BASE_IMAGE_URL}/w300${next.still_path}`}
            alt=""
            className="w-24 sm:w-32 h-auto rounded-control object-cover"
          />
        </Link>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-caption text-neutral-400">
          Up next · <span className="font-mono">S{next.season_number} E{next.episode_number}</span>
        </p>
        <Link
          to={href}
          className="block truncate text-title font-medium text-neutral-100 hover:text-primary-300 transition-colors"
        >
          {next.name}
        </Link>
        {unaired && <p className="text-caption text-neutral-400 mt-0.5">{unaired}</p>}
      </div>
      <Button
        variant="primary"
        size="sm"
        icon={<CheckIcon />}
        onClick={markWatched}
        // Stay busy until the next episode has loaded, so a quick second
        // click can't land on the one just marked.
        disabled={!!unaired || toggle.isPending || isFetching}
        loading={toggle.isPending || isFetching}
        title={unaired ? "You can mark it once it airs" : undefined}
      >
        Mark watched
      </Button>
    </Card>
  );
}
