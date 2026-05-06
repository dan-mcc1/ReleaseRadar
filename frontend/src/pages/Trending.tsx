import { useSearchParams } from "react-router-dom";
import type { Movie, Show } from "../types/calendar";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";
import { useTrending } from "../hooks/api/useSearch";

type MediaType = "movie" | "tv";

const TYPE_TABS: { label: string; value: MediaType }[] = [
  { label: "Movies", value: "movie" },
  { label: "TV Shows", value: "tv" },
];

export default function Trending() {
  usePageTitle("Trending");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = (searchParams.get("type") as MediaType) ?? "movie";
  const page = Number(searchParams.get("page") ?? "1");

  const { data, isPending: loading } = useTrending(activeType, page);
  const items = data?.results ?? [];
  const totalPages = data?.total_pages ?? 1;

  const movies = activeType === "movie" ? (items as Movie[]) : [];
  const shows = activeType === "tv" ? (items as Show[]) : [];
  const results = { movies, shows, people: [] };
  const total = items.length;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-white">Trending</h1>
          <span className="text-lg">🔥</span>
        </div>
        <p className="text-neutral-400">What everyone's watching right now</p>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-6">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setSearchParams({ type: tab.value, page: "1" })}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeType === tab.value
                ? "bg-primary-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {!loading && total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-400">
            No trending content available right now.
          </p>
        </div>
      )}

      {!loading && <MediaList results={results} paginated />}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={() =>
              setSearchParams({
                type: activeType,
                page: String(Math.max(1, page - 1)),
              })
            }
            disabled={page === 1}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-neutral-400 text-sm">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() =>
              setSearchParams({
                type: activeType,
                page: String(Math.min(totalPages, page + 1)),
              })
            }
            disabled={page === totalPages}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
