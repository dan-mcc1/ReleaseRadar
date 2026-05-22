import { useParams, Link, useSearchParams } from "react-router-dom";
import type { Show } from "../types/calendar";
import type { MediaExternalIds, MediaVideo } from "../types/media";
import { parseLocalDate, formatLocalDate } from "../utils/date";
import SeasonInfo from "../components/SeasonInfo";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import WatchButton from "../components/WatchButton";
import FavoriteButton from "../components/FavoriteButton";
import RecommendButton from "../components/RecommendButton";
import ShelfButton from "../components/ShelfButton";
import ReviewsSection from "../components/ReviewsSection";
import { useAuthUser } from "../hooks/useAuthUser";
import { usePageTitle } from "../hooks/usePageTitle";
import { useMediaInfo } from "../hooks/useMediaInfo";
import RatingsRow from "../components/media/RatingsRow";
import ExternalLinksSection from "../components/media/ExternalLinksSection";
import RecommendationsGrid from "../components/media/RecommendationsGrid";
import TrailerButton from "../components/media/TrailerButton";
import VideoGallery from "../components/media/VideoGallery";
import ContentRatingBadge from "../components/media/ContentRatingBadge";
import BingePlanWidget from "../components/BingePlanWidget";
import RewatchSection from "../components/RewatchSection";
import EpisodeRatingChart from "../components/EpisodeRatingChart";
import { BASE_IMAGE_URL } from "../constants";
import FriendsActivityWidget from "../components/FriendsActivityWidget";

type FullShowData = Show & {
  vote_average?: number;
  vote_count?: number;
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
  recommendations: { results: Show[] };
  videos: { results: MediaVideo[] };
  content_ratings?: {
    results: { iso_3166_1: string; rating: string }[];
  };
};

const TABS = ["Overview", "Episodes", "Cast", "Reviews", "Related"] as const;
type Tab = (typeof TABS)[number];

