import type { Movie } from "../types/calendar";
import type { MediaExternalIds, MediaVideo } from "../types/media";
import { formatLocalDate } from "../utils/date";
import { useParams, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import WatchButton from "../components/WatchButton";
import FavoriteButton from "../components/FavoriteButton";
import RecommendButton from "../components/RecommendButton";
import ShelfButton from "../components/ShelfButton";
import ReviewsSection from "../components/ReviewsSection";
import RewatchSection from "../components/RewatchSection";
import { useAuthUser } from "../hooks/useAuthUser";
import { useMediaInfo } from "../hooks/useMediaInfo";
import { usePageTitle } from "../hooks/usePageTitle";
import RatingsRow from "../components/media/RatingsRow";
import ExternalLinksSection from "../components/media/ExternalLinksSection";
import RecommendationsGrid from "../components/media/RecommendationsGrid";
import TrailerButton from "../components/media/TrailerButton";
import VideoGallery from "../components/media/VideoGallery";
import ContentRatingBadge from "../components/media/ContentRatingBadge";
import { BASE_IMAGE_URL } from "../constants";

type FullMovieData = Movie & {
  vote_average?: number;
  vote_count?: number;
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } | null;
  created_by: {
    id: number;
    credit_id: string;
    name: string;
    profile_path: string | null;
  }[];
  credits: {
    cast: {
      id: number;
      name: string;
      profile_path: string | null;
      character: string;
    }[];
  };
  external_ids: MediaExternalIds;
  recommendations: { results: Movie[] };
  videos: { results: MediaVideo[] };
  release_dates?: {
    results: {
      iso_3166_1: string;
      release_dates: { certification: string; type: number }[];
    }[];
  };
};

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null]
    .filter(Boolean)
    .join(" ");
}

const TABS = ["Overview", "Cast", "Reviews", "Related"] as const;
type Tab = (typeof TABS)[number];

