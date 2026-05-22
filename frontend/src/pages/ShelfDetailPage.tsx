import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useShelves, useShelfItems, useRemoveFromShelf } from "../hooks/api/useShelves";
import MediaCard from "../components/MediaCard";
import { usePageTitle } from "../hooks/usePageTitle";
import ShelfCalendarView from "../components/calendar/ShelfCalendarView";
import { Movie, Show } from "../types/calendar";

export default function ShelfDetailPage() {
  const { id } = useParams<{ id: string }>();
  const shelfId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as "items" | "calendar") ?? "items";
  function setActiveTab(tab: "items" | "calendar") {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }

  const { data: shelves = [] } = useShelves();
  const shelf = shelves.find((s) => s.id === shelfId);
  usePageTitle(shelf?.name ?? "Shelf");

  const { data: items, isLoading } = useShelfItems(shelfId);
  const removeFromShelf = useRemoveFromShelf();

  const movies: Movie[] = items?.movies ?? [];
  const shows: Show[] = items?.shows ?? [];
  const totalItems = movies.length + shows.length;

  async function handleRemove(contentType: "movie" | "tv", contentId: number) {
    try {
      await removeFromShelf.mutateAsync({ shelfId, contentType, contentId });
    } catch {
      alert("Failed to remove item");
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/shelves")}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
          aria-label="Back to shelves"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">
            {shelf?.name ?? "Shelf"}
          </h1>
          {shelf?.description && (
            <p className="text-sm text-neutral-400 mt-0.5">{shelf.description}</p>
          )}
        </div>
        <span className="ml-auto text-xs text-neutral-500 bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">
          {totalItems} {totalItems === 1 ? "item" : "items"}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-700">
        {(["items", "calendar"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-sky-500 text-sky-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Items tab */}
      {activeTab === "items" && (
        <>
          {isLoading && (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && totalItems === 0 && (
            <div className="text-center py-16 text-neutral-400">
              <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 3H5a2 2 0 00-2 2v16l7-3.5L17 21V5a2 2 0 00-2-2z" />
              </svg>
              <p className="text-sm mb-4">This shelf is empty. Add movies or shows from their info pages.</p>
              <a
                href="/trending"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-neutral-200 rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Browse Trending
              </a>
            </div>
          )}

          {movies.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-neutral-200 mb-4 flex items-center gap-2">
                Movies
                <span className="text-xs text-neutral-500 font-normal bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">
                  {movies.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {movies.map((item) => (
                  <MediaCard
                    key={`movie-${item.id}`}
                    type="movie"
                    item={item}
                    onRemove={() => handleRemove("movie", item.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {shows.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-neutral-200 mb-4 flex items-center gap-2">
                TV Shows
                <span className="text-xs text-neutral-500 font-normal bg-neutral-800 border border-neutral-700 px-2 py-0.5 rounded-full">
                  {shows.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {shows.map((item) => (
                  <MediaCard
                    key={`tv-${item.id}`}
                    type="tv"
                    item={item}
                    onRemove={() => handleRemove("tv", item.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Calendar tab */}
      {activeTab === "calendar" && <ShelfCalendarView shelfId={shelfId} shelfName={shelf?.name} />}
    </div>
  );
}
