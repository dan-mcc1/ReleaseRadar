import { useEffect, useState } from "react";
import type { Show, Movie } from "../types/calendar";
import { API_URL } from "../constants";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";

type MediaType = "movie" | "tv";

interface GenreItem {
  id: number;
  name: string;
}

interface GenreList {
  movie: GenreItem[];
  tv: GenreItem[];
}

const TYPE_TABS: { label: string; value: MediaType }[] = [
  { label: "Movies", value: "movie" },
  { label: "TV Shows", value: "tv" },
];

export default function SearchGenres() {
  usePageTitle("Browse Genres");
  const [activeType, setActiveType] = useState<MediaType>("movie");
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null);
  const [genres, setGenres] = useState<GenreList>({ movie: [], tv: [] });
  const [results, setResults] = useState<{ movies: Movie[]; shows: Show[] }>({
    movies: [],
    shows: [],
  });
  const [loading, setLoading] = useState(false);

  // Fetch genre list once on mount
  useEffect(() => {
    fetch(`${API_URL}/search/genres`)
      .then((r) => r.json())
      .then((data: GenreList) => setGenres(data))
      .catch(console.error);
  }, []);

  // Reset genre selection when type changes
  useEffect(() => {
    setSelectedGenreId(null);
    setResults({ movies: [], shows: [] });
  }, [activeType]);

  // Fetch results when genre is selected
  useEffect(() => {
    if (!selectedGenreId) {
      setResults({ movies: [], shows: [] });
      return;
    }

    async function fetchResults() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          genre_id: String(selectedGenreId),
          type: activeType,
        });
        const res = await fetch(`${API_URL}/search?${params}`);
        if (!res.ok) throw new Error("Failed to fetch genre results");
        const data = await res.json();
        setResults({
          movies: data.movies ?? [],
          shows: data.shows ?? [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [selectedGenreId, activeType]);

  const genrePills = genres[activeType];
  const selectedGenreName = genrePills.find((g) => g.id === selectedGenreId)?.name;
  const total = results.movies.length + results.shows.length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white">Search Genres</h1>
        {selectedGenreName && !loading && total > 0 && (
          <p className="text-slate-400 text-sm mt-1">
            {total} result{total !== 1 ? "s" : ""} in {selectedGenreName}
          </p>
        )}
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-4">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveType(tab.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeType === tab.value
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Genre pills */}
      <div className="flex gap-2 flex-wrap mb-8">
        {genrePills.map((genre) => (
          <button
            key={genre.id}
            onClick={() =>
              setSelectedGenreId((prev) => (prev === genre.id ? null : genre.id))
            }
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              selectedGenreId === genre.id
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-400 hover:text-white"
            }`}
          >
            {genre.name}
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

      {/* Prompt to select a genre */}
      {!loading && !selectedGenreId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400">Select a genre above to browse titles</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && selectedGenreId && total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-300 font-medium mb-1">No results found</p>
          <p className="text-slate-500 text-sm">Try a different genre</p>
        </div>
      )}

      {!loading && <MediaList results={results} />}
    </div>
  );
}
