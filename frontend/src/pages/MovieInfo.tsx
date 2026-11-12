import type { Movie } from "../types/calendar";
import type { MediaExternalIds, MediaVideo } from "../types/media";
import { formatLocalDate } from "../utils/date";
import { useParams, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import WatchButton from "../components/WatchButton";
import ReviewsSection from "../components/ReviewsSection";
import RewatchSection from "../components/RewatchSection";
import { useAuthLoading, useAuthUser } from "../hooks/useAuthUser";
import { useMediaInfo } from "../hooks/useMediaInfo";
import { usePageMeta } from "../hooks/usePageMeta";
import RatingsRow from "../components/media/RatingsRow";
import ExternalLinksSection from "../components/media/ExternalLinksSection";
import TrailerButton from "../components/media/TrailerButton";
import BackdropCard from "../components/media/BackdropCard";
import CastPreview from "../components/media/CastPreview";
import MediaActionList from "../components/media/MediaActionList";
import VideoGallery from "../components/media/VideoGallery";
import ContentRatingBadge from "../components/media/ContentRatingBadge";
import { BASE_IMAGE_URL } from "../constants";
import FriendsActivityWidget from "../components/FriendsActivityWidget";
import { ButtonLink, PlusIcon, SectionHeader, StarIcon, buttonClass } from "../components/ui";
import { RectangleStackIcon } from "@heroicons/react/24/outline";

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

const TABS = ["Overview", "Cast", "Reviews"] as const;
type Tab = (typeof TABS)[number];

export default function MovieInfo() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // An unknown ?tab= (an old link to a tab that no longer exists) shows Overview.
  const requestedTab = searchParams.get("tab") as Tab | null;
  const activeTab =
    requestedTab && TABS.includes(requestedTab) ? requestedTab : "Overview";
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
  const authLoading = useAuthLoading();
  // Only once auth has answered, so signed-in visitors never see it flash.
  const signedOut = !user && !authLoading;
  usePageMeta({ title: movie?.title, description: movie?.overview });

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

  const hasOtherRatings = Boolean(
    externalScores?.imdb ||
      externalScores?.rotten_tomatoes ||
      externalScores?.metacritic ||
      aggRating?.average,
  );

  const recommendations = movie.recommendations?.results ?? [];
  const hasRail = Boolean(user) || hasOtherRatings || recommendations.length > 0;

  // The poster already carries the title, so the page title goes on the backdrop instead.
  const titleArt = movie.logo_path ? (
    <h1>
      <img
        src={`${BASE_IMAGE_URL}/w500${movie.logo_path}`}
        alt={movie.title}
        className="max-h-12 sm:max-h-20 lg:max-h-28 max-w-full sm:max-w-md object-contain object-left drop-shadow-2xl"
      />
    </h1>
  ) : (
    <h1 className="text-2xl sm:text-4xl lg:text-5xl font-bold text-white drop-shadow-lg">
      {movie.title}
    </h1>
  );

  const hasProviders = Boolean(
    movie.providers?.flatrate?.length ||
      movie.providers?.rent?.length ||
      movie.providers?.buy?.length,
  );

  const keyFacts = (
    <>
      <SectionHeader title="Key facts" className="mb-3" />
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {movie.created_by && movie.created_by.length > 0 && (
          <>
            <span className="text-neutral-500">Director</span>
            <span className="font-medium">{movie.created_by.map((m) => m.name).join(", ")}</span>
          </>
        )}
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
    </>
  );

  return (
    <div className="pb-16 w-full">
      {/* Phones: one column. lg: side panel + main. 2xl: a third column for the rail. */}
      <div
        className={`mx-auto max-w-[1920px] px-6 sm:px-10 pt-6 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] gap-x-10 gap-y-6 items-start ${
          hasRail ? "2xl:grid-cols-[280px_minmax(0,1fr)_320px]" : ""
        }`}
      >
        <BackdropCard
          backdropPath={movie.backdrop_path}
          className="lg:col-start-2 lg:row-start-1"
          title={titleArt}
        >
          {trailer && <TrailerButton trailerKey={trailer.key} variant="overlay" />}
        </BackdropCard>

        {/* Side panel. It stays in view while the page scrolls, on windows tall enough to fit it. */}
        <aside className="lg:col-start-1 lg:row-start-1 lg:row-span-2 flex flex-col gap-4 min-w-0 lg:[@media(min-height:1150px)]:sticky lg:[@media(min-height:1150px)]:top-20">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 lg:block">
            {movie.poster_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w342${movie.poster_path}`}
                srcSet={`${BASE_IMAGE_URL}/w342${movie.poster_path} 342w, ${BASE_IMAGE_URL}/w500${movie.poster_path} 500w`}
                sizes="(min-width: 1024px) 280px, 96px"
                alt={`${movie.title} poster`}
                className="w-24 lg:w-full rounded-surface border border-white/10"
              />
            ) : (
              <div className="w-24 lg:w-full aspect-[2/3] rounded-surface bg-neutral-800 border border-white/10" />
            )}

            <div className="min-w-0 lg:mt-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-300">
                {movie.vote_average != null && movie.vote_average > 0 && (
                  <span className="flex items-center gap-1.5">
                    <StarIcon filled className="w-3.5 h-3.5 text-warning-400" />
                    {movie.vote_average.toFixed(1)}
                  </span>
                )}
                {releaseYear && <span>{releaseYear}</span>}
                {movie.runtime > 0 && <span>{formatRuntime(movie.runtime)}</span>}
              </div>
              {(certification || topGenres.length > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-400">
                  {certification && <ContentRatingBadge rating={certification} />}
                  {topGenres.length > 0 && <span>{topGenres.join(" · ")}</span>}
                </div>
              )}
            </div>
          </div>

          {((user && statusReady) || signedOut || (trailer && !movie.backdrop_path)) && (
            <div className="flex flex-wrap items-start gap-2">
              {/* Signed out: the way in is to track it, which needs an account. */}
              {signedOut && (
                <ButtonLink
                  to={`/signIn?next=${encodeURIComponent(`/movie/${movie.id}`)}`}
                  variant="primary"
                  icon={<PlusIcon />}
                >
                  Track this movie
                </ButtonLink>
              )}
              {user && statusReady && (
                <WatchButton
                  contentType="movie"
                  contentId={movie.id}
                  initialStatus={initialStatus}
                  initialRating={initialRating}
                  skipNotifyPrompt={movieHasReleased}
                />
              )}
              {/* With no backdrop to sit on, the trailer button goes here. */}
              {trailer && !movie.backdrop_path && <TrailerButton trailerKey={trailer.key} />}
            </div>
          )}
          {signedOut && (
            <p className="-mt-1 text-caption text-neutral-400">Tracking puts its release on your calendar and tells you when it's streaming.</p>
          )}

          {user && (
            <MediaActionList contentType="movie" contentId={movie.id} title={movie.title} />
          )}

          <div className="hidden lg:block pt-4 border-t border-neutral-800">{keyFacts}</div>
        </aside>

        {/* Main column */}
        <div className="lg:col-start-2 lg:row-start-2 min-w-0">
          <div className="border-b border-neutral-700 overflow-x-auto overflow-y-hidden scrollbar-none">
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

          <div className="mt-6">
            {activeTab === "Overview" && (
              <div className="@container space-y-10 min-w-0">
                {/* Synopsis and cast, with where-to-watch beside them when the column is wide enough. */}
                <div
                  className={`grid grid-cols-1 gap-10 items-start ${
                    hasProviders ? "@4xl:grid-cols-[minmax(0,1fr)_340px]" : ""
                  }`}
                >
                  <div className="space-y-10 min-w-0">
                    {movie.overview && (
                      <p className="text-title leading-relaxed text-neutral-100 max-w-3xl">
                        {movie.overview}
                      </p>
                    )}

                    <CastPreview
                      cast={movie.credits?.cast ?? []}
                      onSeeAll={() => setActiveTab("Cast")}
                      count={hasProviders ? 6 : 8}
                    />
                  </div>

                  {hasProviders && movie.providers && (
                    <div>
                      <SectionHeader title="Where to watch" divider className="mb-1" />
                      <WhereToWatch providers={movie.providers} hideTitle />
                    </div>
                  )}
                </div>

                {/* Collection */}
                {movie.belongs_to_collection && (
                  <div>
                    <SectionHeader title="Part of a collection" divider className="mb-4" />
                    <Link
                      to={`/collection/${movie.belongs_to_collection.id}`}
                      className={buttonClass("secondary")}
                    >
                      <RectangleStackIcon className="w-4 h-4 text-neutral-400" strokeWidth={2} aria-hidden="true" />
                      {movie.belongs_to_collection.name}
                    </Link>
                  </div>
                )}

                {user && initialStatus === "Watched" && (
                  <RewatchSection contentType="movie" contentId={movie.id} />
                )}

                {/* Videos */}
                {(movie.videos?.results?.length ?? 0) >= 2 && (
                  <div>
                    <SectionHeader title="Trailers & clips" divider className="mb-4" />
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
          </div>
        </div>

        {/* Below lg the key facts leave the side panel and sit under the main column. */}
        <div className="lg:hidden pt-4 border-t border-neutral-800">
          {keyFacts}
        </div>

        {/* Rail: under the main column until 2xl, then a column of its own. */}
        {hasRail && (
          <aside className="lg:col-start-2 2xl:col-start-3 2xl:row-start-1 2xl:row-span-2 min-w-0 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-1 gap-4 items-start">
            {user && <FriendsActivityWidget contentType="movie" contentId={movie.id} />}

            {/* The TMDb score is beside the title, so this card holds the rest. */}
            {hasOtherRatings && (
              <div>
                <SectionHeader title="More ratings" className="mb-4" />
                <RatingsRow
                  externalScores={externalScores}
                  aggRating={aggRating}
                  hideTitle
                />
              </div>
            )}

            {recommendations.length > 0 && (
              <div>
                <SectionHeader title="You might also like" className="mb-4" />
                <div className="flex flex-col gap-3">
                  {recommendations.slice(0, 8).map((rec) => (
                    <Link
                      key={rec.id}
                      to={`/movie/${rec.id}`}
                      className="flex gap-3 items-center group"
                    >
                      {rec.poster_path ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w92${rec.poster_path}`}
                          alt=""
                          loading="lazy"
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
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
