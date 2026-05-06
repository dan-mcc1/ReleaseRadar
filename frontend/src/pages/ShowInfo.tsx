import { useParams } from "react-router-dom";
import type { Show } from "../types/calendar";
import type { MediaExternalIds, MediaVideo } from "../types/media";
import { parseLocalDate, formatLocalDate } from "../utils/date";
import SeasonInfo from "../components/SeasonInfo";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import WatchButton from "../components/WatchButton";
import FavoriteButton from "../components/FavoriteButton";
import RecommendButton from "../components/RecommendButton";
import ReviewsSection from "../components/ReviewsSection";
import { useAuthUser } from "../hooks/useAuthUser";
import { usePageTitle } from "../hooks/usePageTitle";
import { useMediaInfo } from "../hooks/useMediaInfo";
import { StatBox } from "../components/InfoPageWidgets";
import MediaHero from "../components/media/MediaHero";
import RatingsRow from "../components/media/RatingsRow";
import ExternalLinksSection from "../components/media/ExternalLinksSection";
import RecommendationsGrid from "../components/media/RecommendationsGrid";
import TrailerButton from "../components/media/TrailerButton";

type FullShowData = Show & {
  vote_average?: number;
  vote_count?: number;
  created_by: { id: number; credit_id: string; name: string; profile_path: string | null; }[];
  credits: { cast: { id: number; name: string; profile_path: string; character: string; }[]; };
  external_ids: MediaExternalIds;
  recommendations: { results: Show[] };
  videos: { results: MediaVideo[]; };
};

export default function ShowInfo() {
  const { id } = useParams<{ id: string }>();
  const { data: show, loading, error, initialStatus, initialRating, statusReady, externalScores, aggRating } =
    useMediaInfo<FullShowData>({ contentType: "tv", id, fetchUrl: `/tv/${id}/full` });
  const user = useAuthUser();
  usePageTitle(show?.name);


  if (loading)
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">Loading show info…</p>
        </div>
      </div>
    );
  if (error) return <p className="text-error-400 p-6">{error}</p>;
  if (!show) return <p className="text-neutral-400 p-6">Show not found.</p>;

  const year = show.first_air_date ? parseLocalDate(show.first_air_date).getFullYear() : null;
  const trailer =
    show.videos?.results?.find((v) => v.type === "Trailer" && v.site === "YouTube") ??
    show.videos?.results?.find((v) => v.site === "YouTube");

  return (
    <div className="max-w-5xl mx-auto pb-16 w-full overflow-x-hidden">
      <MediaHero
        backdropPath={show.backdrop_path}
        posterPath={show.poster_path}
        logoPath={show.logo_path}
        title={show.name}
        tagline={show.tagline}
        minHeight="320px"
      />

      <div className="px-4 sm:px-6 mt-6 space-y-8">
        {/* Buttons row */}
        <div className="flex flex-wrap items-center gap-2">
          {user && statusReady && (
            <WatchButton
              contentType="tv"
              contentId={show.id}
              initialStatus={initialStatus}
              initialRating={initialRating}
              />
          )}
          {user && <FavoriteButton contentType="tv" contentId={show.id} />}
          {user && (
            <RecommendButton
              contentType="tv"
              contentId={show.id}
              contentTitle={show.name}
              contentPosterPath={show.poster_path ?? null}
            />
          )}
          {trailer && <TrailerButton trailerKey={trailer.key} />}
        </div>

        {/* Genre pills */}
        {show.genres && show.genres.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {show.genres.map((genre) => (
              <span
                key={genre.id}
                className="px-3 py-1 text-sm rounded-full bg-neutral-700/60 border border-neutral-600 text-neutral-300"
              >
                {genre.name}
              </span>
            ))}
          </div>
        )}

        {/* Stat boxes */}
        <div className="flex flex-wrap gap-3">
          {year && <StatBox label="Year" value={year} />}
          <StatBox label="Seasons" value={show.number_of_seasons} />
          <StatBox label="Episodes" value={show.number_of_episodes} />
          <StatBox label="Status" value={show.status} />
          {show.in_production && <StatBox label="In Production" value="Yes" />}
        </div>

        <RatingsRow voteAverage={show.vote_average} externalScores={externalScores} aggRating={aggRating} />

        {/* Created by */}
        {show.created_by && show.created_by.length > 0 && (
          <div>
            <span className="text-neutral-400 text-sm">Created by </span>
            <span className="text-neutral-200 font-medium">
              {show.created_by.map((c) => c.name).join(", ")}
            </span>
          </div>
        )}

        {/* Overview */}
        {show.overview && (
          <div>
            <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-2">Overview</h2>
            <p className="text-neutral-300 leading-relaxed">{show.overview}</p>
          </div>
        )}

        {/* Dates */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {show.first_air_date && (
            <div>
              <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">First Aired</div>
              <div className="text-neutral-200">
                {formatLocalDate(show.first_air_date, { year: "numeric", month: "long", day: "numeric" })}
              </div>
            </div>
          )}
          {show.last_air_date && (
            <div>
              <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">Last Aired</div>
              <div className="text-neutral-200">
                {formatLocalDate(show.last_air_date, { year: "numeric", month: "long", day: "numeric" })}
              </div>
            </div>
          )}
          {show.homepage && (
            <div>
              <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">Homepage</div>
              <a
                href={show.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 hover:underline truncate block"
              >
                Official Site
              </a>
            </div>
          )}
        </div>

        {show.providers && <WhereToWatch providers={show.providers} />}

        {show.seasons?.length > 0 && (
          <SeasonInfo
            showId={show.id}
            seasons={show.seasons}
          />
        )}

        {show.credits?.cast.length > 0 && <CastBar cast={show.credits.cast} />}

        {show.external_ids && <ExternalLinksSection externalIds={show.external_ids} />}

        <ReviewsSection contentType="tv" contentId={show.id} user={user} />

        {show.recommendations?.results.length > 0 && (
          <RecommendationsGrid items={show.recommendations.results} linkPrefix="/tv" />
        )}
      </div>
    </div>
  );
}
