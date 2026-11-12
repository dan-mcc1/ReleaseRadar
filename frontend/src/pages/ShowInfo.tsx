import { useParams, Link, useSearchParams } from "react-router-dom";
import type { Show } from "../types/calendar";
import type { MediaExternalIds, MediaVideo } from "../types/media";
import { parseLocalDate, formatLocalDate } from "../utils/date";
import SeasonInfo from "../components/SeasonInfo";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import WatchButton from "../components/WatchButton";
import ReviewsSection from "../components/ReviewsSection";
import { useAuthLoading, useAuthUser } from "../hooks/useAuthUser";
import { usePageMeta } from "../hooks/usePageMeta";
import { useMediaInfo } from "../hooks/useMediaInfo";
import RatingsRow from "../components/media/RatingsRow";
import ExternalLinksSection from "../components/media/ExternalLinksSection";
import TrailerButton from "../components/media/TrailerButton";
import BackdropCard from "../components/media/BackdropCard";
import CastPreview from "../components/media/CastPreview";
import MediaActionList from "../components/media/MediaActionList";
import VideoGallery from "../components/media/VideoGallery";
import ContentRatingBadge from "../components/media/ContentRatingBadge";
import BingePlanWidget from "../components/BingePlanWidget";
import RewatchSection from "../components/RewatchSection";
import EpisodeRatingChart from "../components/EpisodeRatingChart";
import UpNextCard from "../components/UpNextCard";
import { BASE_IMAGE_URL } from "../constants";
import FriendsActivityWidget from "../components/FriendsActivityWidget";
import { ButtonLink, PageState, PlusIcon, SectionHeader, StarIcon } from "../components/ui";
import { formatAirDate, isUnaired, seasonLabel } from "../utils/episodes";

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
  next_episode_to_air?: {
    season_number: number;
    episode_number: number;
    name: string;
    air_date: string | null;
  } | null;
};

/**
 * When a returning show is next on: the scheduled episode if TMDb has one,
 * otherwise the next season's premiere if it has a date. Null when nothing
 * is announced.
 */
function nextAiring(show: FullShowData): { label: string; value: string } | null {
  const ep = show.next_episode_to_air;
  if (ep?.air_date) {
    const code = `S${ep.season_number} E${ep.episode_number}`;
    return {
      label:
        ep.episode_number !== 1
          ? "Next episode"
          : ep.season_number === 1
            ? "Premieres"
            : "Next season",
      value: `${code} · ${formatAirDate(ep.air_date)}`,
    };
  }
  const upcoming = (show.seasons ?? [])
    .filter((s) => s.season_number > 0 && s.air_date && isUnaired(s.air_date))
    .sort((a, b) => a.season_number - b.season_number)[0];
  if (upcoming) {
    return {
      label: "Next season",
      value: `${seasonLabel(upcoming.season_number, upcoming.name)} · ${formatAirDate(upcoming.air_date)}`,
    };
  }
  return null;
}

const TABS = ["Overview", "Episodes", "Cast", "Reviews"] as const;
type Tab = (typeof TABS)[number];