export default function ShowInfo() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as Tab) ?? "Overview";
  function setActiveTab(tab: Tab) {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }

  const {
    data: show,
    loading,
    error,
    initialStatus,
    initialRating,
    statusReady,
    externalScores,
    aggRating,
  } = useMediaInfo<FullShowData>({
    contentType: "tv",
    id,
    fetchUrl: `/tv/${id}/full`,
  });
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

  const startYear = show.first_air_date
    ? parseLocalDate(show.first_air_date).getFullYear()
    : null;
  const endYear = show.last_air_date
    ? parseLocalDate(show.last_air_date).getFullYear()
    : null;
  const isOngoing = show.status === "Returning Series" || show.in_production;
  const yearRange = startYear
    ? isOngoing
      ? `${startYear} – present`
      : endYear && endYear !== startYear
        ? `${startYear} – ${endYear}`
        : `${startYear}`
    : null;

  const trailer =
    show.videos?.results?.find(
      (v) => v.type === "Trailer" && v.site === "YouTube",
    ) ?? show.videos?.results?.find((v) => v.site === "YouTube");

  const certification =
    show.content_ratings?.results?.find((r) => r.iso_3166_1 === "US")?.rating ??
    null;

  const topGenres = show.genres?.slice(0, 3).map((g) => g.name) ?? [];

  return (
    <div className="pb-16 w-full overflow-x-hidden">
      {/* Hero */}
      <div className="relative h-[420px] md:h-[500px]">
        <div className="absolute inset-0 overflow-hidden">
          {show.backdrop_path ? (
            <img
              src={`${BASE_IMAGE_URL}/w1280${show.backdrop_path}`}
              srcSet={`${BASE_IMAGE_URL}/w780${show.backdrop_path} 780w, ${BASE_IMAGE_URL}/w1280${show.backdrop_path} 1280w`}
              sizes="100vw"
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-[center_25%]"
              loading="eager"
              fetchPriority="high"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-neutral-950/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/80 via-neutral-950/30 to-transparent" />
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-6 sm:px-10 pb-8 flex items-end gap-8 z-10">
          {show.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w342${show.poster_path}`}
              alt={show.name}
              className="hidden md:block w-36 lg:w-44 flex-shrink-0 rounded-xl shadow-2xl border border-white/10 self-end"
            />
          )}

          <div className="flex-1 min-w-0">
            <p className="text-white/55 text-[11px] font-mono tracking-[0.15em] uppercase mb-2">
              Series
              {show.number_of_seasons
                ? ` · ${show.number_of_seasons} Season${show.number_of_seasons !== 1 ? "s" : ""}`
                : ""}
            </p>

            {show.logo_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w500${show.logo_path}`}
                alt={show.name}
                className="max-h-20 max-w-xs object-contain drop-shadow-2xl mb-3"
              />
            ) : (
              <h1 className="text-4xl md:text-5xl font-bold text-white drop-shadow-lg mb-3">
                {show.name}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75 mb-4">
              {show.vote_average != null && show.vote_average > 0 && (
                <span className="flex items-center gap-1.5">
                  <svg
                    className="w-3.5 h-3.5 text-yellow-400"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  {show.vote_average.toFixed(1)}
                </span>
              )}
              {yearRange && <span>{yearRange}</span>}
              {topGenres.length > 0 && <span>{topGenres.join(" · ")}</span>}
              {certification && <ContentRatingBadge rating={certification} />}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user && statusReady && (
                <WatchButton
                  contentType="tv"
                  contentId={show.id}
                  initialStatus={initialStatus}
                  initialRating={initialRating}
                  skipNotifyPrompt={!isOngoing && show.status !== undefined}
                />
              )}
              {user && <FavoriteButton contentType="tv" contentId={show.id} />}
              {user && <ShelfButton contentType="tv" contentId={show.id} />}
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
                {show.overview && (
                  <div>
                    <p className="text-[1.25rem] leading-relaxed text-neutral-100 tracking-tight max-w-2xl font-light">
                      {show.overview}
                    </p>
                    {show.created_by && show.created_by.length > 0 && (
                      <p className="text-neutral-500 text-sm mt-3">
                        Created by{" "}
                        <span className="text-neutral-300">
                          {show.created_by.map((c) => c.name).join(", ")}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* Key facts + Ratings */}
                <div className="flex flex-wrap gap-4">
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shrink-0">
                    <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">Key facts</div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                      {show.created_by && show.created_by.length > 0 && (
                        <>
                          <span className="text-neutral-500">Creator</span>
                          <span className="font-medium">{show.created_by.map((c) => c.name).join(", ")}</span>
                        </>
                      )}
                      <span className="text-neutral-500">Status</span>
                      <span className={`font-medium ${isOngoing ? "text-primary-400" : ""}`}>
                        {isOngoing ? "● " : ""}{show.status}
                      </span>
                      <span className="text-neutral-500">Seasons</span>
                      <span className="font-medium">{show.number_of_seasons}</span>
                      <span className="text-neutral-500">Episodes</span>
                      <span className="font-medium">{show.number_of_episodes}</span>
                      {show.first_air_date && (
                        <>
                          <span className="text-neutral-500">Premiered</span>
                          <span className="font-medium">
                            {formatLocalDate(show.first_air_date, { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                        </>
                      )}
                      {!isOngoing && show.last_air_date && (
                        <>
                          <span className="text-neutral-500">Ended</span>
                          <span className="font-medium">
                            {formatLocalDate(show.last_air_date, { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 min-w-[300px]">
                    <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">Ratings</div>
                    <RatingsRow
                      voteAverage={show.vote_average}
                      externalScores={externalScores}
                      aggRating={aggRating}
                      hideTitle
                    />
                  </div>
                </div>

                {user &&
                  initialStatus !== "none" &&
                  initialStatus !== "Watched" && (
                    <BingePlanWidget showId={show.id} />
                  )}

                {/* Where to Watch */}
                {show.providers && (
                  <div>
                    <div className="flex items-baseline gap-3 mb-1 pb-3 border-b border-neutral-800">
                      <h2 className="text-lg font-semibold tracking-tight">Where to watch</h2>
                    </div>
                    <WhereToWatch providers={show.providers} hideTitle />
                  </div>
                )}

                {user && initialStatus === "Watched" && (
                  <RewatchSection contentType="tv" contentId={show.id} />
                )}

                {/* Videos */}
                {(show.videos?.results?.length ?? 0) >= 2 && (
                  <div>
                    <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-neutral-800">
                      <h2 className="text-lg font-semibold tracking-tight">Trailers &amp; clips</h2>
                    </div>
                    <VideoGallery videos={show.videos.results} hideTitle />
                  </div>
                )}

                {show.external_ids && (
                  <ExternalLinksSection
                    externalIds={show.external_ids}
                    homepage={show.homepage}
                  />
                )}
              </div>

              {/* Right rail */}
              <div className="flex flex-col gap-4 min-w-0">
                {user && <FriendsActivityWidget contentType="tv" contentId={show.id} />}
                {/* You might also like */}
                {(show.recommendations?.results?.length ?? 0) > 0 && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                    <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">You might also like</div>
                    <div className="flex flex-col gap-3">
                      {show.recommendations.results.slice(0, 4).map((rec) => (
                        <Link
                          key={rec.id}
                          to={`/tv/${rec.id}`}
                          className="flex gap-3 items-center group"
                        >
                          {rec.poster_path ? (
                            <img
                              src={`${BASE_IMAGE_URL}/w92${rec.poster_path}`}
                              alt={rec.name}
                              className="w-10 h-14 rounded-md object-cover flex-shrink-0 border border-neutral-700"
                            />
                          ) : (
                            <div className="w-10 h-14 rounded-md bg-neutral-800 flex-shrink-0 border border-neutral-700" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-200 group-hover:text-white truncate transition-colors">
                              {rec.name}
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

          {activeTab === "Episodes" && (
            <>
              {show.seasons && show.seasons.length > 0 ? (
                <SeasonInfo showId={show.id} seasons={show.seasons} />
              ) : (
                <p className="text-neutral-400">No season info available.</p>
              )}
              <EpisodeRatingChart showId={show.id} />
            </>
          )}

          {activeTab === "Cast" && (
            <>
              {(show.credits?.cast?.length ?? 0) > 0 ? (
                <CastBar cast={show.credits.cast} />
              ) : (
                <p className="text-neutral-400">No cast info available.</p>
              )}
            </>
          )}

          {activeTab === "Reviews" && (
            <ReviewsSection
              contentType="tv"
              contentId={show.id}
              user={user}
            />
          )}

          {activeTab === "Related" && (
            <>
              {show.recommendations?.results.length > 0 ? (
                <RecommendationsGrid
                  items={show.recommendations.results}
                  linkPrefix="/tv"
                />
              ) : (
                <p className="text-neutral-400">No related shows found.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
