import { useEffect, useState } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import type { Movie, Show } from "../types/calendar";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";
import { Link } from "react-router-dom";
import { useForYou } from "../hooks/api/useRecommendations";

type Tab = "movies" | "tv";
type Mode = "recent" | "top_rated";

const TABS: { key: Tab; label: string }[] = [
  { key: "movies", label: "Movies" },
  { key: "tv", label: "TV Shows" },
];

const MODES: { key: Mode; label: string }[] = [
  { key: "recent", label: "Most Recent" },
  { key: "top_rated", label: "Highest Rated" },
];

export default function ForYou() {
  usePageTitle("For You");
  const currentUser = useAuthUser();
  const [activeTab, setActiveTab] = useState<Tab>("movies");
  const [mode, setMode] = useState<Mode>("recent");
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 10;

  const { data, isLoading } = useForYou(mode);
  const movies = (data?.movies ?? []) as Movie[];
  const shows = (data?.shows ?? []) as Show[];
  const seedCount = data?.seed_count ?? 0;

  // Reset page when tab or mode changes
  useEffect(() => {
    setPage(1);
  }, [activeTab, mode]);

  const activeItems = activeTab === "movies" ? movies : shows;
  const totalPages = Math.ceil(activeItems.length / PAGE_SIZE);
  const pageItems = activeItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const listResults =
    activeTab === "movies"
      ? { movies: pageItems as Movie[], shows: [], people: [] }
      : { movies: [], shows: pageItems as Show[], people: [] };

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-4">
        <p className="text-neutral-300 font-medium mb-2">
          Sign in to see recommendations
        </p>
        <Link
          to="/signIn"
          className="text-primary-400 hover:text-primary-300 text-sm"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">
            {mode === "top_rated"
              ? "Finding recommendations based on your top rated…"
              : "Building your recommendations…"}
          </p>
        </div>
      </div>
    );
  }

  if (seedCount === 0) {
    return (
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">For You</h1>
          <p className="text-neutral-400 mt-1">Personalised recommendations</p>
        </div>
        <div className="flex flex-col items-center justify-center py-24 text-center">
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
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
          </div>
          <p className="text-neutral-300 font-medium mb-1">
            Nothing to go on yet
          </p>
          <p className="text-neutral-500 text-sm max-w-xs">
            Add some movies or shows to your watched list or watchlist and we'll
            suggest things you might like.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">For You</h1>
          <p className="text-neutral-400 mt-1 text-sm">
            {mode === "recent"
              ? `Based on your ${seedCount} most recent watched & watchlist items`
              : `Based on your ${seedCount} highest rated items`}
          </p>
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-600 transition cursor-pointer"
        >
          {MODES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {TABS.map((tab) => {
          const count = tab.key === "movies" ? movies.length : shows.length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-primary-600 text-white"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              {tab.label}
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.key
                    ? "bg-primary-500 text-white"
                    : "bg-neutral-700 text-neutral-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {activeItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-400">
            No {activeTab === "movies" ? "movie" : "TV show"} recommendations
            found.
          </p>
        </div>
      ) : (
        <>
          <MediaList results={listResults} paginated />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-neutral-400 text-sm">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
