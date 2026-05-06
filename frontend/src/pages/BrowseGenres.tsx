import { useSearchParams } from "react-router-dom";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";
import { useGenres, useGenreResults } from "../hooks/api/useSearch";

type ActiveTab = "movie" | "tv";

const TABS: { label: string; value: ActiveTab }[] = [
  { label: "Movies", value: "movie" },
  { label: "TV Shows", value: "tv" },
];

export default function BrowseGenres() {
  usePageTitle("Browse");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("type") as ActiveTab) ?? "movie";
  const selectedGenreId = searchParams.get("genre")
    ? Number(searchParams.get("genre"))
    : null;
  const page = Number(searchParams.get("page") ?? "1");

  const { data: genreList } = useGenres();
  const genres = genreList ?? { movie: [], tv: [] };

  const { data: genreData, isFetching: loading } = useGenreResults(
    activeTab,
    selectedGenreId ?? 0,
    page,
    !!selectedGenreId,
  );

  const totalPages = genreData?.total_pages ?? 1;
  const results = {
    movies: genreData?.movies ?? [],
    shows: genreData?.shows ?? [],
  };
  const rawItems = [...results.movies, ...results.shows];

  const genrePills = genres[activeTab];
  const selectedGenreName = genrePills.find(
    (g) => g.id === selectedGenreId,
  )?.name;
  const total = rawItems.length;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white">Browse</h1>
        {selectedGenreName && !loading && total > 0 && (
          <p className="text-neutral-400 text-sm mt-1">
            {selectedGenreName} — page {page} of {totalPages}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setSearchParams({ type: tab.value, page: "1" })}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? "bg-primary-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
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
              setSearchParams({
                type: activeTab,
                ...(selectedGenreId === genre.id
                  ? {}
                  : { genre: String(genre.id) }),
                page: "1",
              })
            }
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              selectedGenreId === genre.id
                ? "bg-primary-600 border-primary-600 text-white"
                : "bg-neutral-800 border-neutral-600 text-neutral-300 hover:border-neutral-400 hover:text-white"
            }`}
          >
            {genre.name}
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

      {!loading && !selectedGenreId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-400">
            Select a genre above to browse titles
          </p>
        </div>
      )}

      {!loading && selectedGenreId && total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-300 font-medium mb-1">No results found</p>
          <p className="text-neutral-500 text-sm">Try a different genre</p>
        </div>
      )}

      {!loading && <MediaList results={results} paginated />}

      {!loading && selectedGenreId && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={() =>
              setSearchParams({
                type: activeTab,
                genre: String(selectedGenreId),
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
                type: activeTab,
                genre: String(selectedGenreId),
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
