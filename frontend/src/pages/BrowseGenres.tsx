import { useEffect, useState } from "react";
import type { Show, Movie, CollectionResult } from "../types/calendar";
import { API_URL, BASE_IMAGE_URL } from "../constants";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";
import { Link } from "react-router-dom";

type ActiveTab = "movie" | "tv";

interface GenreItem {
  id: number;
  name: string;
}

interface GenreList {
  movie: GenreItem[];
  tv: GenreItem[];
}

const TABS: { label: string; value: ActiveTab }[] = [
  { label: "Movies", value: "movie" },
  { label: "TV Shows", value: "tv" },
];

export default function BrowseGenres() {
  usePageTitle("Browse");
  const [activeTab, setActiveTab] = useState<ActiveTab>("movie");

  // Genre browsing state
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null);
  const [genres, setGenres] = useState<GenreList>({ movie: [], tv: [] });
  const [results, setResults] = useState<{ movies: Movie[]; shows: Show[] }>({
    movies: [],
    shows: [],
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  // Collections state
  const [collections, setCollections] = useState<CollectionResult[]>([]);
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionTotalPages, setCollectionTotalPages] = useState(1);
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  // Fetch genre list once on mount
  useEffect(() => {
    fetch(`${API_URL}/search/genres`)
      .then((r) => r.json())
      .then((data: GenreList) => setGenres(data))
      .catch(console.error);
  }, []);

  // Reset genre state when switching between movie/tv tabs
  useEffect(() => {
    setSelectedGenreId(null);
    setResults({ movies: [], shows: [] });
    setPage(1);
    setTotalPages(1);
  }, [activeTab]);

  // Reset page when genre changes
  useEffect(() => {
    setPage(1);
  }, [selectedGenreId]);

  // Fetch genre results
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
          type: activeTab,
          page: String(page),
        });
        const res = await fetch(`${API_URL}/search?${params}`);
        if (!res.ok) throw new Error("Failed to fetch genre results");
        const data = await res.json();
        setResults({ movies: data.movies ?? [], shows: data.shows ?? [] });
        setTotalPages(data.total_pages ?? 1);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [selectedGenreId, activeTab, page]);

  const genrePills = genres[activeTab as "movie" | "tv"];
  const selectedGenreName = genrePills.find(
    (g) => g.id === selectedGenreId,
  )?.name;
  const total = results.movies.length + results.shows.length;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white">Browse</h1>
        {selectedGenreName && !loading && total > 0 && (
          <p className="text-slate-400 text-sm mt-1">
            {selectedGenreName} — page {page} of {totalPages}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Genre tabs (Movies / TV) ── */}

      <div className="flex gap-2 flex-wrap mb-8">
        {genrePills.map((genre) => (
          <button
            key={genre.id}
            onClick={() =>
              setSelectedGenreId((prev) =>
                prev === genre.id ? null : genre.id,
              )
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

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {!loading && !selectedGenreId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400">
            Select a genre above to browse titles
          </p>
        </div>
      )}

      {!loading && selectedGenreId && total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-300 font-medium mb-1">No results found</p>
          <p className="text-slate-500 text-sm">Try a different genre</p>
        </div>
      )}

      {!loading && <MediaList results={results} paginated />}

      {!loading && selectedGenreId && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-slate-400 text-sm">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
