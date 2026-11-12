import { useParams, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../hooks/api/queryKeys";
import { queryFetch } from "../hooks/api/queryFetch";
import {
  useWatchedEpisodes,
  useToggleEpisode,
  useAnnotateEpisode,
} from "../hooks/api/useEpisodes";
import { useNotificationPrefs } from "../hooks/api/useNotifications";
import { useAuthLoading, useAuthUser } from "../hooks/useAuthUser";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  Button,
  ButtonLink,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PageHeader,
  PageState,
  PlusIcon,
  SectionHeader,
  StarIcon,
  cx,
  focusRing,
} from "../components/ui";
import { unairedLabel } from "../components/EpisodeRow";
import {
  episodeKind,
  formatAirDate,
  formatRuntime,
  seasonLabel,
  type EpisodeKind,
} from "../utils/episodes";

interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

interface CrewMember {
  id: number;
  name: string;
  job: string;
  profile_path: string | null;
}

interface EpisodeData {
  id: number;
  show_id: number;
  season_number: number;
  episode_number: number;
  name: string;
  overview: string | null;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
  vote_average: number | null;
  vote_count: number | null;
  episode_type: string | null;
  credits?: {
    cast: CastMember[];
    crew: CrewMember[];
    guest_stars: CastMember[];
  };
  videos?: {
    results: { key: string; site: string; type: string; official: boolean }[];
  };
}

interface AdjacentEpisode {
  episode_number: number;
  season_number: number;
  name: string;
  still_path: string | null;
}

const EPISODE_TAGS: Record<EpisodeKind, { label: string; bg: string; color: string }> = {
  show_premiere: { label: "Series Premiere", bg: "bg-highlight-500/15", color: "text-highlight-400" },
  season_premiere: { label: "Season Premiere", bg: "bg-primary-500/15", color: "text-primary-400" },
  season_finale: { label: "Season Finale", bg: "bg-warning-500/15", color: "text-warning-400" },
  series_finale: { label: "Series Finale", bg: "bg-error-500/15", color: "text-error-400" },
  mid_season: { label: "Mid-Season Finale", bg: "bg-warning-500/15", color: "text-warning-400" },
};