export default function ShowInfo() {
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
    data: show,
    loading,
    error,
    initialStatus,
    initialRating,
    statusReady,
    externalScores,
    aggRating,
    refetch,
  } = useMediaInfo<FullShowData>({
    contentType: "tv",
    id,
    fetchUrl: `/tv/${id}/full`,
  });
  const user = useAuthUser();
  const authLoading = useAuthLoading();
  // Only once auth has answered, so signed-in visitors never see it flash.
  const signedOut = !user && !authLoading;
  usePageMeta({ title: show?.name, description: show?.overview });

  if (loading) return <PageState status="loading" label="Loading show…" />;
  if (error || !show)
    return (
      <PageState
        status="error"
        error={error}
        subject="show"
        back={{ to: "/search", label: "Search for a show" }}
        onRetry={refetch}
      />
    );

  const startYear = show.first_air_date
    ? parseLocalDate(show.first_air_date).getFullYear()
    : null;
  const endYear = show.last_air_date
    ? parseLocalDate(show.last_air_date).getFullYear()
    : null;
  const isOngoing = show.status === "Returning Series" || show.in_production;
  const upcoming = isOngoing ? nextAiring(show) : null;
  const tracking =
    !!user && statusReady && initialStatus !== undefined && initialStatus !== "none";
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

  const hasOtherRatings = Boolean(
    externalScores?.imdb ||
      externalScores?.rotten_tomatoes ||
      externalScores?.metacritic ||
      aggRating?.average,
  );

  const recommendations = show.recommendations?.results ?? [];
  const hasRail = Boolean(user) || hasOtherRatings || recommendations.length > 0;

  // The poster already carries the title, so the page title goes on the backdrop instead.
  const titleArt = show.logo_path ? (
    <h1>
      <img
        src={`${BASE_IMAGE_URL}/w500${show.logo_path}`}
        alt={show.name}
        className="max-h-12 sm:max-h-20 lg:max-h-28 max-w-full sm:max-w-md object-contain object-left drop-shadow-2xl"
      />
    </h1>
  ) : (
    <h1 className="text-2xl sm:text-4xl lg:text-5xl font-bold text-white drop-shadow-lg">
      {show.name}
    </h1>
  );

  const hasProviders = Boolean(
    show.providers?.flatrate?.length ||
      show.providers?.rent?.length ||
      show.providers?.buy?.length,
  );

  const keyFacts = (
    <>
      <SectionHeader title="Key facts" className="mb-3" />
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {show.created_by && show.created_by.length > 0 && (
          <>
            <span className="text-neutral-500">Creator</span>
            <span className="font-medium">{show.created_by.map((c) => c.name).join(", ")}</span>
          </>
        )}
        <span className="text-neutral-500">Status</span>
        <span className={`font-medium ${isOngoing ? "text-primary-400" : ""}`}>
          {isOngoing && <span className="inline-block size-1.5 rounded-full bg-primary-400 mr-2 align-middle" aria-hidden="true" />}
          {show.status}
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
        {isOngoing && (
          <>
            <span className="text-neutral-500">{upcoming?.label ?? "Next episode"}</span>
            <span className={`font-medium tabular ${upcoming ? "" : "text-neutral-400"}`}>
              {upcoming?.value ?? "Not announced yet"}
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
          backdropPath={show.backdrop_path}
          className="lg:col-start-2 lg:row-start-1"
          title={titleArt}
        >
          {trailer && <TrailerButton trailerKey={trailer.key} variant="overlay" />}
        </BackdropCard>

        {/* Side panel. It stays in view while the page scrolls, on windows tall enough to fit it. */}
        <aside className="lg:col-start-1 lg:row-start-1 lg:row-span-2 flex flex-col gap-4 min-w-0 lg:[@media(min-height:1150px)]:sticky lg:[@media(min-height:1150px)]:top-20">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 lg:block">
            {show.poster_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w342${show.poster_path}`}
                srcSet={`${BASE_IMAGE_URL}/w342${show.poster_path} 342w, ${BASE_IMAGE_URL}/w500${show.poster_path} 500w`}
                sizes="(min-width: 1024px) 280px, 96px"
                alt={`${show.name} poster`}
                className="w-24 lg:w-full rounded-surface border border-white/10"
              />
            ) : (
              <div className="w-24 lg:w-full aspect-[2/3] rounded-surface bg-neutral-800 border border-white/10" />
            )}

            <div className="min-w-0 lg:mt-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-300">
                {show.vote_average != null && show.vote_average > 0 && (
                  <span className="flex items-center gap-1.5">
                    <StarIcon filled className="w-3.5 h-3.5 text-warning-400" />
                    {show.vote_average.toFixed(1)}
                  </span>
                )}
                {show.number_of_seasons ? (
                  <span>
                    {show.number_of_seasons} season
                    {show.number_of_seasons !== 1 ? "s" : ""}
                  </span>
                ) : null}
                {yearRange && <span>{yearRange}</span>}
              </div>
              {(certification || topGenres.length > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-400">
                  {certification && <ContentRatingBadge rating={certification} />}
                  {topGenres.length > 0 && <span>{topGenres.join(" · ")}</span>}
                </div>
              )}
            </div>
          </div>

          {((user && statusReady) || signedOut || (trailer && !show.backdrop_path)) && (
            <div className="flex flex-wrap items-start gap-2">
              {/* Signed out: the way in is to track it, which needs an account. */}
              {signedOut && (
                <ButtonLink
                  to={`/signIn?next=${encodeURIComponent(`/tv/${show.id}`)}`}
                  variant="primary"
                  icon={<PlusIcon />}
                >
                  Track this show
                </ButtonLink>
              )}
              {user && statusReady && (
                <WatchButton
                  contentType="tv"
                  contentId={show.id}
                  initialStatus={initialStatus}
                  initialRating={initialRating}
                  skipNotifyPrompt={!isOngoing && show.status !== undefined}
                />
              )}
              {/* With no backdrop to sit on, the trailer button goes here. */}
              {trailer && !show.backdrop_path && <TrailerButton trailerKey={trailer.key} />}
            </div>
          )}
          {signedOut && (
            <p className="-mt-1 text-caption text-neutral-400">Tracking puts every new episode on your calendar, on the day it airs.</p>
          )}

          {user && (
            <MediaActionList contentType="tv" contentId={show.id} title={show.name} />
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
                    {show.overview && (
                      <p className="text-title leading-relaxed text-neutral-100 max-w-3xl">
                        {show.overview}
                      </p>
                    )}

                    <CastPreview
                      cast={show.credits?.cast ?? []}
                      onSeeAll={() => setActiveTab("Cast")}
                      count={hasProviders ? 6 : 8}
                    />
                  </div>

                  {hasProviders && show.providers && (
                    <div>
                      <SectionHeader title="Where to watch" divider className="mb-1" />
                      <WhereToWatch providers={show.providers} hideTitle />
                    </div>
                  )}
                </div>

                {tracking && initialStatus !== "Watched" && (
                  <UpNextCard showId={show.id} />
                )}

                {user &&
                  initialStatus !== "none" &&
                  initialStatus !== "Watched" && (
                    <BingePlanWidget showId={show.id} />
                  )}

                {user && initialStatus === "Watched" && (
                  <RewatchSection contentType="tv" contentId={show.id} />
                )}

                {/* Videos */}
                {(show.videos?.results?.length ?? 0) >= 2 && (
                  <div>
                    <SectionHeader title="Trailers & clips" divider className="mb-4" />
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
            )}

            {activeTab === "Episodes" && (
              <>
                {tracking && initialStatus !== "Watched" && (
                  <UpNextCard showId={show.id} />
                )}
                {show.seasons && show.seasons.length > 0 ? (
                  <SeasonInfo
                    showId={show.id}
                    seasons={show.seasons}
                    inProduction={show.in_production}
                  />
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
          </div>
        </div>

        {/* Below lg the key facts leave the side panel and sit under the main column. */}
        <div className="lg:hidden pt-4 border-t border-neutral-800">
          {keyFacts}
        </div>

        {/* Rail: under the main column until 2xl, then a column of its own. */}
        {hasRail && (
          <aside className="lg:col-start-2 2xl:col-start-3 2xl:row-start-1 2xl:row-span-2 min-w-0 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-1 gap-4 items-start">
            {user && <FriendsActivityWidget contentType="tv" contentId={show.id} />}

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
                      to={`/tv/${rec.id}`}
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
                          {rec.name}
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
