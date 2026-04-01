import { useEffect, useState } from "react";
import { BASE_IMAGE_URL, API_URL } from "../constants";
import type { Movie } from "../types/calendar";
import { parseLocalDate, formatLocalDate } from "../utils/date";
import { useParams } from "react-router-dom";
import WhereToWatch from "../components/WhereToWatch";
import CastBar from "../components/CastBar";
import { Link } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../firebase";
import WatchButton from "../components/WatchButton";
import FavoriteButton from "../components/FavoriteButton";
import RecommendButton from "../components/RecommendButton";
import ReviewsSection from "../components/ReviewsSection";
import { onAuthStateChanged } from "firebase/auth";
import { usePageTitle } from "../hooks/usePageTitle";

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
  recommendations: { results: Movie[] };
  videos: {
    results: {
      id: string;
      key: string;
      site: string;
      type: string;
      official: boolean;
    }[];
  };
};

interface ExternalScores {
  imdb?: string;
  rotten_tomatoes?: string;
  metacritic?: string;
}

interface AggregateRating {
  average: number | null;
  count: number;
}

function RatingBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className={`flex flex-col items-center bg-slate-800 border rounded-xl px-4 py-3 min-w-[80px] ${color}`}
    >
      <span className="text-slate-100 font-bold text-lg leading-tight">
        {value}
      </span>
      <span className="text-slate-500 text-xs mt-0.5 whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

function StatBox({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex flex-col items-center bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[80px]">
      <span className="text-slate-100 font-bold text-lg leading-tight">
        {value}
      </span>
      <span className="text-slate-500 text-xs mt-0.5 whitespace-nowrap">
        {label}
      </span>
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

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null]
    .filter(Boolean)
    .join(" ");
}

