import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useNews, type NewsCategory, type NewsArticle } from "../hooks/api/useNews";
import { usePageTitle } from "../hooks/usePageTitle";

const CATEGORY_TABS: { label: string; value: NewsCategory }[] = [
  { label: "Entertainment", value: "entertainment" },
  { label: "Movies", value: "movies" },
  { label: "TV Shows", value: "tv" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ArticleCard({ article }: { article: NewsArticle }) {
  const [imgError, setImgError] = useState(false);

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-neutral-600 transition-colors"
    >
      <div className="aspect-video bg-neutral-800 overflow-hidden shrink-0">
        {article.urlToImage && !imgError ? (
          <img
            src={article.urlToImage}
            alt={article.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg
              className="w-10 h-10 text-neutral-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
              />
            </svg>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4 flex-1">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-400">{article.source.name}</span>
          <span>·</span>
          <span>{timeAgo(article.publishedAt)}</span>
        </div>

        <h2 className="text-sm font-semibold text-white leading-snug group-hover:text-primary-400 transition-colors line-clamp-3">
          {article.title}
        </h2>

        {article.description && (
          <p className="text-xs text-neutral-400 leading-relaxed line-clamp-2 mt-auto pt-1">
            {article.description}
          </p>
        )}
      </div>
    </a>
  );
}

function ArticleCardSkeleton() {
  return (
    <div className="flex flex-col bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 animate-pulse">
      <div className="aspect-video bg-neutral-800" />
      <div className="p-4 flex flex-col gap-3">
        <div className="h-3 bg-neutral-800 rounded w-1/3" />
        <div className="space-y-2">
          <div className="h-4 bg-neutral-800 rounded w-full" />
          <div className="h-4 bg-neutral-800 rounded w-4/5" />
        </div>
        <div className="h-3 bg-neutral-800 rounded w-full mt-1" />
        <div className="h-3 bg-neutral-800 rounded w-2/3" />
      </div>
    </div>
  );
}

export default function News() {
  usePageTitle("News");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = (searchParams.get("category") as NewsCategory) ?? "entertainment";
  const page = Number(searchParams.get("page") ?? "1");
  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");
  const activeQ = searchParams.get("q") ?? undefined;

  const { data, isPending } = useNews(activeCategory, page, activeQ);
  const articles = (data?.articles ?? []).filter(
    (a) => a.title && a.title !== "[Removed]"
  );

  const PAGE_SIZE = 20;
  const totalResults = data?.totalResults ?? 0;
  const totalPages = Math.min(Math.ceil(totalResults / PAGE_SIZE), 5);

  function setCategory(cat: NewsCategory) {
    setSearchParams({ category: cat, page: "1" });
    setSearchInput("");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchInput.trim()) {
      setSearchParams({ category: activeCategory, page: "1", q: searchInput.trim() });
    } else {
      setSearchParams({ category: activeCategory, page: "1" });
    }
  }

  function clearSearch() {
    setSearchInput("");
    setSearchParams({ category: activeCategory, page: "1" });
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-6" data-tour="news-header">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-white">News</h1>
          <span className="text-lg">📰</span>
        </div>
        <p className="text-neutral-400">Latest entertainment headlines — cancellations, releases, and more</p>
      </div>

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Category tabs */}
        <div className="flex gap-1">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setCategory(tab.value)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeCategory === tab.value && !activeQ
                  ? "bg-primary-600 text-white"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 sm:ml-auto">
          <div className="relative">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search news..."
              className="bg-neutral-800 text-white text-sm rounded-lg px-3 py-1.5 pr-8 border border-neutral-700 focus:outline-none focus:border-primary-500 w-48 placeholder:text-neutral-500"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {/* Active search badge */}
      {activeQ && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-neutral-400">Results for</span>
          <span className="text-sm font-medium text-white bg-neutral-800 px-2.5 py-0.5 rounded-full">
            {activeQ}
          </span>
          <button
            onClick={clearSearch}
            className="text-xs text-neutral-500 hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Grid */}
      {isPending ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <ArticleCardSkeleton key={i} />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          {!data?.totalResults && !data ? (
            <>
              <p className="text-neutral-300 font-medium">News API key not configured</p>
              <p className="text-neutral-500 text-sm max-w-sm">
                Add a free <code className="text-primary-400">NEWS_API_KEY</code> from{" "}
                <span className="text-primary-400">newsapi.org</span> to your backend <code>.env</code> to enable this page.
              </p>
            </>
          ) : (
            <p className="text-neutral-400">No articles found.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {articles.map((article, i) => (
            <ArticleCard key={`${article.url}-${i}`} article={article} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isPending && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={() =>
              setSearchParams({
                category: activeCategory,
                page: String(Math.max(1, page - 1)),
                ...(activeQ ? { q: activeQ } : {}),
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
                category: activeCategory,
                page: String(Math.min(totalPages, page + 1)),
                ...(activeQ ? { q: activeQ } : {}),
              })
            }
            disabled={page === totalPages}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}

      <p className="text-center text-xs text-neutral-600 mt-8">Powered by NewsAPI.org</p>
    </div>
  );
}
