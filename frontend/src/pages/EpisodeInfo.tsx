import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL, BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";

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
  videos?: { results: { key: string; site: string; type: string; official: boolean }[] };
}

function getEpisodeTag(
  episodeNumber: number,
  episodeType: string | null | undefined,
  inProduction: boolean | null | undefined,
): { label: string; classes: string } | null {
  if (episodeNumber === 1) {
    return { label: "Season Premiere", classes: "bg-blue-600/20 text-blue-300 border border-blue-500/40" };
  }
  if (episodeType === "finale") {
    if (inProduction === false) {
      return { label: "Series Finale", classes: "bg-red-700/20 text-red-300 border border-red-500/40" };
    }
    return { label: "Season Finale", classes: "bg-orange-600/20 text-orange-300 border border-orange-500/40" };
  }
  if (episodeType === "mid_season") {
    return { label: "Mid-Season Finale", classes: "bg-yellow-600/20 text-yellow-300 border border-yellow-500/40" };
  }
  return null;
}

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ""}`.trim() : `${m}m`;
}

function PersonCard({ name, character, profilePath }: { name: string; character?: string; profilePath: string | null }) {
  return (
    <div className="flex-shrink-0 w-24 text-center">
      {profilePath ? (
        <img
          src={`${BASE_IMAGE_URL}/w185${profilePath}`}
          alt={name}
          className="w-24 h-36 object-cover rounded-xl mb-1"
        />
      ) : (
        <div className="w-24 h-36 rounded-xl bg-slate-700 flex items-center justify-center mb-1">
          <svg className="w-8 h-8 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
      )}
      <p className="text-xs font-medium text-slate-200 line-clamp-2">{name}</p>
      {character && <p className="text-xs text-slate-500 line-clamp-1">{character}</p>}
    </div>
  );
}

export default function EpisodeInfo() {
  const { showId, season, episode } = useParams<{ showId: string; season: string; episode: string }>();
  const [data, setData] = useState<EpisodeData | null>(null);
  const [showName, setShowName] = useState<string | null>(null);
  const [showInProduction, setShowInProduction] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  usePageTitle(data ? `${data.name}` : "Episode");

  const auth = getAuth(firebaseApp);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setToken(null); return; }
      const tok = await u.getIdToken();
      setToken(tok);
    });
    return unsub;
  }, []);

  // Fetch episode details + show name in parallel
  useEffect(() => {
    if (!showId || !season || !episode) return;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`${API_URL}/tv/${showId}/season/${season}/episode/${episode}`).then((r) => {
        if (!r.ok) throw new Error("Episode not found");
        return r.json();
      }),
      fetch(`${API_URL}/tv/${showId}`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([epData, showData]) => {
        setData(epData);
        setShowName(showData?.name ?? null);
        setShowInProduction(showData?.in_production ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [showId, season, episode]);

  // Check if this episode is already watched
  useEffect(() => {
    if (!token || !showId) return;
    fetch(`${API_URL}/watched-episode/${showId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : [])
      .then((eps: { season_number: number; episode_number: number }[]) => {
        setWatched(eps.some((e) => e.season_number === Number(season) && e.episode_number === Number(episode)));
      })
      .catch(() => {});
  }, [token, showId, season, episode]);

  async function toggleWatched() {
    if (!token || !showId || toggling) return;
    setToggling(true);
    const wasWatched = watched;
    setWatched(!wasWatched);
    try {
      const url = wasWatched ? `${API_URL}/watched-episode/remove` : `${API_URL}/watched-episode/add`;
      const method = wasWatched ? "DELETE" : "POST";
      const res = await fetch(
        `${url}?show_id=${showId}&season_number=${season}&episode_number=${episode}`,
        { method, headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error();
    } catch {
      setWatched(wasWatched); // revert on failure
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-red-400 text-lg">{error ?? "Episode not found."}</p>
        {showId && <Link to={`/tv/${showId}`} className="text-blue-400 hover:text-blue-300 text-sm mt-4 inline-block">← Back to show</Link>}
      </div>
    );
  }

  const trailer = data.videos?.results.find((v) => v.site === "YouTube" && (v.type === "Clip" || v.type === "Trailer"));
  const directors = data.credits?.crew.filter((c) => c.job === "Director") ?? [];
  const writers = data.credits?.crew.filter((c) => c.job === "Writer" || c.job === "Teleplay") ?? [];
  const guestStars = data.credits?.guest_stars ?? [];
  const regularCast = data.credits?.cast ?? [];
  const allCast = [...guestStars, ...regularCast].slice(0, 20);

  const heroSrc = data.still_path
    ? `${BASE_IMAGE_URL}/w1280${data.still_path}`
    : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-400 flex-wrap">
        {showName && showId && (
          <>
            <Link to={`/tv/${showId}`} className="hover:text-white transition-colors">{showName}</Link>
            <span>/</span>
          </>
        )}
        <Link to={`/tv/${showId}`} className="hover:text-white transition-colors">
          Season {data.season_number}
        </Link>
        <span>/</span>
        <span className="text-slate-200">Episode {data.episode_number}</span>
      </nav>

      {/* Hero image */}
      {heroSrc && (
        <div className="rounded-2xl overflow-hidden aspect-video w-full">
          <img src={heroSrc} alt={data.name} className="w-full h-full object-cover" />
        </div>
      )}

      {/* Title + metadata */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="bg-purple-600/20 text-purple-400 border border-purple-600/30 text-xs font-medium px-2 py-0.5 rounded">
                S{String(data.season_number).padStart(2, "0")}E{String(data.episode_number).padStart(2, "0")}
              </span>
              {(() => {
                const tag = getEpisodeTag(data.episode_number, data.episode_type, showInProduction);
                return tag ? (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${tag.classes}`}>{tag.label}</span>
                ) : null;
              })()}
              {data.vote_average != null && data.vote_average > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-400">
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  {data.vote_average.toFixed(1)}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">{data.name}</h1>
            <div className="flex items-center gap-3 text-sm text-slate-400 flex-wrap">
              {data.air_date && <span>{new Date(data.air_date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span>}
              {data.runtime != null && data.runtime > 0 && (
                <>
                  <span className="text-slate-600">·</span>
                  <span>{formatRuntime(data.runtime)}</span>
                </>
              )}
            </div>
          </div>

          {/* Watched toggle */}
          {token && (
            <button
              onClick={toggleWatched}
              disabled={toggling}
              className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all disabled:opacity-50 ${
                watched
                  ? "bg-green-700/30 border border-green-600/50 text-green-400 hover:bg-red-900/30 hover:border-red-600/40 hover:text-red-400"
                  : "bg-slate-800 border border-slate-600 text-slate-300 hover:bg-green-900/30 hover:border-green-600/40 hover:text-green-400"
              }`}
            >
              {toggling ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : watched ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {watched ? "Watched" : "Mark Watched"}
            </button>
          )}
        </div>
      </div>

      {/* Overview */}
      {data.overview && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-2">Overview</h2>
          <p className="text-slate-300 leading-relaxed">{data.overview}</p>
        </div>
      )}

      {/* Crew */}
      {(directors.length > 0 || writers.length > 0) && (
        <div className="flex flex-wrap gap-6">
          {directors.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Directed by</p>
              <p className="text-slate-200 text-sm">{directors.map((d) => d.name).join(", ")}</p>
            </div>
          )}
          {writers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Written by</p>
              <p className="text-slate-200 text-sm">{writers.map((w) => w.name).join(", ")}</p>
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
              <Link key={`${person.id}-${person.character}`} to={`/person/${person.id}`}>
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
      <div className="pt-4 border-t border-slate-800">
        <Link
          to={`/tv/${showId}`}
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to {showName ?? "show"}
        </Link>
      </div>
    </div>
  );
}
