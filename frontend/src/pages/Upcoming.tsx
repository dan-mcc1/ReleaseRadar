import { useSearchParams } from "react-router-dom";
import MediaList from "../components/MediaList";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { useUpcoming } from "../hooks/api/useSearch";

type MediaType = "tv" | "movie";

const TYPE_TABS: { label: string; value: MediaType }[] = [
  { label: "Movies", value: "movie" },
  { label: "TV Shows", value: "tv" },
];

export default function Upcoming() {
  usePageTitle("Upcoming");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = (searchParams.get("type") as MediaType) ?? "movie";
  const page = Number(searchParams.get("page") ?? "1");

  const today = new Date();
  const minDate = today.toISOString().split("T")[0];
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const maxDate = nextMonth.toISOString().split("T")[0];

  const formatDateRange = () => {
    const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
    return `${today.toLocaleDateString("en-us", opts)} – ${nextMonth.toLocaleDateString("en-us", { ...opts, year: "numeric" })}`;
  };

  const { data, isPending: loading } = useUpcoming(activeType, page, minDate, maxDate);
  const rawItems = data?.results ?? [];
  const totalPages = data?.total_pages ?? 1;

  const results = {
    movies: activeType === "movie" ? (rawItems as Movie[]) : [],
    shows: activeType === "tv" ? (rawItems as Show[]) : [],
  };
  const total = rawItems.length;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-1">Coming Soon</h1>
        <p className="text-neutral-400 text-sm">{formatDateRange()}</p>
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

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {/* Results count */}
      {!loading && total > 0 && (
        <p className="text-neutral-500 text-sm mb-4">
          {activeType === "movie" ? "Movies" : "TV shows"} releasing in the next
          30 days — page {page} of {totalPages}
        </p>
      )}

      {/* Empty state */}
      {!loading && total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-neutral-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 className="text-neutral-300 font-medium mb-1">
            Nothing coming up
          </h3>
          <p className="text-neutral-500 text-sm">
            No releases found for the next 30 days
          </p>
        </div>
      )}

      {!loading && (
        <MediaList
          results={{ movies: results.movies, shows: results.shows, people: [] }}
          paginated
        />
      )}

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
