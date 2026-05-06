import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import MediaList from "../components/MediaList";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSearch } from "../hooks/api/useSearch";

type Tab = "all" | "movies" | "tv" | "people" | "collections";

const PREVIEW_COUNT = 5;

export default function Search() {
  usePageTitle("Search");
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const query = searchParams.get("q") || "";

  const [activeTab, setActiveTab] = useState<Tab>("all");

  // Reset to "all" when query changes
  useEffect(() => {
    setActiveTab("all");
  }, [query]);

  const { data, isPending: loading } = useSearch(query);
  const results = data ?? { movies: [], shows: [], people: [], collections: [] };

  const { movies, shows, people, collections } = results;

  const total =
    movies.length + shows.length + people.length + collections.length;

  // Build tabs — only show ones with results
  const allTabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "movies", label: "Movies", count: movies.length },
    { key: "tv", label: "TV Shows", count: shows.length },
    { key: "people", label: "People", count: people.length },
    { key: "collections", label: "Collections", count: collections.length },
  ];
  const tabs = allTabs.filter((t) => t.key === "all" || t.count > 0);

  // What MediaList receives depending on the active tab
  const listResults =
    activeTab === "all"
      ? {
          movies: movies.slice(0, PREVIEW_COUNT),
          shows: shows.slice(0, PREVIEW_COUNT),
          people: people.slice(0, PREVIEW_COUNT),
        }
      : activeTab === "movies"
        ? { movies, shows: [], people: [] }
        : activeTab === "tv"
          ? { movies: [], shows, people: [] }
          : activeTab === "people"
            ? { movies: [], shows: [], people }
            : { movies: [], shows: [], people: [] };

  const listCollections =
    activeTab === "all"
      ? collections.slice(0, PREVIEW_COUNT)
      : activeTab === "collections"
        ? collections
        : [];

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-5">
        {query ? (
          <h1 className="text-2xl font-bold text-white">
            Results for <span className="text-primary-400">"{query}"</span>
          </h1>
        ) : (
          <h1 className="text-2xl font-bold text-white">Search</h1>
        )}
      </div>

      {/* Tabs — only shown once results are in */}
      {!loading && total > 0 && (
        <div className="flex gap-1 flex-wrap mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-primary-600 text-white"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              {tab.label}
              {tab.key !== "all" && (
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                    activeTab === tab.key
                      ? "bg-primary-500 text-white"
                      : "bg-neutral-700 text-neutral-400"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-400 text-sm">Searching…</p>
          </div>
        </div>
      )}

      {!loading && query && total === 0 && (
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="text-neutral-300 font-medium mb-1">
            No results found
          </h3>
          <p className="text-neutral-500 text-sm">
            Try a different search term
          </p>
        </div>
      )}

      {!loading && (
        <MediaList
          results={listResults}
          collections={listCollections}
          paginated
        />
      )}
    </div>
  );
}
