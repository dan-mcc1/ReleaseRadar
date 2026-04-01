import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BASE_IMAGE_URL, API_URL } from "../constants";
import type { Collection, Movie } from "../types/calendar";
import { parseLocalDate } from "../utils/date";
import { usePageTitle } from "../hooks/usePageTitle";
import WatchButton from "../components/WatchButton";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";

function getYear(movie: Movie): string | null {
  return movie.release_date
    ? String(parseLocalDate(movie.release_date).getFullYear())
    : null;
}

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null]
    .filter(Boolean)
    .join(" ");
}

export default function CollectionInfo() {
  const { id } = useParams<{ id: string }>();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState(getAuth(firebaseApp).currentUser);
  usePageTitle(collection?.name);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuth(firebaseApp), (u) =>
      setUser(u)
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    async function fetchCollection() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/collections/${id}`);
        if (!res.ok) throw new Error("Collection not found");
        const data = await res.json();
        // Sort parts by release date ascending
        data.parts = (data.parts ?? []).sort((a: Movie, b: Movie) => {
          const aDate = a.release_date ?? "";
          const bDate = b.release_date ?? "";
          return aDate.localeCompare(bDate);
        });
        setCollection(data);
      } catch (err: any) {
        setError(err.message ?? "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchCollection();
  }, [id]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">Loading collection…</p>
        </div>
      </div>
    );
  if (error) return <p className="text-red-400 p-6">{error}</p>;
  if (!collection) return <p className="text-slate-400 p-6">Collection not found.</p>;

  const releasedParts = collection.parts.filter((p) => p.release_date);
  const totalRuntime = releasedParts.reduce((sum, p) => sum + (p.runtime ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* Hero */}
      <div className="relative overflow-hidden" style={{ minHeight: "280px" }}>
        {collection.backdrop_path ? (
          <img
            src={`${BASE_IMAGE_URL}/original${collection.backdrop_path}`}
            alt=""
            className="w-full h-72 md:h-96 object-cover object-top"
          />
        ) : (
          <div className="w-full h-64 bg-gradient-to-br from-slate-800 to-slate-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-slate-950/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 flex items-end gap-5">
          {collection.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w300${collection.poster_path}`}
              alt={collection.name}
              className="hidden md:block w-28 lg:w-36 rounded-xl shadow-2xl border border-white/10 flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">
              {collection.name}
            </h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 mt-6 space-y-8">
        {/* Stats */}
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col items-center bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[80px]">
            <span className="text-slate-100 font-bold text-lg leading-tight">
              {collection.parts.length}
            </span>
            <span className="text-slate-500 text-xs mt-0.5">Films</span>
          </div>
          {totalRuntime > 0 && (
            <div className="flex flex-col items-center bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-[80px]">
              <span className="text-slate-100 font-bold text-lg leading-tight">
                {formatRuntime(totalRuntime)}
              </span>
              <span className="text-slate-500 text-xs mt-0.5">Total Runtime</span>
            </div>
          )}
        </div>

        {/* Overview */}
        {collection.overview && (
          <div>
            <h2 className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-2">
              Overview
            </h2>
            <p className="text-slate-300 leading-relaxed">{collection.overview}</p>
          </div>
        )}

        {/* Films */}
        <div>
          <h2 className="text-xl font-semibold text-slate-100 mb-4">
            Films in this Collection
          </h2>
          <div className="flex flex-col gap-3">
            {collection.parts.map((movie, index) => {
              const year = getYear(movie);
              return (
                <div
                  key={movie.id}
                  className="flex gap-4 bg-slate-800/60 border border-slate-700 hover:border-slate-600 rounded-xl transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:shadow-black/30"
                >
                  {/* Index + Poster */}
                  <Link
                    to={`/movie/${movie.id}`}
                    className="relative flex-shrink-0 w-36 sm:w-44 overflow-hidden rounded-l-xl"
                  >
                    {movie.backdrop_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w300${movie.backdrop_path}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : movie.poster_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w154${movie.poster_path}`}
                        alt=""
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="h-full w-full min-h-[88px] bg-slate-700 flex items-center justify-center">
                        <svg
                          className="w-8 h-8 text-slate-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1}
                            d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                      </div>
                    )}
                    <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-slate-900/80 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-slate-200">
                        {index + 1}
                      </span>
                    </div>
                  </Link>

                  {/* Info */}
                  <div className="flex flex-col justify-center gap-1.5 py-3 pr-3 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/movie/${movie.id}`}>
                          <h3 className="font-semibold text-slate-100 hover:text-white transition-colors line-clamp-1 text-sm sm:text-base">
                            {movie.title}
                          </h3>
                        </Link>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {year && (
                            <span className="text-xs text-slate-500">{year}</span>
                          )}
                          {movie.runtime != null && movie.runtime > 0 && (
                            <span className="flex items-center gap-1 text-xs text-slate-500">
                              <span className="text-slate-700">·</span>
                              {formatRuntime(movie.runtime)}
                            </span>
                          )}
                          {movie.vote_average != null && movie.vote_average > 0 && (
                            <span className="flex items-center gap-1 text-xs text-yellow-400 font-medium">
                              <span className="text-slate-700">·</span>
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                              </svg>
                              {movie.vote_average.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                      {user && (
                        <div className="flex-shrink-0 hidden sm:block">
                          <WatchButton contentType="movie" contentId={movie.id} />
                        </div>
                      )}
                    </div>
                    {movie.overview && (
                      <p className="text-slate-400 text-xs sm:text-sm line-clamp-2 leading-relaxed">
                        {movie.overview}
                      </p>
                    )}
                    {user && (
                      <div className="sm:hidden mt-1">
                        <WatchButton contentType="movie" contentId={movie.id} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
