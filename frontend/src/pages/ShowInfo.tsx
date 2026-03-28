import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { BASE_IMAGE_URL, API_URL } from "../constants";
import type { Show, Episode } from "../types/calendar";
import { parseLocalDate, formatLocalDate } from "../utils/date";
import SeasonInfo from "../components/SeasonInfo";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import { Link } from "react-router-dom";
import WatchButton from "../components/WatchButton";
import FavoriteButton from "../components/FavoriteButton";
import RecommendButton from "../components/RecommendButton";
import { firebaseApp } from "../firebase";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { usePageTitle } from "../hooks/usePageTitle";

type FullShowData = Show & {
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
      profile_path: string;
      character: string;
    }[];
  };
  external_ids: {
    imdb_id: string;
    tvdb_id: string;
    wikidata_id: string;
    facebook_id: string;
    instagram_id: string;
    twitter_id: string;
  };
  recommendations: { results: Show[] };
  videos: { results: { id: string; key: string; site: string; type: string; official: boolean }[] };
};

function StatBox({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex flex-col items-center bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[80px]">
      <span className="text-slate-100 font-bold text-lg leading-tight">{value}</span>
      <span className="text-slate-500 text-xs mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-blue-400 bg-slate-800 border border-slate-700 hover:border-blue-600/50 px-3 py-1.5 rounded-lg transition-all duration-150"
    >
      {label}
    </a>
  );
}

