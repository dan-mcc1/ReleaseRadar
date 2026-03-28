import { useEffect, useState } from "react";
import type { Show, Movie, Person } from "../types/calendar";
import { API_URL } from "../constants";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";

export default function Trending() {
  usePageTitle("Trending");
  const [results, setResults] = useState<{
    movies: Movie[];
    shows: Show[];
    people: Person[];
  }>({ movies: [], shows: [], people: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchResults() {
      try {
        const res = await fetch(`${API_URL}/search/multi/trending`);
        if (!res.ok) throw new Error("Failed to fetch trending");
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
  }, []);

  const total = results.movies.length + results.shows.length + results.people.length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-white">Trending</h1>
          <span className="text-lg">🔥</span>
        </div>
        <p className="text-slate-400">What everyone's watching right now</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {!loading && total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400">No trending content available right now.</p>
        </div>
      )}

      {!loading && <MediaList results={results} />}
    </div>
  );
}
