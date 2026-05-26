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
import { useAuthUser } from "../hooks/useAuthUser";

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

function getEpisodeTag(
  episodeNumber: number,
  episodeType: string | null | undefined,
  inProduction: boolean | null | undefined,
): { label: string; bg: string; color: string } | null {
  if (episodeNumber === 1) {
    return { label: "Season Premiere", bg: "bg-primary-500/15", color: "text-primary-400" };
  }
  if (episodeType === "finale") {
    if (inProduction === false) {
      return { label: "Series Finale", bg: "bg-error-500/15", color: "text-error-400" };
    }
    return { label: "Season Finale", bg: "bg-warning-500/15", color: "text-warning-400" };
  }
  if (episodeType === "mid_season") {
    return { label: "Mid-Season Finale", bg: "bg-warning-500/15", color: "text-warning-400" };
  }
  return null;
}

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ""}`.trim() : `${m}m`;
}

function formatAirDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
}

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

  const showQuery = useQuery<{ name: string; in_production: boolean | null }>({
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
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (episodeQuery.isError || !data) {
    return (
      <div className="w-full max-w-3xl mx-auto px-6 py-16 text-center">
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

  const episodeTag = getEpisodeTag(
    data.episode_number,
    data.episode_type,
    showInProduction,
  );

  const seasonCode = `S${String(data.season_number).padStart(2, "0")}`;
  const episodeCode = `E${String(data.episode_number).padStart(2, "0")}`;

  const prevEp = prevEpisodeQuery.data;
  const nextEp = nextEpisodeQuery.data;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">

      {/* Breadcrumb */}
      <div className="px-6 md:px-10 pt-6 pb-3 flex items-center gap-2.5 font-mono text-[11.5px] tracking-wider flex-wrap">
        {showName && showId && (
          <>
            <Link to={`/tv/${showId}`} className="text-neutral-500 hover:text-neutral-300 transition-colors">
              {showName}
            </Link>
            <span className="text-neutral-700">/</span>
          </>
        )}
        <Link
          to={`/tv/${showId}/season/${data.season_number}`}
          className="text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Season {data.season_number}
        </Link>
        <span className="text-neutral-700">/</span>
        <span className="text-neutral-200 font-medium">
          Episode {String(data.episode_number).padStart(2, "0")}
        </span>
      </div>

      {/* Hero still */}
      {heroSrc && (
        <div className="px-6 md:px-10 pb-7 flex justify-center">
          <div
            className="relative rounded-2xl overflow-hidden w-full max-w-5xl"
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
            <span className="px-2.5 py-1 font-mono text-[11px] font-semibold tracking-widest bg-primary-500/15 text-primary-400 rounded-md">
              {seasonCode} · {episodeCode}
            </span>
            {episodeTag && (
              <span className={`px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase rounded-md ${episodeTag.bg} ${episodeTag.color}`}>
                {episodeTag.label}
              </span>
            )}
            {data.vote_average != null && data.vote_average > 0 && (
              <span className="px-2.5 py-1 text-[11px] font-semibold bg-warning-400/12 text-warning-400 rounded-md">
                ★ {data.vote_average.toFixed(1)}
                {data.vote_count != null && data.vote_count > 0 && (
                  <span className="text-warning-600 ml-1">· {data.vote_count.toLocaleString()}</span>
                )}
              </span>
            )}
            {data.runtime != null && data.runtime > 0 && (
              <span className="px-2.5 py-1 text-[11px] font-semibold font-mono tracking-widest bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md">
                {formatRuntime(data.runtime).toUpperCase()}
              </span>
            )}
            {data.air_date && (
              <span className="font-mono text-[11px] text-neutral-600 tracking-widest">
                · {formatAirDate(data.air_date)}
              </span>
            )}
          </div>

          {/* Episode label */}
          <div className="font-mono text-[10.5px] tracking-[0.15em] uppercase text-neutral-600 mb-1.5">
            Episode title
          </div>

          {/* Main title */}
          <h1 className="font-sans font-light italic text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[0.95] text-neutral-50 mb-0">
            {data.name}
          </h1>
        </div>

        {/* Watched panel */}
        <div
          className={`rounded-2xl p-4 border transition-all ${
            isWatched
              ? "bg-primary-500/10 border-transparent"
              : "bg-neutral-900 border-neutral-800"
          }`}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={toggleWatched}
              disabled={toggleEpisode.isPending}
              className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-50 ${
                isWatched
                  ? "bg-primary-500 text-neutral-950"
                  : "bg-neutral-800 text-neutral-500 border border-neutral-700 hover:border-primary-500/50"
              }`}
            >
              {toggleEpisode.isPending ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : isWatched ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold">
                {isWatched ? "Watched" : "Mark as watched"}
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                {isWatched ? "Logged to your activity" : "Logs to your activity"}
              </div>
            </div>
          </div>
          {isWatched && (
            <button
              onClick={toggleWatched}
              disabled={toggleEpisode.isPending}
              className="mt-3 w-full py-1.5 text-[11.5px] font-medium bg-transparent text-neutral-500 border border-neutral-700 rounded-lg hover:text-neutral-300 hover:border-neutral-600 transition-colors disabled:opacity-50"
            >
              Unmark watched
            </button>
          )}
        </div>
      </div>

      {/* Rating + Notes — only when watched */}
      {isWatched && (
        <div className="px-6 md:px-10 pb-7 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Rating */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="font-mono text-[10.5px] tracking-[0.15em] uppercase text-neutral-600 mb-4">
              Your rating
            </div>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() =>
                    setEpisodeRating(watchedEntry?.rating === star ? null : star)
                  }
                  disabled={annotateEpisode.isPending}
                  className="disabled:opacity-50 transition-transform hover:scale-110"
                >
                  <svg
                    className={`w-8 h-8 transition-colors ${
                      (watchedEntry?.rating ?? 0) >= star
                        ? "fill-warning-400 text-warning-400"
                        : "fill-neutral-800 text-neutral-800 hover:fill-warning-400/40"
                    }`}
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </button>
              ))}
              {watchedEntry?.rating != null && (
                <span className="ml-3 font-sans italic text-[32px] leading-none text-warning-400 tracking-tight">
                  {watchedEntry.rating}
                  <span className="text-neutral-600 not-italic text-2xl">/5</span>
                </span>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="font-mono text-[10.5px] tracking-[0.15em] uppercase text-neutral-600">
                Your notes
              </span>
              <span className="flex-1" />
              {!notesOpen && (
                <button
                  onClick={() => {
                    setNotesDraft(watchedEntry?.notes ?? "");
                    setNotesOpen(true);
                  }}
                  className="text-[11.5px] text-primary-400 hover:text-primary-300 font-medium transition-colors"
                >
                  {watchedEntry?.notes ? "Edit" : "+ Add note"}
                </button>
              )}
            </div>
            {notesOpen ? (
              <div className="space-y-2">
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What did you think?"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 resize-none focus:outline-none focus:border-primary-500 font-sans"
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setNotesOpen(false)}
                    className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitNotes}
                    disabled={annotateEpisode.isPending}
                    className="text-sm px-3 py-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    {annotateEpisode.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : watchedEntry?.notes ? (
              <p className="font-sans italic text-base text-neutral-300 leading-relaxed">
                "{watchedEntry.notes}"
              </p>
            ) : (
              <p className="font-sans italic text-sm text-neutral-600">
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
              <div className="mb-4">
                <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-neutral-500">Synopsis</div>
                <div className="h-px w-full bg-neutral-800 mt-2" />
              </div>
              {shouldHideOverview && !overviewRevealed ? (
                <button
                  onClick={() => setOverviewRevealed(true)}
                  className="inline-flex items-center gap-2 bg-neutral-900/60 hover:bg-neutral-900 border border-warning-500/30 rounded-lg px-4 py-3 text-sm text-neutral-300 hover:text-neutral-100 transition-colors"
                >
                  <svg className="w-4 h-4 text-warning-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span className="italic">Synopsis hidden — you haven't reached this episode yet. Click to reveal.</span>
                </button>
              ) : (
                <p className="font-sans font-light text-xl md:text-2xl leading-relaxed text-neutral-200 max-w-2xl">
                  {data.overview}
                </p>
              )}
            </div>
          )}

          {(directors.length > 0 || writers.length > 0) && (
            <div>
              <div className="font-mono text-[10.5px] tracking-[0.15em] uppercase text-neutral-600 mb-4">
                Crew
              </div>
              <div className="flex flex-col gap-4">
                {directors.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] text-neutral-600 tracking-[0.08em] uppercase">
                      Directed by
                    </div>
                    <div className="font-sans italic text-lg mt-1 tracking-tight text-neutral-200">
                      {directors.map((d) => d.name).join(", ")}
                    </div>
                  </div>
                )}
                {writers.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] text-neutral-600 tracking-[0.08em] uppercase">
                      Written by
                    </div>
                    <div className="font-sans italic text-lg mt-1 tracking-tight text-neutral-200">
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
          <div className="mb-5">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-neutral-500">Cast</div>
              <span className="font-mono text-[10px] text-neutral-700">{allCast.length}</span>
            </div>
            <div className="h-px w-full bg-neutral-800 mt-2" />
          </div>
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
                <p className="text-[12px] font-semibold text-neutral-200 leading-tight line-clamp-2 group-hover:text-white transition-colors">
                  {person.name}
                </p>
                {person.character && (
                  <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-1">
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
            className={`flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
              prevEp
                ? "bg-neutral-900 border-neutral-800 hover:border-neutral-700 cursor-pointer"
                : "bg-neutral-900/40 border-neutral-800/40 opacity-40 cursor-default"
            }`}
          >
            <svg className="w-4 h-4 text-neutral-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-neutral-600 tracking-[0.08em] uppercase mb-1">
                ← Previous · {seasonCode} E{String(prevEpNum).padStart(2, "0")}
              </div>
              <div className="font-sans italic text-[17px] tracking-tight text-neutral-200 truncate">
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
            className={`flex items-center gap-4 p-4 rounded-xl border text-right justify-end transition-all ${
              nextEp
                ? "bg-primary-500/10 border-transparent hover:bg-primary-500/15 cursor-pointer"
                : "bg-neutral-900/40 border-neutral-800/40 opacity-40 cursor-default"
            }`}
          >
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-primary-600 tracking-[0.08em] uppercase mb-1">
                Next · {seasonCode} E{String(nextEpNum).padStart(2, "0")} →
              </div>
              <div className="font-sans italic text-[17px] tracking-tight text-neutral-200 truncate">
                {nextEp?.name ?? "—"}
              </div>
            </div>
            <svg className="w-4 h-4 text-primary-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
