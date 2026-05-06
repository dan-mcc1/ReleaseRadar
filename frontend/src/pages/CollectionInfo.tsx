import { useParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import type { Movie } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import MediaList from "../components/MediaList";
import { useCollectionInfo } from "../hooks/api/useCollectionInfo";

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null]
    .filter(Boolean)
    .join(" ");
}

export default function CollectionInfo() {
  const { id } = useParams<{ id: string }>();
  const { data: rawCollection, isPending: loading, error } = useCollectionInfo(id);
  usePageTitle(rawCollection?.name);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">Loading collection…</p>
        </div>
      </div>
    );
  if (error) return <p className="text-error-400 p-6">{error?.message}</p>;
  if (!rawCollection)
    return <p className="text-neutral-400 p-6">Collection not found.</p>;

  const collection = {
    ...rawCollection,
    parts: [...(rawCollection.parts ?? [])].sort((a: Movie, b: Movie) =>
      (a.release_date ?? "").localeCompare(b.release_date ?? ""),
    ),
  };

  const releasedParts = collection.parts.filter((p: Movie) => p.release_date);
  const totalRuntime = releasedParts.reduce(
    (sum: number, p: Movie) => sum + (p.runtime ?? 0),
    0,
  );

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
          <div className="w-full h-64 bg-gradient-to-br from-neutral-800 to-neutral-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-neutral-950/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/60 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 flex items-end gap-5">
          {collection.poster_path && (
            <img
              src={`${BASE_IMAGE_URL}/w500${collection.poster_path}`}
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
          <div className="flex flex-col items-center bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 min-w-[80px]">
            <span className="text-neutral-100 font-bold text-lg leading-tight">
              {collection.parts.length}
            </span>
            <span className="text-neutral-500 text-xs mt-0.5">Films</span>
          </div>
          {totalRuntime > 0 && (
            <div className="flex flex-col items-center bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 min-w-[80px]">
              <span className="text-neutral-100 font-bold text-lg leading-tight">
                {formatRuntime(totalRuntime)}
              </span>
              <span className="text-neutral-500 text-xs mt-0.5">
                Total Runtime
              </span>
            </div>
          )}
        </div>

        {/* Overview */}
        {collection.overview && (
          <div>
            <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-2">
              Overview
            </h2>
            <p className="text-neutral-300 leading-relaxed">
              {collection.overview}
            </p>
          </div>
        )}

        {/* Films */}
        <div>
          <h2 className="text-xl font-semibold text-neutral-100 mb-4">
            Films in this Collection
          </h2>
          <MediaList
            results={{ movies: collection.parts, shows: [], people: [] }}
            paginated
          />
        </div>
      </div>
    </div>
  );
}
