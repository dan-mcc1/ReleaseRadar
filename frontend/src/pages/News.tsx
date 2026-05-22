import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useNews,
  type NewsCategory,
  type NewsArticle,
} from "../hooks/api/useNews";
import { usePageTitle } from "../hooks/usePageTitle";

const CATEGORY_TABS: { label: string; value: NewsCategory }[] = [
  { label: "Entertainment", value: "entertainment" },
  { label: "Movies", value: "movies" },
  { label: "TV Shows", value: "tv" },
];

const PAGE_SIZE = 20;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function ImageBox({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [err, setErr] = useState(false);
  if (src && !err) {
    return (
      <div className={`${className} overflow-hidden bg-neutral-900`}>
        {/* Blurred backdrop fills the frame for portrait images */}
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-lg opacity-60"
        />
        {/* Actual image, never cropped */}
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-contain"
          onError={() => setErr(true)}
        />
      </div>
    );
  }
  return (
    <div
      className={`${className} overflow-hidden flex items-center justify-center bg-neutral-800`}
    >
      <svg
        className="w-8 h-8 text-neutral-600"
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
  );
}

function LeadArticle({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group bg-neutral-800/60 border border-white/8 rounded-2xl overflow-hidden flex flex-col cursor-pointer"
    >
      {/* Backdrop */}
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio: "4/3", maxHeight: 420 }}
      >
        <ImageBox
          src={article.urlToImage}
          alt={article.title}
          className="absolute inset-0"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

        {/* Badge */}
        <div className="absolute top-3.5 left-3.5 font-mono text-[9.5px] tracking-widest bg-black/50 backdrop-blur-sm text-white px-2.5 py-1 rounded uppercase">
          ◉ Lead
        </div>

        {/* Title overlay */}
        <div className="absolute left-4 right-4 bottom-4 text-white">
          <h2
            className="text-2xl leading-tight tracking-tight font-light"
            style={{ fontFamily: "'Georgia', serif" }}
          >
            {article.title}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pt-4 pb-5 flex flex-col gap-3">
        {article.description && (
          <p className="text-sm leading-relaxed text-neutral-300 line-clamp-2">
            {article.description}
          </p>
        )}
        <div className="flex items-center gap-3 font-mono text-[10.5px] tracking-widest uppercase text-neutral-500">
          <span className="text-neutral-300 font-medium">
            {article.source.name}
          </span>
          <span className="w-1 h-1 rounded-full bg-neutral-600 inline-block" />
          <span>{timeAgo(article.publishedAt)}</span>
        </div>
      </div>
    </a>
  );
}

