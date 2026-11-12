import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useNews,
  type NewsCategory,
  type NewsArticle,
} from "../hooks/api/useNews";
import { usePageTitle } from "../hooks/usePageTitle";
import { safeHref } from "../utils/safeHref";
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  PageHeader,
  SearchField,
  SectionHeader,
  Segmented,
} from "../components/ui";

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
      <span className="text-caption text-neutral-500">No image</span>
    </div>
  );
}

function LeadArticle({ article }: { article: NewsArticle }) {
  return (
    <a
      href={safeHref(article.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="group bg-neutral-800/60 border border-white/8 rounded-surface overflow-hidden flex flex-col cursor-pointer"
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

        {/* Title overlay */}
        <div className="absolute left-4 right-4 bottom-4 text-white">
          <h2 className="text-heading leading-tight font-semibold">
            {article.title}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pt-4 pb-5 flex flex-col gap-3">
        {article.description && (
          <p className="text-body leading-relaxed text-neutral-300 line-clamp-2">
            {article.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-caption text-neutral-400">
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
      href={safeHref(article.url)}
      target="_blank"
      rel="noopener noreferrer"
      className={`group grid gap-4 cursor-pointer pb-5 ${last ? "" : "border-b border-white/8"}`}
      style={{ gridTemplateColumns: "110px 1fr" }}
    >
      <div
        className="relative rounded-control overflow-hidden shrink-0"
        style={{ aspectRatio: "4/3" }}
      >
        <ImageBox
          src={article.urlToImage}
          alt={article.title}
          className="absolute inset-0"
        />
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        <h3 className="text-title leading-snug font-semibold text-white group-hover:text-primary-300 transition-colors line-clamp-3">
          {article.title}
        </h3>
        {article.description && (
          <p className="text-caption text-neutral-400 leading-relaxed line-clamp-2">
            {article.description}
          </p>
        )}
        <div className="text-caption text-neutral-400 mt-auto">
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
      href={safeHref(article.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="group bg-neutral-800/60 border border-white/8 rounded-surface overflow-hidden flex flex-col cursor-pointer hover:border-white/15 transition-colors"
    >
      <div className="relative overflow-hidden" style={{ aspectRatio: "16/9" }}>
        <ImageBox
          src={article.urlToImage}
          alt={article.title}
          className="absolute inset-0"
        />
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="text-caption text-neutral-400">
          <span className="text-neutral-300 font-medium">
            {article.source.name}
          </span>
          {" · "}
          {timeAgo(article.publishedAt)}
        </div>
        <h3 className="text-title leading-snug font-semibold text-white group-hover:text-primary-300 transition-colors line-clamp-3">
          {article.title}
        </h3>
        {article.description && (
          <p className="text-caption text-neutral-400 leading-relaxed line-clamp-2 mt-auto pt-1">
            {article.description}
          </p>
        )}
      </div>
    </a>
  );
}

function LeadSkeleton() {
  return (
    <div className="bg-neutral-800/60 border border-white/8 rounded-surface overflow-hidden animate-pulse">
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
        className="bg-neutral-700/60 rounded-control"
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
    <div className="bg-neutral-800/60 border border-white/8 rounded-surface overflow-hidden animate-pulse">
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
      <div data-tour="news-header">
        <PageHeader title="What's happening" description={todayLabel()} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mt-6 mb-7">
        {/* Category tabs */}
        <Segmented
          label="Category"
          value={(activeQ ? "" : activeCategory) as NewsCategory}
          onChange={setCategory}
          options={CATEGORY_TABS}
        />

        <span className="flex-1" />

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <SearchField
            label="Search news"
            placeholder="Search news…"
            value={searchInput}
            onChange={setSearchInput}
            onClear={clearSearch}
            className="w-56"
          />
          <Button type="submit">Search</Button>
        </form>
      </div>

      {/* Active search badge */}
      {activeQ && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-label text-neutral-400">Results for</span>
          <span className="text-body font-medium text-white bg-neutral-800 border border-white/10 px-2.5 py-0.5 rounded-full">
            {activeQ}
          </span>
          <Button variant="ghost" size="sm" onClick={clearSearch}>
            Clear
          </Button>
        </div>
      )}

      {/* No API key */}
      {noApiKey && (
        <EmptyState
          title="News API key not configured"
          description={
            <>
              Add a free <code className="text-neutral-200">NEWS_API_KEY</code> from{" "}
              <span className="text-neutral-200">newsapi.org</span> to your backend{" "}
              <code>.env</code> to enable this page.
            </>
          }
        />
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
        <EmptyState title="No articles found" />
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
              <div className="border-t border-white/8 pt-7 mb-6">
                <SectionHeader title="More headlines" />
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
              <Button
                icon={<ChevronLeftIcon />}
                onClick={() => goToPage(Math.max(1, page - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <span className="tabular text-label text-neutral-300">
                Page {page} of {totalPages}
              </span>
              <Button
                onClick={() => goToPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
              >
                Next
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </>
      )}

      <p className="text-center text-caption text-neutral-500 mt-10">
        Powered by NewsAPI.org
      </p>
    </div>
  );
}