export default function MovieInfo() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as Tab) ?? "Overview";
  function setActiveTab(tab: Tab) {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }

  const {
    data: movie,
    loading,
    error,
    initialStatus,
    initialRating,
    statusReady,
    externalScores,
    aggRating,
  } = useMediaInfo<FullMovieData>({
    contentType: "movie",
    id,
    fetchUrl: `/movies/${id}/info`,
  });
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

  const releaseYear = movie.release_date
    ? new Date(movie.release_date + "T00:00:00").getFullYear()
    : null;
  const movieHasReleased = movie.release_date
    ? new Date(movie.release_date + "T00:00:00") <= new Date()
    : false;

  const trailer =
    movie.videos?.results?.find(
      (v) => v.type === "Trailer" && v.site === "YouTube",
    ) ?? movie.videos?.results?.find((v) => v.site === "YouTube");

  const certification = (() => {
    const us = movie.release_dates?.results?.find(
      (r) => r.iso_3166_1 === "US",
    );
    if (!us) return null;
    const sorted = [...us.release_dates].sort((a, b) => {
      if (a.type === 3) return -1;
      if (b.type === 3) return 1;
      if (a.type === 2) return -1;
      if (b.type === 2) return 1;
      return 0;
    });
    return sorted.find((d) => d.certification)?.certification ?? null;
  })();

  const topGenres = movie.genres?.slice(0, 3).map((g) => g.name) ?? [];

  return (
    <div className="pb-16 w-full overflow-x-hidden">
      {/* Hero */}
      <div className="relative h-[380px] md:h-[460px]">
        <div className="absolute inset-0 overflow-hidden">
          {movie.backdrop_path ? (
            <img
              src={`${BASE_IMAGE_URL}/original${movie.backdrop_path}`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-[center_25%]"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-neutral-950/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/80 via-neutral-950/30 to-transparent" />
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-6 sm:px-10 pb-8 flex items-end gap-8 z-10">
          {movie.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w342${movie.poster_path}`}
              alt={movie.title}
              className="hidden md:block w-32 lg:w-40 flex-shrink-0 rounded-xl shadow-2xl border border-white/10 self-end"
            />
          )}

          <div className="flex-1 min-w-0">
            <p className="text-white/55 text-[11px] font-mono tracking-[0.15em] uppercase mb-2">
              Film
              {movie.runtime > 0
                ? ` · ${formatRuntime(movie.runtime)}`
                : ""}
            </p>

            {movie.logo_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w500${movie.logo_path}`}
                alt={movie.title}
                className="max-h-20 max-w-xs object-contain drop-shadow-2xl mb-3"
              />
            ) : (
              <h1 className="text-4xl md:text-5xl font-bold text-white drop-shadow-lg mb-3">
                {movie.title}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75 mb-4">
              {movie.vote_average != null && movie.vote_average > 0 && (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  {movie.vote_average.toFixed(1)}
                </span>
              )}
              {releaseYear && <span>{releaseYear}</span>}
              {topGenres.length > 0 && <span>{topGenres.join(" · ")}</span>}
              {certification && <ContentRatingBadge rating={certification} />}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user && statusReady && (
                <WatchButton
                  contentType="movie"
                  contentId={movie.id}
                  initialStatus={initialStatus}
                  initialRating={initialRating}
                  skipNotifyPrompt={movieHasReleased}
                />
              )}
              {user && (
                <FavoriteButton contentType="movie" contentId={movie.id} />
              )}
              {user && <ShelfButton contentType="movie" contentId={movie.id} />}
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
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-10 mt-5">

        {/* Tabs */}
        <div className="mt-6 border-b border-neutral-700 overflow-x-auto scrollbar-none">
          <nav className="flex gap-0 min-w-max">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === tab
                    ? "border-primary-500 text-white"
                    : "border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="mt-6">
          {activeTab === "Overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10 min-w-0">
              {/* Left column */}
              <div className="space-y-10 min-w-0">
                {/* Synopsis */}
                {movie.overview && (
                  <div>
                    <p className="text-[1.25rem] leading-relaxed text-neutral-100 tracking-tight max-w-2xl font-light">
                      {movie.overview}
                    </p>
                    {movie.created_by && movie.created_by.length > 0 && (
                      <p className="text-neutral-500 text-sm mt-3">
                        Directed by{" "}
                        <span className="text-neutral-300">
                          {movie.created_by.map((m) => m.name).join(", ")}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* Collection */}
                {movie.belongs_to_collection && (
                  <div>
                    <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-neutral-800">
                      <h2 className="text-lg font-semibold tracking-tight">Part of a collection</h2>
                    </div>
                    <Link
                      to={`/collection/${movie.belongs_to_collection.id}`}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:border-primary-600/50 hover:bg-neutral-700 transition-all duration-150 text-neutral-200 text-sm font-medium"
                    >
                      <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      {movie.belongs_to_collection.name}
                    </Link>
                  </div>
                )}

                {/* Where to Watch */}
                {movie.providers && (
                  <div>
                    <div className="flex items-baseline gap-3 mb-1 pb-3 border-b border-neutral-800">
                      <h2 className="text-lg font-semibold tracking-tight">Where to watch</h2>
                    </div>
                    <WhereToWatch providers={movie.providers} hideTitle />
                  </div>
                )}

                {user && initialStatus === "Watched" && (
                  <RewatchSection contentType="movie" contentId={movie.id} />
                )}

                {/* Videos */}
                {(movie.videos?.results?.length ?? 0) >= 2 && (
                  <div>
                    <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-neutral-800">
                      <h2 className="text-lg font-semibold tracking-tight">Trailers &amp; clips</h2>
                    </div>
                    <VideoGallery videos={movie.videos.results} hideTitle />
                  </div>
                )}

                {movie.external_ids && (
                  <ExternalLinksSection
                    externalIds={movie.external_ids}
                    homepage={movie.homepage}
                  />
                )}
              </div>

              {/* Right rail */}
              <div className="flex flex-col gap-4 min-w-0">
                {/* Key facts */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                  <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">Key facts</div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                    <span className="text-neutral-500">Status</span>
                    <span className="font-medium">{movie.status}</span>
                    {movie.release_date && (
                      <>
                        <span className="text-neutral-500">Released</span>
                        <span className="font-medium">
                          {formatLocalDate(movie.release_date, { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                      </>
                    )}
                    {movie.runtime > 0 && (
                      <>
                        <span className="text-neutral-500">Runtime</span>
                        <span className="font-medium">{formatRuntime(movie.runtime)}</span>
                      </>
                    )}
                    {movie.budget > 0 && (
                      <>
                        <span className="text-neutral-500">Budget</span>
                        <span className="font-medium">
                          {movie.budget >= 1_000_000_000
                            ? `$${(movie.budget / 1_000_000_000).toFixed(2)}B`
                            : `$${(movie.budget / 1_000_000).toFixed(0)}M`}
                        </span>
                      </>
                    )}
                    {movie.revenue > 0 && (
                      <>
                        <span className="text-neutral-500">Revenue</span>
                        <span className="font-medium">
                          {movie.revenue >= 1_000_000_000
                            ? `$${(movie.revenue / 1_000_000_000).toFixed(2)}B`
                            : `$${(movie.revenue / 1_000_000).toFixed(0)}M`}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Ratings */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                  <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">Ratings</div>
                  <RatingsRow
                    voteAverage={movie.vote_average}
                    externalScores={externalScores}
                    aggRating={aggRating}
                    hideTitle
                  />
                </div>

                {/* You might also like */}
                {(movie.recommendations?.results ?? []).length > 0 && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                    <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">You might also like</div>
                    <div className="flex flex-col gap-3">
                      {movie.recommendations.results.slice(0, 4).map((rec) => (
                        <Link
                          key={rec.id}
                          to={`/movie/${rec.id}`}
                          className="flex gap-3 items-center group"
                        >
                          {rec.poster_path ? (
                            <img
                              src={`${BASE_IMAGE_URL}/w92${rec.poster_path}`}
                              alt={rec.title}
                              className="w-10 h-14 rounded-md object-cover flex-shrink-0 border border-neutral-700"
                            />
                          ) : (
                            <div className="w-10 h-14 rounded-md bg-neutral-800 flex-shrink-0 border border-neutral-700" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-200 group-hover:text-white truncate transition-colors">
                              {rec.title}
                            </p>
                            {rec.genres && rec.genres.length > 0 && (
                              <p className="text-xs text-neutral-500 mt-0.5">
                                {rec.genres.slice(0, 2).map((g) => g.name).join(" · ")}
                              </p>
                            )}
                          </div>
                          <svg className="w-4 h-4 text-neutral-600 flex-shrink-0 group-hover:text-neutral-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

          {activeTab === "Cast" && (
            <>
              {(movie.credits?.cast?.length ?? 0) > 0 ? (
                <CastBar cast={movie.credits.cast} />
              ) : (
                <p className="text-neutral-400">No cast info available.</p>
              )}
            </>
          )}

          {activeTab === "Reviews" && (
            <ReviewsSection
              contentType="movie"
              contentId={movie.id}
              user={user}
            />
          )}

          {activeTab === "Related" && (
            <>
              {(movie.recommendations?.results ?? []).length > 0 ? (
                <RecommendationsGrid
                  items={movie.recommendations.results}
                  linkPrefix="/movie"
                />
              ) : (
                <p className="text-neutral-400">No related movies found.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
