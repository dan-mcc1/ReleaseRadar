import { useEffect, useState } from "react";
import { API_URL } from "../constants";
import MediaList from "../components/MediaList";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";

type SearchType = "tv" | "movie";

export default function Upcoming() {
  usePageTitle("Upcoming");
  const [results, setResults] = useState<{ movies: Movie[]; shows: Show[] }>({
    shows: [],
    movies: [],
  });
  const [searchType, setSearchType] = useState<SearchType>("movie");
  const [loading, setLoading] = useState(false);

  const today = new Date();
  const min_date = today.toISOString().split("T")[0];
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const max_date = nextMonth.toISOString().split("T")[0];

  const formatDateRange = () => {
    const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
    return `${today.toLocaleDateString("en-us", opts)} – ${nextMonth.toLocaleDateString("en-us", { ...opts, year: "numeric" })}`;
  };

  useEffect(() => {
    async function fetchUpcoming() {
      setLoading(true);
      try {
        const endpoint = searchType === "tv" ? "tv" : "movie";
        const params = new URLSearchParams({ min_date, max_date });
        const res = await fetch(
          `${API_URL}/search/${endpoint}/upcoming?${params.toString()}`,
        );
        if (!res.ok) throw new Error("Failed to fetch upcoming");
        const data = await res.json();
        if (searchType === "tv") {
          setResults({ movies: [], shows: data.results ?? [] });
        } else {
          setResults({ movies: data.results ?? [], shows: [] });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchUpcoming();
  }, [searchType]);

  const total = results.movies.length + results.shows.length;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-1">Coming Soon</h1>
        <p className="text-slate-400 text-sm">{formatDateRange()}</p>
      </div>

      {/* Type toggle */}
      <div className="flex gap-1 border-b border-slate-700 mb-6">
        {(["movie", "tv"] as SearchType[]).map((type) => (
          <button
            key={type}
            onClick={() => setSearchType(type)}
            className={`px-5 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px ${
              searchType === type
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {type === "movie" ? "Movies" : "TV Shows"}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {/* Results count */}
      {!loading && total > 0 && (
        <p className="text-slate-500 text-sm mb-4">
          {total} {searchType === "movie" ? "movies" : "shows"} releasing in the
          next 30 days
        </p>
      )}

      {/* Empty state */}
      {!loading && total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-slate-500"
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
          <h3 className="text-slate-300 font-medium mb-1">Nothing coming up</h3>
          <p className="text-slate-500 text-sm">
            No releases found for the next 30 days
          </p>
        </div>
      )}

      {!loading && (
        <MediaList
          results={{ movies: results.movies, shows: results.shows, people: [] }}
        />
      )}
    </div>
  );
}