function SideArticle({
  article,
  last,
}: {
  article: NewsArticle;
  last: boolean;
}) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group grid gap-4 cursor-pointer pb-5 ${last ? "" : "border-b border-white/8"}`}
      style={{ gridTemplateColumns: "110px 1fr" }}
    >
      <div
        className="relative rounded-xl overflow-hidden shrink-0"
        style={{ aspectRatio: "4/3" }}
      >
        <ImageBox
          src={article.urlToImage}
          alt={article.title}
          className="absolute inset-0"
        />
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        <h3
          className="text-[18px] leading-snug tracking-tight font-light text-white group-hover:text-primary-300 transition-colors line-clamp-3"
          style={{ fontFamily: "'Georgia', serif" }}
        >
          {article.title}
        </h3>
        {article.description && (
          <p className="text-xs text-neutral-400 leading-relaxed line-clamp-2">
            {article.description}
          </p>
        )}
        <div className="font-mono text-[9.5px] tracking-widest uppercase text-neutral-500 mt-auto">
          <span className="text-neutral-400">{article.source.name}</span>
          {" · "}
          {timeAgo(article.publishedAt)}
        </div>
      </div>
    </a>
  );
}

function GridArticle({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group bg-neutral-800/60 border border-white/8 rounded-2xl overflow-hidden flex flex-col cursor-pointer hover:border-white/15 transition-colors"
    >
      <div className="relative overflow-hidden" style={{ aspectRatio: "16/9" }}>
        <ImageBox
          src={article.urlToImage}
          alt={article.title}
          className="absolute inset-0"
        />
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="font-mono text-[9.5px] tracking-widest uppercase text-neutral-500">
          <span className="text-neutral-400 font-medium">
            {article.source.name}
          </span>
          {" · "}
          {timeAgo(article.publishedAt)}
        </div>
        <h3
          className="text-[17px] leading-snug tracking-tight font-light text-white group-hover:text-primary-300 transition-colors line-clamp-3"
          style={{ fontFamily: "'Georgia', serif" }}
        >
          {article.title}
        </h3>
        {article.description && (
          <p className="text-xs text-neutral-400 leading-relaxed line-clamp-2 mt-auto pt-1">
            {article.description}
          </p>
        )}
      </div>
    </a>
  );
}

function LeadSkeleton() {
  return (
    <div className="bg-neutral-800/60 border border-white/8 rounded-2xl overflow-hidden animate-pulse">
      <div
        className="bg-neutral-700/60"
        style={{ aspectRatio: "4/3", maxHeight: 320 }}
      />
      <div className="px-5 pt-4 pb-5 flex flex-col gap-3">
        <div className="h-4 bg-neutral-700 rounded w-full" />
        <div className="h-4 bg-neutral-700 rounded w-4/5" />
        <div className="h-3 bg-neutral-700/60 rounded w-1/3 mt-1" />
      </div>
    </div>
  );
}

function SideSkeleton() {
  return (
    <div
      className="grid gap-4 pb-5 border-b border-white/8 animate-pulse"
      style={{ gridTemplateColumns: "110px 1fr" }}
    >
      <div
        className="bg-neutral-700/60 rounded-xl"
        style={{ aspectRatio: "4/3" }}
      />
      <div className="flex flex-col gap-2">
        <div className="h-4 bg-neutral-700 rounded w-full" />
        <div className="h-4 bg-neutral-700 rounded w-3/4" />
        <div className="h-3 bg-neutral-700/60 rounded w-1/3 mt-1" />
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="bg-neutral-800/60 border border-white/8 rounded-2xl overflow-hidden animate-pulse">
      <div className="bg-neutral-700/60" style={{ aspectRatio: "16/9" }} />
      <div className="p-4 flex flex-col gap-2">
        <div className="h-3 bg-neutral-700/60 rounded w-1/3" />
        <div className="h-4 bg-neutral-700 rounded w-full" />
        <div className="h-4 bg-neutral-700 rounded w-4/5" />
        <div className="h-3 bg-neutral-700/60 rounded w-full mt-1" />
        <div className="h-3 bg-neutral-700/60 rounded w-2/3" />
      </div>
    </div>
  );
}

export default function News() {
  usePageTitle("News");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory =
    (searchParams.get("category") as NewsCategory) ?? "entertainment";
  const page = Number(searchParams.get("page") ?? "1");
  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");
  const activeQ = searchParams.get("q") ?? undefined;

  const { data, isPending } = useNews(activeCategory, page, activeQ);
  const articles = (data?.articles ?? []).filter(
    (a) => a.title && a.title !== "[Removed]",
  );

  const totalResults = data?.totalResults ?? 0;
  const totalPages = Math.min(Math.ceil(totalResults / PAGE_SIZE), 5);

  const lead = articles[0] ?? null;
  const sideArticles = articles.slice(1, 4);
  const gridArticles = articles.slice(4);

  function setCategory(cat: NewsCategory) {
    setSearchParams({ category: cat, page: "1" });
    setSearchInput("");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchInput.trim()) {
      setSearchParams({
        category: activeCategory,
        page: "1",
        q: searchInput.trim(),
      });
    } else {
      setSearchParams({ category: activeCategory, page: "1" });
    }
  }

  function clearSearch() {
    setSearchInput("");
    setSearchParams({ category: activeCategory, page: "1" });
  }

  function goToPage(p: number) {
    setSearchParams({
      category: activeCategory,
      page: String(p),
      ...(activeQ ? { q: activeQ } : {}),
    });
  }

  const noApiKey = !isPending && !data?.totalResults && !data;

  return (
    <div className="w-full px-4 sm:px-8 lg:px-10 py-8 pb-20">
      {/* Header */}
      <div className="mb-2" data-tour="news-header">
        <div className="font-mono text-[10px] tracking-widest text-neutral-500 uppercase mb-2">
          News · {todayLabel()}
        </div>
        <h1
          className="text-4xl sm:text-5xl font-light tracking-tight leading-none"
          style={{ fontFamily: "'Georgia', serif" }}
        >
          What's{" "}
          <em className="text-primary-400" style={{ fontStyle: "italic" }}>
            happening
          </em>
        </h1>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mt-6 mb-7">
        {/* Category tabs */}
        <div className="flex bg-neutral-800/80 border border-white/10 rounded-xl p-1 gap-0.5">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setCategory(tab.value)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                activeCategory === tab.value && !activeQ
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="flex-1" />

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search news…"
              className="bg-neutral-800/80 border border-white/10 text-white text-sm rounded-xl pl-9 pr-8 py-2 w-56 focus:outline-none focus:border-white/20 placeholder:text-neutral-500"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-medium transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {/* Active search badge */}
      {activeQ && (
        <div className="flex items-center gap-2 mb-6">
          <span className="font-mono text-[10px] tracking-widest text-neutral-500 uppercase">
            Results for
          </span>
          <span className="text-sm font-medium text-white bg-neutral-800 border border-white/10 px-2.5 py-0.5 rounded-full">
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

      {/* No API key */}
      {noApiKey && (
        <div className="flex flex-col items-center justify-center py-32 text-center gap-3">
          <p className="text-neutral-300 font-medium">
            News API key not configured
          </p>
          <p className="text-neutral-500 text-sm max-w-sm">
            Add a free <code className="text-primary-400">NEWS_API_KEY</code>{" "}
            from <span className="text-primary-400">newsapi.org</span> to your
            backend <code>.env</code> to enable this page.
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {isPending && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-7 mb-10">
            <LeadSkeleton />
            <div className="flex flex-col gap-5">
              <SideSkeleton />
              <SideSkeleton />
              <SideSkeleton />
            </div>
          </div>
          <div className="border-t border-white/8 pt-7 mb-5">
            <div className="h-6 bg-neutral-700/60 rounded w-40 animate-pulse mb-5" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <GridSkeleton key={i} />
            ))}
          </div>
        </>
      )}

      {/* No results */}
      {!isPending && !noApiKey && articles.length === 0 && (
        <div className="flex items-center justify-center py-32">
          <p className="text-neutral-400">No articles found.</p>
        </div>
      )}

      {/* Content */}
      {!isPending && articles.length > 0 && (
        <>
          {/* Lead + side stack */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-7 mb-10">
            {lead && <LeadArticle article={lead} />}
            {sideArticles.length > 0 && (
              <div className="flex flex-col gap-5">
                {sideArticles.map((a, i) => (
                  <SideArticle
                    key={a.url}
                    article={a}
                    last={i === sideArticles.length - 1}
                  />
                ))}
              </div>
            )}
          </div>

          {/* More headlines */}
          {gridArticles.length > 0 && (
            <div>
              <div className="border-t border-white/8 pt-7 mb-6 flex items-baseline gap-4">
                <span className="font-mono text-[10px] tracking-widest text-neutral-500 uppercase">
                  Latest
                </span>
                <span
                  className="text-2xl font-light tracking-tight text-white"
                  style={{ fontFamily: "'Georgia', serif" }}
                >
                  More headlines
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {gridArticles.map((a, i) => (
                  <GridArticle key={`${a.url}-${i}`} article={a} />
                ))}
              </div>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-5 mt-10">
              <button
                onClick={() => goToPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-neutral-800/80 border border-white/8 text-neutral-300 hover:text-white hover:border-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <span className="font-mono text-xs tracking-widest text-neutral-500 uppercase">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => goToPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-neutral-800/80 border border-white/8 text-neutral-300 hover:text-white hover:border-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      <p className="text-center text-[11px] text-neutral-600 mt-10 italic">
        Powered by NewsAPI.org
      </p>
    </div>
  );
}
