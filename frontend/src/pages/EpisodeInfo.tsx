import { useParams, Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../hooks/api/queryKeys";
import { queryFetch } from "../hooks/api/queryFetch";
import { useWatchedEpisodes, useToggleEpisode } from "../hooks/api/useEpisodes";

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

function getEpisodeTag(
  episodeNumber: number,
  episodeType: string | null | undefined,
  inProduction: boolean | null | undefined,
): { label: string; classes: string } | null {
  if (episodeNumber === 1) {
    return {
      label: "Season Premiere",
      classes:
        "bg-primary-600/20 text-primary-300 border border-primary-500/40",
    };
  }
  if (episodeType === "finale") {
    if (inProduction === false) {
      return {
        label: "Series Finale",
        classes: "bg-error-700/20 text-error-300 border border-error-500/40",
      };
    }
    return {
      label: "Season Finale",
      classes:
        "bg-warning-600/20 text-warning-300 border border-warning-500/40",
    };
  }
  if (episodeType === "mid_season") {
    return {
      label: "Mid-Season Finale",
      classes:
        "bg-warning-600/20 text-warning-300 border border-warning-500/40",
    };
  }
  return null;
}

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ""}`.trim() : `${m}m`;
}

function PersonCard({
  name,
  character,
  profilePath,
}: {
  name: string;
  character?: string;
  profilePath: string | null;
}) {
  return (
    <div className="flex-shrink-0 w-24 text-center">
      {profilePath ? (
        <img
          src={`${BASE_IMAGE_URL}/w342${profilePath}`}
          alt={name}
          className="w-24 h-36 object-cover rounded-xl mb-1"
        />
      ) : (
        <div className="w-24 h-36 rounded-xl bg-neutral-700 flex items-center justify-center mb-1">
          <svg
            className="w-8 h-8 text-neutral-500"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
      )}
      <p className="text-xs font-medium text-neutral-200 line-clamp-2">
        {name}
      </p>
      {character && (
        <p className="text-xs text-neutral-500 line-clamp-1">{character}</p>
      )}
    </div>
  );
}

export default function EpisodeInfo() {
  const { showId, season, episode } = useParams<{
    showId: string;
    season: string;
    episode: string;
  }>();

  const episodeQuery = useQuery<EpisodeData>({
    queryKey: queryKeys.episodeDetail(showId ?? "", season ?? "", episode ?? ""),
    queryFn: () =>
      queryFetch<EpisodeData>(`/tv/${showId}/season/${season}/episode/${episode}`),
    enabled: !!showId && !!season && !!episode,
  });

  const showQuery = useQuery<{ name: string; in_production: boolean | null }>({
    queryKey: queryKeys.mediaDetail("tv", showId ?? ""),
    queryFn: () =>
      queryFetch(`/tv/${showId}`),
    enabled: !!showId,
  });

  const watchedEpisodesQuery = useWatchedEpisodes(Number(showId ?? 0));
  const toggleEpisode = useToggleEpisode();

  const data = episodeQuery.data;
  const showName = showQuery.data?.name ?? null;
  const showInProduction = showQuery.data?.in_production ?? null;
  const isWatched = watchedEpisodesQuery.data?.some(
    (e) => e.season_number === Number(season) && e.episode_number === Number(episode),
  ) ?? false;

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

  if (episodeQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (episodeQuery.isError || !data) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-error-400 text-lg">
          {episodeQuery.error?.message ?? "Episode not found."}
        </p>
        {showId && (
          <Link
            to={`/tv/${showId}`}
            className="text-primary-400 hover:text-primary-300 text-sm mt-4 inline-block"
          >
            ← Back to show
          </Link>
        )}
      </div>
    );
  }

  const trailer = data.videos?.results.find(
    (v) => v.site === "YouTube" && (v.type === "Clip" || v.type === "Trailer"),
  );
  const directors =
    data.credits?.crew.filter((c) => c.job === "Director") ?? [];
  const writers =
    data.credits?.crew.filter(
      (c) => c.job === "Writer" || c.job === "Teleplay",
    ) ?? [];
  const guestStars = data.credits?.guest_stars ?? [];
  const regularCast = data.credits?.cast ?? [];
  const allCast = [...guestStars, ...regularCast].slice(0, 20);

  const heroSrc = data.still_path
    ? `${BASE_IMAGE_URL}/w1280${data.still_path}`
    : null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-neutral-400 flex-wrap">
        {showName && showId && (
          <>
            <Link
              to={`/tv/${showId}`}
              className="hover:text-white transition-colors"
            >
              {showName}
            </Link>
            <span>/</span>
          </>
        )}
        <Link
          to={`/tv/${showId}`}
          className="hover:text-white transition-colors"
        >
          Season {data.season_number}
        </Link>
        <span>/</span>
        <span className="text-neutral-200">Episode {data.episode_number}</span>
      </nav>

      {/* Hero image */}
      {heroSrc && (
        <div className="rounded-2xl overflow-hidden aspect-video w-full">
          <img
            src={heroSrc}
            alt={data.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Title + metadata */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="bg-highlight-600/20 text-highlight-400 border border-highlight-600/30 text-xs font-medium px-2 py-0.5 rounded">
                S{String(data.season_number).padStart(2, "0")}E
                {String(data.episode_number).padStart(2, "0")}
              </span>
              {(() => {
                const tag = getEpisodeTag(
                  data.episode_number,
                  data.episode_type,
                  showInProduction,
                );
                return tag ? (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${tag.classes}`}
                  >
                    {tag.label}
                  </span>
                ) : null;
              })()}
              {data.vote_average != null && data.vote_average > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-400">
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {data.vote_average.toFixed(1)}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
              {data.name}
            </h1>
            <div className="flex items-center gap-3 text-sm text-neutral-400 flex-wrap">
              {data.air_date && (
                <span>
                  {new Date(data.air_date + "T00:00:00").toLocaleDateString(
                    undefined,
                    { year: "numeric", month: "long", day: "numeric" },
                  )}
                </span>
              )}
              {data.runtime != null && data.runtime > 0 && (
                <>
                  <span className="text-neutral-600">·</span>
                  <span>{formatRuntime(data.runtime)}</span>
                </>
              )}
            </div>
          </div>

          {/* Watched toggle */}
          <button
            onClick={toggleWatched}
            disabled={toggleEpisode.isPending}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all disabled:opacity-50 ${
              isWatched
                ? "bg-success-700/30 border border-success-600/50 text-success-400 hover:bg-error-900/30 hover:border-error-600/40 hover:text-error-400"
                : "bg-neutral-800 border border-neutral-600 text-neutral-300 hover:bg-success-900/30 hover:border-success-600/40 hover:text-success-400"
            }`}
          >
            {toggleEpisode.isPending ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : isWatched ? (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            {isWatched ? "Watched" : "Mark Watched"}
          </button>
        </div>
      </div>

      {/* Overview */}
      {data.overview && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-2">Overview</h2>
          <p className="text-neutral-300 leading-relaxed">{data.overview}</p>
        </div>
      )}

      {/* Crew */}
      {(directors.length > 0 || writers.length > 0) && (
        <div className="flex flex-wrap gap-6">
          {directors.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                Directed by
              </p>
              <p className="text-neutral-200 text-sm">
                {directors.map((d) => d.name).join(", ")}
              </p>
            </div>
          )}
          {writers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                Written by
              </p>
              <p className="text-neutral-200 text-sm">
                {writers.map((w) => w.name).join(", ")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Cast */}
      {allCast.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Cast</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {allCast.map((person) => (
              <Link
                key={`${person.id}-${person.character}`}
                to={`/person/${person.id}`}
              >
                <PersonCard
                  name={person.name}
                  character={person.character}
                  profilePath={person.profile_path}
                />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Trailer / clip */}
      {trailer && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Video</h2>
          <div className="aspect-video rounded-xl overflow-hidden">
            <iframe
              src={`https://www.youtube.com/embed/${trailer.key}`}
              title={data.name}
              className="w-full h-full"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* Back to show */}
      <div className="pt-4 border-t border-neutral-800">
        <Link
          to={`/tv/${showId}`}
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to {showName ?? "show"}
        </Link>
      </div>
    </div>
  );
}