export default function ShowInfo() {
  const { id } = useParams<{ id: string }>();
  const [show, setShow] = useState<FullShowData | null>(null);
  usePageTitle(show?.name);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const auth = getAuth(firebaseApp);
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsubscribe;
  }, [auth]);

  useEffect(() => {
    if (!id) return;
    async function fetchShow() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/tv/${id}/full`);
        if (!res.ok) throw new Error("Failed to fetch show info");
        const rawData = await res.json();
        let data: FullShowData;
        if (rawData["watch/providers"]["results"]["US"]) {
          data = { ...rawData, providers: rawData["watch/providers"]["results"]["US"] || null };
        } else {
          data = rawData;
        }
        setShow(data);
      } catch (err: any) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchShow();
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Loading show info…</p>
      </div>
    </div>
  );
  if (error) return <p className="text-red-400 p-6">{error}</p>;
  if (!show) return <p className="text-slate-400 p-6">Show not found.</p>;

  const year = show.first_air_date ? parseLocalDate(show.first_air_date).getFullYear() : null;
  const trailer = show.videos?.results?.find(
    (v) => v.type === "Trailer" && v.site === "YouTube"
  ) ?? show.videos?.results?.find((v) => v.site === "YouTube");

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* ── HERO BANNER ── */}
      <div className="relative overflow-hidden" style={{ minHeight: "320px" }}>
        {show.backdrop_path ? (
          <img
            src={`${BASE_IMAGE_URL}/original${show.backdrop_path}`}
            alt=""
            className="w-full h-80 md:h-96 object-cover object-top"
          />
        ) : (
          <div className="w-full h-64 bg-gradient-to-br from-slate-800 to-slate-900" />
        )}
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-slate-950/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 to-transparent" />

        {/* Hero content */}
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 flex items-end gap-5">
          {/* Poster */}
          {show.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w300${show.poster_path}`}
              alt={show.name}
              className="hidden sm:block w-28 md:w-36 rounded-xl shadow-2xl border border-white/10 flex-shrink-0 -mb-1"
            />
          )}

          {/* Title / logo */}
          <div className="min-w-0">
            {show.logo_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w300${show.logo_path}`}
                alt={show.name}
                className="max-h-16 max-w-[280px] object-contain drop-shadow-2xl mb-1"
              />
            ) : (
              <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">{show.name}</h1>
            )}
            {show.tagline && (
              <p className="text-slate-300 italic text-sm mt-1">{show.tagline}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="px-4 sm:px-6 mt-6 space-y-8">

        {/* Top meta row: genres + watch button + trailer */}
        <div className="flex flex-wrap items-center gap-3">
          {user && <WatchButton contentType="tv" contentId={show.id} />}
          {user && <FavoriteButton contentType="tv" contentId={show.id} />}
          {user && <RecommendButton contentType="tv" contentId={show.id} contentTitle={show.name} contentPosterPath={show.poster_path ?? null} />}
          {trailer && (
            <a
              href={`https://www.youtube.com/watch?v=${trailer.key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch Trailer
            </a>
          )}
          {show.genres?.map((genre) => (
            <span key={genre.id} className="px-3 py-1 text-sm rounded-full bg-slate-700/60 border border-slate-600 text-slate-300">
              {genre.name}
            </span>
          ))}
        </div>

        {/* Stat boxes */}
        <div className="flex flex-wrap gap-3">
          {year && <StatBox label="Year" value={year} />}
          <StatBox label="Seasons" value={show.number_of_seasons} />
          <StatBox label="Episodes" value={show.number_of_episodes} />
          <StatBox label="Status" value={show.status} />
          {show.in_production && <StatBox label="In Production" value="Yes" />}
        </div>

        {/* Created by */}
        {show.created_by && show.created_by.length > 0 && (
          <div>
            <span className="text-slate-400 text-sm">Created by </span>
            <span className="text-slate-200 font-medium">
              {show.created_by.map((c) => c.name).join(", ")}
            </span>
          </div>
        )}

        {/* Overview */}
        {show.overview && (
          <div>
            <h2 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-2">Overview</h2>
            <p className="text-slate-300 leading-relaxed">{show.overview}</p>
          </div>
        )}

        {/* Dates */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {show.first_air_date && (
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">First Aired</div>
              <div className="text-slate-200">{formatLocalDate(show.first_air_date, { year: "numeric", month: "long", day: "numeric" })}</div>
            </div>
          )}
          {show.last_air_date && (
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Last Aired</div>
              <div className="text-slate-200">{formatLocalDate(show.last_air_date, { year: "numeric", month: "long", day: "numeric" })}</div>
            </div>
          )}
          {show.homepage && (
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Homepage</div>
              <a href={show.homepage} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate block">
                Official Site
              </a>
            </div>
          )}
        </div>

        {/* Where to Watch */}
        {show.providers && <WhereToWatch providers={show.providers} />}

        {/* Cast */}
        {show.credits?.cast.length > 0 && <CastBar cast={show.credits.cast} />}

        {/* External Links */}
        {show.external_ids && (
          <div>
            <h2 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">External Links</h2>
            <div className="flex flex-wrap gap-2">
              {show.external_ids.imdb_id && <ExternalLink href={`https://www.imdb.com/title/${show.external_ids.imdb_id}`} label="IMDb" />}
              {show.external_ids.tvdb_id && <ExternalLink href={`https://www.thetvdb.com/?id=${show.external_ids.tvdb_id}`} label="TVDB" />}
              {show.external_ids.wikidata_id && <ExternalLink href={`https://www.wikidata.org/wiki/${show.external_ids.wikidata_id}`} label="Wikidata" />}
              {show.external_ids.facebook_id && <ExternalLink href={`https://www.facebook.com/${show.external_ids.facebook_id}`} label="Facebook" />}
              {show.external_ids.instagram_id && <ExternalLink href={`https://www.instagram.com/${show.external_ids.instagram_id}`} label="Instagram" />}
              {show.external_ids.twitter_id && <ExternalLink href={`https://twitter.com/${show.external_ids.twitter_id}`} label="Twitter / X" />}
            </div>
          </div>
        )}

        {/* Seasons */}
        {show.seasons?.length > 0 && <SeasonInfo showId={show.id} seasons={show.seasons} />}

        {/* Recommendations */}
        {show.recommendations?.results.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold text-slate-100 mb-4">You Might Also Like</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {show.recommendations.results.slice(0, 12).map((rec) => (
                <Link key={rec.id} to={`/tv/${rec.id}`} className="group">
                  {rec.poster_path ? (
                    <img
                      src={`${BASE_IMAGE_URL}/w300${rec.poster_path}`}
                      alt={rec.name}
                      className="w-full rounded-lg object-cover border border-slate-700 group-hover:border-slate-500 transition-all duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center">
                      <span className="text-slate-500 text-xs text-center px-1">{rec.name}</span>
                    </div>
                  )}
                  <p className="text-xs mt-1.5 text-slate-400 group-hover:text-slate-200 transition-colors text-center line-clamp-1">{rec.name}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
