import { useSearchParams, Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useGenres, useGenreResults } from "../hooks/api/useSearch";
import { BASE_IMAGE_URL } from "../constants";
import { parseLocalDate } from "../utils/date";
import { Movie, Show } from "../types/calendar";
import MiniWatchButton from "../components/MiniWatchButton";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import type { WatchStatus } from "../components/WatchButton";

type ActiveTab = "movie" | "tv";

const HUE_BY_GENRE: Record<number, number> = {
  18: 28, 28: 14, 35: 90, 878: 220, 14: 285, 9648: 195,
  27: 0, 53: 250, 99: 230, 36: 38, 80: 8, 16: 180,
  12: 50, 10402: 340, 10751: 50, 10749: 340, 10752: 200,
  37: 24, 10770: 160,
};

function PosterCard({ item, type, initialStatus }: { item: Movie | Show; type: ActiveTab; initialStatus?: WatchStatus }) {
  const title = type === "tv" ? (item as Show).name : (item as Movie).title;
  const date =
    type === "tv"
      ? (item as Show).first_air_date
      : (item as Movie).release_date;
  const year = date ? parseLocalDate(date).getFullYear() : null;
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`;

  return (
    <div className="group flex flex-col gap-2">
      <Link to={href} className="block relative aspect-[2/3] rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700/50 group-hover:border-neutral-600 transition-colors">
        {item.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${item.poster_path}`}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <svg
              className="w-10 h-10 text-neutral-600"
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </Link>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <Link to={href} className="block text-sm font-semibold text-neutral-100 line-clamp-1 hover:text-primary-300 transition-colors leading-tight">
            {title}
          </Link>
          <div className="flex items-center gap-1.5 mt-1">
            {year && (
              <span className="text-xs text-neutral-500">{year}</span>
            )}
            {item.vote_average != null && item.vote_average > 0 && (
              <>
                <span className="text-neutral-700 text-xs">·</span>
                <span className="flex items-center gap-0.5 text-xs text-warning-400 font-medium">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  {item.vote_average.toFixed(1)}
                </span>
              </>
            )}
          </div>
        </div>
        <MiniWatchButton contentType={type === "tv" ? "tv" : "movie"} contentId={item.id} initialStatus={initialStatus} bulkManaged />
      </div>
    </div>
  );
}

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
  const rawItems = [
    ...(genreData?.movies ?? []),
    ...(genreData?.shows ?? []),
  ];

  const bulkItems = rawItems.map((item) => ({
    content_type: activeTab === "tv" ? "tv" : "movie",
    content_id: item.id,
  }));
  const { data: bulkStatuses } = useBulkWatchStatus(bulkItems);

  const genrePills = genres[activeTab];
  const selectedGenre = genrePills.find((g) => g.id === selectedGenreId);
  const hue = selectedGenreId ? (HUE_BY_GENRE[selectedGenreId] ?? 200) : 200;

  function setParam(updates: Record<string, string>) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([k, v]) => next.set(k, v));
      return next;
    });
  }

  const pageStart = (page - 1) * 20 + 1;
  const pageEnd = Math.min(page * 20, totalPages * 20);

  return (
    <div className="min-h-full">
      {/* Page header */}
      <div className="px-6 sm:px-10 pt-7 pb-4">
        <div className="text-[11px] font-mono tracking-widest text-neutral-500 uppercase mb-2">
          Discover · Browse by genre
        </div>
        <h1 className="text-[2.6rem] font-light tracking-tight text-neutral-100 leading-none" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Find your next{" "}
          <em className="italic text-primary-400">watch</em>
        </h1>
      </div>

      {/* Type toggle */}
      <div className="px-6 sm:px-10 pb-4">
        <div className="flex bg-neutral-800 border border-neutral-700 rounded-xl p-1 w-fit">
          {(
            [
              ["Movies", "movie"],
              ["TV Shows", "tv"],
            ] as const
          ).map(([label, val]) => (
            <button
              key={val}
              onClick={() => setSearchParams({ type: val, page: "1" })}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
                activeTab === val
                  ? "bg-neutral-700 text-neutral-100 shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Genre pills */}
      <div className="px-6 sm:px-10 pb-6">
        <div className="flex gap-1.5 flex-wrap">
          {genrePills.map((g) => {
            const on = g.id === selectedGenreId;
            return (
              <button
                key={g.id}
                onClick={() =>
                  setSearchParams({
                    type: activeTab,
                    ...(selectedGenreId === g.id
                      ? {}
                      : { genre: String(g.id) }),
                    page: "1",
                  })
                }
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full border transition-all ${
                  on
                    ? "bg-primary-600/20 border-primary-500/50 text-primary-300"
                    : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                }`}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Genre brand strip */}
      {selectedGenre && !loading && rawItems.length > 0 && (
        <div className="px-6 sm:px-10 pb-6">
          <div
            className="relative h-28 sm:h-32 rounded-2xl overflow-hidden"
            style={{
              background: `linear-gradient(110deg, hsl(${hue}, 45%, 22%) 0%, hsl(${hue}, 30%, 13%) 60%, hsl(${hue}, 18%, 8%) 100%)`,
            }}
          >
            {/* Decorative posters — hidden below sm */}
            <div className="max-sm:hidden flex absolute right-8 top-1/2 -translate-y-1/2 gap-2.5">
              {rawItems.slice(0, 3).map((item, i) => {
                const poster = item.poster_path;
                return poster ? (
                  <div
                    key={item.id}
                    className="w-[58px] h-[87px] rounded-md overflow-hidden shadow-2xl shadow-black/70 flex-shrink-0"
                    style={{
                      transform: `translateY(${i === 1 ? -10 : 6}px)`,
                    }}
                  >
                    <img
                      src={`${BASE_IMAGE_URL}/w185${poster}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : null;
              })}
            </div>

            {/* Text */}
            <div className="absolute left-5 sm:left-7 top-0 bottom-0 flex flex-col justify-center text-white sm:pr-[220px]">
              <div className="text-[10px] font-mono tracking-[0.15em] opacity-55 uppercase mb-1.5 sm:mb-2">
                Now browsing
              </div>
              <h2
                className="text-[1.75rem] sm:text-[2.4rem] font-light leading-none tracking-tight truncate"
                style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
              >
                {selectedGenre.name}
              </h2>
              <div className="text-xs opacity-65 mt-1.5 sm:mt-2">
                Page {page} of {totalPages} · sorted by popularity
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Result toolbar */}
      {selectedGenre && !loading && rawItems.length > 0 && (
        <div className="px-6 sm:px-10 pb-4 flex items-center">
          <span className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase">
            Showing {pageStart}–{pageEnd}
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-400 text-sm">Loading…</p>
          </div>
        </div>
      )}

      {/* Empty prompt */}
      {!loading && !selectedGenreId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-400">Select a genre above to browse titles</p>
        </div>
      )}

      {!loading && selectedGenreId && rawItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-300 font-medium mb-1">No results found</p>
          <p className="text-neutral-500 text-sm">Try a different genre</p>
        </div>
      )}

      {/* Poster grid */}
      {!loading && rawItems.length > 0 && (
        <div className="px-6 sm:px-10 pb-8 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
          {rawItems.map((item) => (
            <PosterCard
              key={item.id}
              item={item as Movie | Show}
              type={activeTab}
              initialStatus={bulkStatuses?.[`${activeTab === "tv" ? "tv" : "movie"}:${item.id}`]?.status}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && selectedGenreId && totalPages > 1 && (
        <div className="px-6 sm:px-10 pb-10 flex items-center justify-center gap-4">
          <button
            onClick={() => setParam({ page: String(Math.max(1, page - 1)) })}
            disabled={page === 1}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Previous
          </button>
          <span className="font-mono text-xs text-neutral-500 tracking-wider">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() =>
              setParam({ page: String(Math.min(totalPages, page + 1)) })
            }
            disabled={page === totalPages}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
