import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Show, Movie, Person } from "../types/calendar";
import { API_URL } from "../constants";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";

export default function Search() {
  usePageTitle("Search");
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const query = searchParams.get("q") || "";
  const searchType = searchParams.get("type") || "all";

  const [results, setResults] = useState<{
    movies: Movie[];
    shows: Show[];
    people: Person[];
  }>({ movies: [], shows: [], people: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) {
      setResults({ movies: [], shows: [], people: [] });
      return;
    }

    async function fetchResults() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.append("query", query);
        params.append("type", searchType);
        const res = await fetch(`${API_URL}/search?${params}`);
        if (!res.ok) throw new Error("Failed to fetch search results");
        const data = await res.json();
        setResults({
          movies: data.movies ?? [],
          shows: data.shows ?? [],
          people: data.people ?? [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchResults();
  }, [query, searchType]);

  const total =
    results.movies.length + results.shows.length + results.people.length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-6">
        {query ? (
          <>
            <h1 className="text-2xl font-bold text-white">
              Results for <span className="text-blue-400">"{query}"</span>
            </h1>
            {!loading && total > 0 && (
              <p className="text-slate-400 text-sm mt-1">
                {total} result{total !== 1 ? "s" : ""} found
              </p>
            )}
          </>
        ) : (
          <h1 className="text-2xl font-bold text-white">Search</h1>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Searching…</p>
          </div>
        </div>
      )}

      {!loading && query && total === 0 && (
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="text-slate-300 font-medium mb-1">No results found</h3>
          <p className="text-slate-500 text-sm">Try a different search term</p>
        </div>
      )}

      {!loading && <MediaList results={results} />}
    </div>
  );
}