export default function MovieInfo() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movie, setMovie] = useState<FullMovieData>();
  usePageTitle(movie?.title);
  const auth = getAuth(firebaseApp);
  const [user, setUser] = useState(auth.currentUser);
  const [externalScores, setExternalScores] = useState<ExternalScores | null>(
    null,
  );
  const [aggRating, setAggRating] = useState<AggregateRating | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsubscribe;
  }, [auth]);

  useEffect(() => {
    async function getData() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/movies/${id}/info`);
        if (!res.ok) throw new Error("Failed to fetch movie");
        const rawData = await res.json();
        let data: FullMovieData;
        if (rawData["watch/providers"]?.["results"]?.["US"]) {
          data = {
            ...rawData,
            providers: rawData["watch/providers"]["results"]["US"],
          };
        } else {
          data = rawData;
        }
        setMovie(data);
        // Fetch aggregate ratings
        fetch(
          `${API_URL}/reviews/aggregate?content_type=movie&content_id=${id}`,
        )
          .then((r) => r.json())
          .then(setAggRating)
          .catch(() => {});
        // Fetch RT/Metacritic via OMDB if we have an imdb_id
        const imdbId = data.external_ids?.imdb_id;
        if (imdbId) {
          fetch(
            `${API_URL}/reviews/external-scores?imdb_id=${encodeURIComponent(imdbId)}`,
          )
            .then((r) => r.json())
            .then(
              (scores) =>
                Object.keys(scores).length > 0 && setExternalScores(scores),
            )
            .catch(() => {});
        }
      } catch (err: any) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    getData();
  }, [id]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">Loading movie info…</p>
        </div>
      </div>
    );
  if (error) return <p className="text-red-400 p-6">{error}</p>;
  if (!movie) return <p className="text-slate-400 p-6">Movie not found.</p>;

  const year = movie.release_date
    ? parseLocalDate(movie.release_date).getFullYear()
    : null;
  const trailer =
    movie.videos?.results?.find(
      (v) => v.type === "Trailer" && v.site === "YouTube",
    ) ?? movie.videos?.results?.find((v) => v.site === "YouTube");

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* ── HERO BANNER ── */}
      <div className="relative overflow-hidden" style={{ minHeight: "280px" }}>
        {movie.backdrop_path ? (
          <img
            src={`${BASE_IMAGE_URL}/original${movie.backdrop_path}`}
            alt=""
            className="w-full h-72 md:h-96 object-cover object-top"
          />
        ) : (
          <div className="w-full h-64 bg-gradient-to-br from-slate-800 to-slate-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-slate-950/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 flex items-end gap-5">
          {movie.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w300${movie.poster_path}`}
              alt={movie.title}
              className="hidden md:block w-28 lg:w-36 rounded-xl shadow-2xl border border-white/10 flex-shrink-0"
            />
          )}

          <div className="min-w-0">
            {movie.logo_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w300${movie.logo_path}`}
                alt={movie.title}
                className="max-h-16 max-w-[280px] object-contain drop-shadow-2xl mb-1"
              />
            ) : (
              <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">
                {movie.title}
              </h1>
            )}
            {movie.tagline && (
              <p className="text-slate-300 italic text-sm mt-1">
                {movie.tagline}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="px-4 sm:px-6 mt-6 space-y-8">
        {/* Genres + watch button + trailer */}
        <div className="flex flex-wrap items-center gap-3">
          {user && <WatchButton contentType="movie" contentId={movie.id} />}
          {user && <FavoriteButton contentType="movie" contentId={movie.id} />}
          {user && (
            <RecommendButton
              contentType="movie"
              contentId={movie.id}
              contentTitle={movie.title}
              contentPosterPath={movie.poster_path ?? null}
            />
          )}
          {trailer && (
            <a
              href={`https://www.youtube.com/watch?v=${trailer.key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch Trailer
            </a>
          )}
          {movie.genres?.map((genre) => (
            <span
              key={genre.id}
              className="px-3 py-1 text-sm rounded-full bg-slate-700/60 border border-slate-600 text-slate-300"
            >
              {genre.name}
            </span>
          ))}
        </div>

        {/* Stat boxes */}
        <div className="flex flex-wrap gap-3">
          {year && <StatBox label="Year" value={year} />}
          {movie.runtime > 0 && (
            <StatBox label="Runtime" value={formatRuntime(movie.runtime)} />
          )}
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
        {(movie.vote_average || externalScores || aggRating?.average) && (
          <div>
            <h2 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">
              Ratings
            </h2>
            <div className="flex flex-wrap gap-3">
              {movie.vote_average != null && movie.vote_average > 0 && (
                <RatingBadge
                  label="TMDb"
                  value={`${movie.vote_average.toFixed(1)}/10`}
                  color="border-2 border-blue-800"
                />
              )}
              {externalScores?.imdb && (
                <RatingBadge
                  label="IMDB"
                  value={externalScores.imdb}
                  color={
                    parseInt(externalScores.imdb) >= 6.0
                      ? "border-2 border-green-800"
                      : "border-2 border-red-800"
                  }
                />
              )}
              {externalScores?.rotten_tomatoes && (
                <RatingBadge
                  label="Rotten Tomatoes"
                  value={externalScores.rotten_tomatoes}
                  color={
                    parseInt(externalScores.rotten_tomatoes) >= 60
                      ? "border-2 border-green-800"
                      : "border-2 border-red-800"
                  }
                />
              )}
              {externalScores?.metacritic && (
                <RatingBadge
                  label="Metacritic"
                  value={externalScores.metacritic.replace("/100", "")}
                  color="border-2 border-yellow-800/50"
                />
              )}
              {aggRating?.average && (
                <RatingBadge
                  label={`Users (${aggRating.count})`}
                  value={`${aggRating.average}/5 ★`}
                  color="border-2 border-purple-800"
                />
              )}
            </div>
          </div>
        )}

        {/* Created by */}
        {movie.created_by && movie.created_by.length > 0 && (
          <div>
            <span className="text-slate-400 text-sm">Directed by </span>
            <span className="text-slate-200 font-medium">
              {movie.created_by.map((m) => m.name).join(", ")}
            </span>
          </div>
        )}

        {/* Overview */}
        {movie.overview && (
          <div>
            <h2 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-2">
              Overview
            </h2>
            <p className="text-slate-300 leading-relaxed">{movie.overview}</p>
          </div>
        )}

        {/* Part of collection */}
        {movie.belongs_to_collection && (
          <div>
            <h2 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-2">
              Part of a Collection
            </h2>
            <Link
              to={`/collection/${movie.belongs_to_collection.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-blue-600/50 hover:bg-slate-700 transition-all duration-150 text-slate-200 text-sm font-medium"
            >
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              {movie.belongs_to_collection.name}
            </Link>
          </div>
        )}

        {/* Release date + homepage */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {movie.release_date && (
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">
                Release Date
              </div>
              <div className="text-slate-200">
                {formatLocalDate(movie.release_date, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
          )}
          {movie.homepage && (
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">
                Homepage
              </div>
              <a
                href={movie.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Official Site
              </a>
            </div>
          )}
        </div>

        {/* Where to Watch */}
        {movie.providers && <WhereToWatch providers={movie.providers} />}

        {/* Cast */}
        {movie.credits?.cast.length > 0 && (
          <CastBar cast={movie.credits.cast} />
        )}

        {/* External Links */}
        {movie.external_ids && (
          <div>
            <h2 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-3">
              External Links
            </h2>
            <div className="flex flex-wrap gap-2">
              {movie.external_ids.imdb_id && (
                <ExternalLink
                  href={`https://www.imdb.com/title/${movie.external_ids.imdb_id}`}
                  label="IMDb"
                />
              )}
              {movie.external_ids.tvdb_id && (
                <ExternalLink
                  href={`https://www.thetvdb.com/?id=${movie.external_ids.tvdb_id}`}
                  label="TVDB"
                />
              )}
              {movie.external_ids.wikidata_id && (
                <ExternalLink
                  href={`https://www.wikidata.org/wiki/${movie.external_ids.wikidata_id}`}
                  label="Wikidata"
                />
              )}
              {movie.external_ids.facebook_id && (
                <ExternalLink
                  href={`https://www.facebook.com/${movie.external_ids.facebook_id}`}
                  label="Facebook"
                />
              )}
              {movie.external_ids.instagram_id && (
                <ExternalLink
                  href={`https://www.instagram.com/${movie.external_ids.instagram_id}`}
                  label="Instagram"
                />
              )}
              {movie.external_ids.twitter_id && (
                <ExternalLink
                  href={`https://twitter.com/${movie.external_ids.twitter_id}`}
                  label="Twitter / X"
                />
              )}
            </div>
          </div>
        )}

        {/* Reviews */}
        <ReviewsSection contentType="movie" contentId={movie.id} user={user} />

        {/* Recommendations */}
        {movie.recommendations?.results.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold text-slate-100 mb-4">
              You Might Also Like
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {movie.recommendations.results.slice(0, 12).map((rec) => (
                <Link key={rec.id} to={`/movie/${rec.id}`} className="group">
                  {rec.poster_path ? (
                    <img
                      src={`${BASE_IMAGE_URL}/w300${rec.poster_path}`}
                      alt={rec.title}
                      className="w-full rounded-lg object-cover border border-slate-700 group-hover:border-slate-500 transition-all duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center">
                      <span className="text-slate-500 text-xs text-center px-1">
                        {rec.title}
                      </span>
                    </div>
                  )}
                  <p className="text-xs mt-1.5 text-slate-400 group-hover:text-slate-200 transition-colors text-center line-clamp-1">
                    {rec.title}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
