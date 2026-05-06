import type { Movie } from "../types/calendar";
import type { MediaExternalIds, MediaVideo } from "../types/media";
import { formatLocalDate } from "../utils/date";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import WatchButton from "../components/WatchButton";
import FavoriteButton from "../components/FavoriteButton";
import RecommendButton from "../components/RecommendButton";
import ReviewsSection from "../components/ReviewsSection";
import { useAuthUser } from "../hooks/useAuthUser";
import { useMediaInfo } from "../hooks/useMediaInfo";
import { StatBox } from "../components/InfoPageWidgets";
import { usePageTitle } from "../hooks/usePageTitle";
import MediaHero from "../components/media/MediaHero";
import RatingsRow from "../components/media/RatingsRow";
import ExternalLinksSection from "../components/media/ExternalLinksSection";
import RecommendationsGrid from "../components/media/RecommendationsGrid";
import TrailerButton from "../components/media/TrailerButton";

type FullMovieData = Movie & {
  vote_average?: number;
  vote_count?: number;
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } | null;
  created_by: { id: number; credit_id: string; name: string; profile_path: string | null }[];
  credits: { cast: { id: number; name: string; profile_path: string; character: string }[] };
  external_ids: MediaExternalIds;
  recommendations: { results: Movie[] };
  videos: { results: MediaVideo[] };
};

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null].filter(Boolean).join(" ");
}

export default function MovieInfo() {
  const { id } = useParams<{ id: string }>();
  const { data: movie, loading, error, initialStatus, initialRating, statusReady, externalScores, aggRating } =
    useMediaInfo<FullMovieData>({ contentType: "movie", id, fetchUrl: `/movies/${id}/info` });
  const user = useAuthUser();
  usePageTitle(movie?.title);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">Loading movie info…</p>
        </div>
      </div>
    );
  if (error) return <p className="text-error-400 p-6">{error}</p>;
  if (!movie) return <p className="text-neutral-400 p-6">Movie not found.</p>;

  const year = movie.release_date
    ? formatLocalDate(movie.release_date, { year: "numeric", month: "long", day: "numeric" })
    : null;
  const trailer =
    movie.videos?.results?.find((v) => v.type === "Trailer" && v.site === "YouTube") ??
    movie.videos?.results?.find((v) => v.site === "YouTube");

  return (
    <div className="max-w-5xl mx-auto pb-16 w-full overflow-x-hidden">
      {/* Hero */}
      <MediaHero
        backdropPath={movie.backdrop_path}
        posterPath={movie.poster_path}
        logoPath={movie.logo_path}
        title={movie.title}
        tagline={movie.tagline}
        minHeight="280px"
      />

      {/* Content */}
      <div className="px-4 sm:px-6 mt-6 space-y-8">
        {/* Buttons row */}
        <div className="flex flex-wrap items-center gap-2">
          {user && statusReady && (
            <WatchButton
              contentType="movie"
              contentId={movie.id}
              initialStatus={initialStatus}
              initialRating={initialRating}
            />
          )}
          {user && <FavoriteButton contentType="movie" contentId={movie.id} />}
          {user && (
            <RecommendButton
              contentType="movie"
              contentId={movie.id}
              contentTitle={movie.title}
              contentPosterPath={movie.poster_path ?? null}
            />
          )}
          {trailer && <TrailerButton trailerKey={trailer.key} />}
        </div>

        {/* Genre pills */}
        {movie.genres && movie.genres.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {movie.genres.map((genre) => (
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
          {year && <StatBox label="Release Date" value={year} />}
          {movie.runtime > 0 && <StatBox label="Runtime" value={formatRuntime(movie.runtime)} />}
          <StatBox label="Status" value={movie.status} />
          {movie.budget > 0 && (
            <StatBox
              label="Budget"
              value={
                movie.budget >= 1_000_000_000
                  ? `$${(movie.budget / 1_000_000_000).toFixed(2)}B`
                  : `$${(movie.budget / 1_000_000).toFixed(0)}M`
              }
            />
          )}
          {movie.revenue > 0 && (
            <StatBox
              label="Revenue"
              value={
                movie.revenue >= 1_000_000_000
                  ? `$${(movie.revenue / 1_000_000_000).toFixed(2)}B`
                  : `$${(movie.revenue / 1_000_000).toFixed(0)}M`
              }
            />
          )}
        </div>

        {/* Ratings row */}
        <RatingsRow voteAverage={movie.vote_average} externalScores={externalScores} aggRating={aggRating} />

        {/* Directed by */}
        {movie.created_by && movie.created_by.length > 0 && (
          <div>
            <span className="text-neutral-400 text-sm">Directed by </span>
            <span className="text-neutral-200 font-medium">
              {movie.created_by.map((m) => m.name).join(", ")}
            </span>
          </div>
        )}

        {/* Overview */}
        {movie.overview && (
          <div>
            <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-2">Overview</h2>
            <p className="text-neutral-300 leading-relaxed">{movie.overview}</p>
          </div>
        )}

        {/* Part of collection */}
        {movie.belongs_to_collection && (
          <div>
            <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-2">
              Part of a Collection
            </h2>
            <Link
              to={`/collection/${movie.belongs_to_collection.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:border-primary-600/50 hover:bg-neutral-700 transition-all duration-150 text-neutral-200 text-sm font-medium"
            >
              <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              {movie.belongs_to_collection.name}
            </Link>
          </div>
        )}

        {/* Release date + homepage */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {movie.release_date && (
            <div>
              <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">Release Date</div>
              <div className="text-neutral-200">
                {formatLocalDate(movie.release_date, { year: "numeric", month: "long", day: "numeric" })}
              </div>
            </div>
          )}
          {movie.homepage && (
            <div>
              <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">Homepage</div>
              <a
                href={movie.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 hover:underline"
              >
                Official Site
              </a>
            </div>
          )}
        </div>

        {/* Where to Watch */}
        {movie.providers && <WhereToWatch providers={movie.providers} />}

        {/* Cast */}
        {movie.credits?.cast.length > 0 && <CastBar cast={movie.credits.cast} />}

        {/* External links */}
        {movie.external_ids && <ExternalLinksSection externalIds={movie.external_ids} />}

        {/* Reviews */}
        <ReviewsSection contentType="movie" contentId={movie.id} user={user} />

        {/* Recommendations */}
        <RecommendationsGrid items={movie.recommendations?.results ?? []} linkPrefix="/movie" />
      </div>
    </div>
  );
}