export default function EpisodeInfo() {
  const { showId, season, episode } = useParams<{
    showId: string;
    season: string;
    episode: string;
  }>();
  const navigate = useNavigate();

  const episodeQuery = useQuery<EpisodeData>({
    queryKey: queryKeys.episodeDetail(showId ?? "", season ?? "", episode ?? ""),
    queryFn: () =>
      queryFetch<EpisodeData>(`/tv/${showId}/season/${season}/episode/${episode}`),
    enabled: !!showId && !!season && !!episode,
  });

  const showQuery = useQuery<{
    name: string;
    in_production: boolean | null;
    seasons?: { season_number: number }[];
  }>({
    queryKey: queryKeys.mediaDetail("tv", showId ?? ""),
    queryFn: () => queryFetch(`/tv/${showId}`),
    enabled: !!showId,
  });

  const prevEpNum = Number(episode) - 1;
  const nextEpNum = Number(episode) + 1;

  const prevEpisodeQuery = useQuery<AdjacentEpisode>({
    queryKey: queryKeys.episodeDetail(showId ?? "", season ?? "", String(prevEpNum)),
    queryFn: () =>
      queryFetch<AdjacentEpisode>(
        `/tv/${showId}/season/${season}/episode/${prevEpNum}`,
      ),
    enabled: !!showId && !!season && prevEpNum >= 1,
  });

  const nextEpisodeQuery = useQuery<AdjacentEpisode>({
    queryKey: queryKeys.episodeDetail(showId ?? "", season ?? "", String(nextEpNum)),
    queryFn: () =>
      queryFetch<AdjacentEpisode>(
        `/tv/${showId}/season/${season}/episode/${nextEpNum}`,
      ),
    enabled: !!showId && !!season,
  });

  const watchedEpisodesQuery = useWatchedEpisodes(Number(showId ?? 0));
  const toggleEpisode = useToggleEpisode();
  const annotateEpisode = useAnnotateEpisode();

  const data = episodeQuery.data;
  const showName = showQuery.data?.name ?? null;
  const showInProduction = showQuery.data?.in_production ?? null;
  const lastSeason = showQuery.data?.seasons?.length
    ? Math.max(...showQuery.data.seasons.map((s) => s.season_number))
    : null;

  const watchedEntry =
    watchedEpisodesQuery.data?.find(
      (e) =>
        e.season_number === Number(season) &&
        e.episode_number === Number(episode),
    ) ?? null;
  const isWatched = watchedEntry !== null;

  // Spoiler veil for synopsis: hide if logged-in user has watched at least one
  // episode of this show, this episode is unwatched, and falls strictly after
  // their last-watched position.
  const user = useAuthUser();
  const authLoading = useAuthLoading();
  // Only once auth has answered, so signed-in visitors never see it flash.
  const signedOut = !user && !authLoading;
  const { data: prefs } = useNotificationPrefs();
  const hideSpoilers = prefs?.hide_spoilers ?? true;
  const lastWatched = (watchedEpisodesQuery.data ?? []).reduce<
    { s: number; e: number } | null
  >((acc, ep) => {
    if (
      !acc ||
      ep.season_number > acc.s ||
      (ep.season_number === acc.s && ep.episode_number > acc.e)
    ) {
      return { s: ep.season_number, e: ep.episode_number };
    }
    return acc;
  }, null);
  const epSeason = Number(season);
  const epNumber = Number(episode);
  const isFutureEpisode =
    !!lastWatched &&
    (epSeason > lastWatched.s ||
      (epSeason === lastWatched.s && epNumber > lastWatched.e));
  // The next episode after lastWatched isn't a spoiler — it's what the user
  // is about to watch. Covers the in-season case and the season-rollover case
  // (S(N+1)E1 right after the previous season's finale).
  const isNextUpEpisode =
    !!lastWatched &&
    ((epSeason === lastWatched.s && epNumber === lastWatched.e + 1) ||
      (epSeason === lastWatched.s + 1 && epNumber === 1));
  const shouldHideOverview =
    !!user && hideSpoilers && !isWatched && isFutureEpisode && !isNextUpEpisode;
  const [overviewRevealed, setOverviewRevealed] = useState(false);

  const [notesDraft, setNotesDraft] = useState<string>(() => watchedEntry?.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);

  usePageTitle(data ? data.name : "Episode");

  function toggleWatched() {
    if (!showId) return;
    toggleEpisode.mutate({
      showId: Number(showId),
      seasonNumber: Number(season),
      episodeNumber: Number(episode),
      watched: isWatched,
    });
  }

  function submitNotes() {
    if (!showId) return;
    annotateEpisode.mutate(
      {
        showId: Number(showId),
        seasonNumber: Number(season),
        episodeNumber: Number(episode),
        notes: notesDraft || null,
      },
      { onSuccess: () => setNotesOpen(false) },
    );
  }

  function setEpisodeRating(rating: number | null) {
    if (!showId || !isWatched) return;
    annotateEpisode.mutate({
      showId: Number(showId),
      seasonNumber: Number(season),
      episodeNumber: Number(episode),
      rating,
    });
  }

  if (episodeQuery.isPending) {
    return <PageState status="loading" label="Loading episode…" />;
  }

  if (episodeQuery.isError || !data) {
    return (
      <PageState
        status="error"
        error={episodeQuery.error}
        subject="episode"
        back={showId ? { to: `/tv/${showId}`, label: "Back to show" } : undefined}
        onRetry={() => episodeQuery.refetch()}
      />
    );
  }

  const directors = data.credits?.crew.filter((c) => c.job === "Director") ?? [];
  const writers = data.credits?.crew.filter(
    (c) => c.job === "Writer" || c.job === "Teleplay",
  ) ?? [];
  const guestStars = data.credits?.guest_stars ?? [];
  const regularCast = data.credits?.cast ?? [];
  const allCast = [...guestStars, ...regularCast].slice(0, 12);

  const heroSrc = data.still_path
    ? `${BASE_IMAGE_URL}/w1280${data.still_path}`
    : null;

  const kind = episodeKind(
    data.season_number,
    data.episode_number,
    data.episode_type,
    showInProduction,
    lastSeason,
  );
  const episodeTag = kind ? EPISODE_TAGS[kind] : null;
  const unaired = unairedLabel(data.air_date);

  const seasonCode = `S${data.season_number}`;
  const episodeCode = `E${data.episode_number}`;

  const prevEp = prevEpisodeQuery.data;
  const nextEp = nextEpisodeQuery.data;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">

      {/* Breadcrumb */}
      <div className="px-6 md:px-10 pt-6 pb-3 flex items-center gap-2.5 text-label flex-wrap">
        {showName && showId && (
          <>
            <Link to={`/tv/${showId}`} className="text-neutral-400 hover:text-neutral-200 transition-colors">
              {showName}
            </Link>
            <span className="text-neutral-500">/</span>
          </>
        )}
        <Link
          to={`/tv/${showId}/season/${data.season_number}`}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          {seasonLabel(data.season_number)}
        </Link>
        <span className="text-neutral-500">/</span>
        <span className="text-neutral-200 font-medium">
          Episode {data.episode_number}
        </span>
      </div>

      {/* Hero still */}
      {heroSrc && (
        <div className="px-6 md:px-10 pb-7 flex justify-center">
          <div
            className="relative rounded-surface overflow-hidden w-full max-w-5xl"
            style={{ aspectRatio: "16/9" }}
          >
            <img
              src={heroSrc}
              alt={data.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
          </div>
        </div>
      )}

      {/* Title + watched panel */}
      <div className="px-6 md:px-10 pb-6 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-7 items-start">
        <div>
          {/* Badge row */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="px-2.5 py-1 font-mono text-caption font-semibold bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-md">
              {seasonCode} {episodeCode}
            </span>
            {episodeTag && (
              <span className={`px-2.5 py-1 text-caption font-semibold rounded-md ${episodeTag.bg} ${episodeTag.color}`}>
                {episodeTag.label}
              </span>
            )}
            {data.vote_average != null && data.vote_average > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-caption font-semibold bg-warning-400/12 text-warning-400 rounded-md">
                <StarIcon className="w-3 h-3" />
                {data.vote_average.toFixed(1)}
                {data.vote_count != null && data.vote_count > 0 && (
                  <span className="text-warning-600 ml-1">· {data.vote_count.toLocaleString()}</span>
                )}
              </span>
            )}
            {data.runtime != null && data.runtime > 0 && (
              <span className="px-2.5 py-1 text-caption font-semibold bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md">
                {formatRuntime(data.runtime)}
              </span>
            )}
            {unaired ? (
              <span className="px-2.5 py-1 text-caption font-semibold bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-md">
                {unaired}
              </span>
            ) : (
              data.air_date && (
                <span className="text-caption text-neutral-500">
                  · {formatAirDate(data.air_date)}
                </span>
              )
            )}
          </div>

          <PageHeader title={data.name} />
        </div>

        {/* Watched panel */}
        <div className="flex flex-col gap-2">
          {signedOut ? (
            <>
              <ButtonLink
                to={`/signIn?next=${encodeURIComponent(`/tv/${showId}/episode/${season}/${episode}`)}`}
                variant="primary"
                icon={<PlusIcon />}
                className="w-full"
              >
                Sign in to track
              </ButtonLink>
              <div className="text-caption text-neutral-400">
                Keep track of what you've watched and what airs next.
              </div>
            </>
          ) : !user ? null : isWatched ? (
            <>
              <div className="flex items-center gap-2 text-label font-semibold text-neutral-100">
                <CheckIcon className="w-4 h-4 text-primary-400" />
                Watched
              </div>
              <div className="text-caption text-neutral-400">Logged to your activity</div>
              <Button
                onClick={toggleWatched}
                disabled={toggleEpisode.isPending}
                loading={toggleEpisode.isPending}
                className="w-full"
              >
                Unmark watched
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                icon={<PlusIcon />}
                onClick={toggleWatched}
                disabled={toggleEpisode.isPending || !!unaired}
                loading={toggleEpisode.isPending}
                className="w-full"
              >
                Mark as watched
              </Button>
              <div className="text-caption text-neutral-400">
                {unaired ? "You can mark it once it airs" : "Logs to your activity"}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rating + Notes — only when watched */}
      {isWatched && (
        <div className="px-6 md:px-10 pb-7 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
          {/* Rating */}
          <div>
            <SectionHeader title="Your rating" className="mb-4" />
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  aria-label={`Rate ${star} out of 5`}
                  onClick={() =>
                    setEpisodeRating(watchedEntry?.rating === star ? null : star)
                  }
                  disabled={annotateEpisode.isPending}
                  className={cx("disabled:opacity-50 transition-transform hover:scale-110 rounded", focusRing)}
                >
                  <StarIcon
                    className={`w-8 h-8 transition-colors ${
                      (watchedEntry?.rating ?? 0) >= star
                        ? "text-warning-400"
                        : "text-neutral-800 hover:text-warning-400/40"
                    }`}
                  />
                </button>
              ))}
              {watchedEntry?.rating != null && (
                <span className="ml-3 text-heading font-semibold leading-none text-warning-400 tabular">
                  {watchedEntry.rating}
                  <span className="text-neutral-500 text-title">/5</span>
                </span>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <SectionHeader
              title="Your notes"
              className="mb-4"
              action={
                !notesOpen && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={watchedEntry?.notes ? undefined : <PlusIcon />}
                    onClick={() => {
                      setNotesDraft(watchedEntry?.notes ?? "");
                      setNotesOpen(true);
                    }}
                  >
                    {watchedEntry?.notes ? "Edit" : "Add note"}
                  </Button>
                )
              }
            />
            {notesOpen ? (
              <div className="space-y-2">
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What did you think?"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-control px-3 py-2 text-body text-neutral-200 placeholder-neutral-500 resize-none focus:outline-none focus:border-primary-500 font-sans"
                />
                <div className="flex items-center gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setNotesOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={submitNotes}
                    disabled={annotateEpisode.isPending}
                  >
                    {annotateEpisode.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ) : watchedEntry?.notes ? (
              <p className="text-body text-neutral-300 leading-relaxed">
                "{watchedEntry.notes}"
              </p>
            ) : (
              <p className="text-label text-neutral-500">
                No notes yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Synopsis + Crew side rail */}
      {(data.overview || directors.length > 0 || writers.length > 0) && (
        <div className="px-6 md:px-10 pb-7 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-9">
          {data.overview && (
            <div>
              <SectionHeader title="Synopsis" divider className="mb-4" />
              {shouldHideOverview && !overviewRevealed ? (
                <button
                  onClick={() => setOverviewRevealed(true)}
                  className={cx(
                    "inline-flex items-center gap-2 bg-neutral-900/60 hover:bg-neutral-900 border border-warning-500/30 rounded-control px-4 py-3 text-body text-neutral-300 hover:text-neutral-100 transition-colors",
                    focusRing,
                  )}
                >
                  <ExclamationTriangleIcon className="w-4 h-4 text-warning-400 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span>Synopsis hidden — you haven't reached this episode yet. Click to reveal.</span>
                </button>
              ) : (
                <p className="font-light text-title md:text-heading leading-relaxed text-neutral-200 max-w-2xl">
                  {data.overview}
                </p>
              )}
            </div>
          )}

          {(directors.length > 0 || writers.length > 0) && (
            <div>
              <SectionHeader title="Crew" className="mb-4" />
              <div className="flex flex-col gap-4">
                {directors.length > 0 && (
                  <div>
                    <div className="text-caption text-neutral-400">
                      Directed by
                    </div>
                    <div className="text-body mt-1 text-neutral-200">
                      {directors.map((d) => d.name).join(", ")}
                    </div>
                  </div>
                )}
                {writers.length > 0 && (
                  <div>
                    <div className="text-caption text-neutral-400">
                      Written by
                    </div>
                    <div className="text-body mt-1 text-neutral-200">
                      {writers.map((w) => w.name).join(", ")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cast */}
      {allCast.length > 0 && (
        <div className="px-6 md:px-10 pb-7">
          <SectionHeader title="Cast" note={allCast.length} divider className="mb-5" />
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-4">
            {allCast.map((person) => (
              <Link
                key={`${person.id}-${person.character}`}
                to={`/person/${person.id}`}
                className="text-left group"
              >
                <div className="aspect-square rounded-full overflow-hidden mb-2.5 bg-neutral-800 border border-neutral-700 group-hover:border-neutral-500 transition-colors">
                  {person.profile_path ? (
                    <img
                      src={`${BASE_IMAGE_URL}/w185${person.profile_path}`}
                      alt={person.name}
                      className="w-full h-full object-cover object-[center_30%]"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-500 font-semibold text-base">
                      {person.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}
                    </div>
                  )}
                </div>
                <p className="text-caption font-semibold text-neutral-200 leading-tight line-clamp-2 group-hover:text-white transition-colors">
                  {person.name}
                </p>
                {person.character && (
                  <p className="text-caption text-neutral-500 mt-0.5 line-clamp-1">
                    as {person.character}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Prev / Next episode nav */}
      <div className="px-6 md:px-10 pb-10">
        <div className="h-px w-full bg-neutral-800 mb-5" />
        <div className="grid grid-cols-2 gap-3.5">
          {/* Previous */}
          <button
            onClick={() =>
              prevEp &&
              navigate(`/tv/${showId}/episode/${season}/${prevEp.episode_number}`)
            }
            disabled={!prevEp && prevEpNum >= 1}
            className={cx(
              "flex items-center gap-4 p-4 rounded-surface border text-left transition-colors",
              focusRing,
              prevEp
                ? "bg-neutral-900 border-neutral-800 hover:border-neutral-600 cursor-pointer"
                : "bg-neutral-900/40 border-neutral-800/40 opacity-40 cursor-default",
            )}
          >
            <ChevronLeftIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-caption text-neutral-400 mb-1">
                Previous · <span className="font-mono">{seasonCode} E{prevEpNum}</span>
              </div>
              <div className="text-title text-neutral-200 truncate">
                {prevEp?.name ?? "—"}
              </div>
            </div>
          </button>

          {/* Next */}
          <button
            onClick={() =>
              nextEp &&
              navigate(`/tv/${showId}/episode/${season}/${nextEp.episode_number}`)
            }
            disabled={!nextEp}
            className={cx(
              "flex items-center gap-4 p-4 rounded-surface border text-right justify-end transition-colors",
              focusRing,
              nextEp
                ? "bg-neutral-900 border-neutral-800 hover:border-neutral-600 cursor-pointer"
                : "bg-neutral-900/40 border-neutral-800/40 opacity-40 cursor-default",
            )}
          >
            <div className="min-w-0">
              <div className="text-caption text-neutral-400 mb-1">
                Next · <span className="font-mono">{seasonCode} E{nextEpNum}</span>
              </div>
              <div className="text-title text-neutral-200 truncate">
                {nextEp?.name ?? "—"}
              </div>
            </div>
            <ChevronRightIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}
