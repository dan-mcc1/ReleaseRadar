import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import StarIcon from "../components/icons/StarIcon";
import {
  useCollectionsBrowse,
  useCollectionsSearch,
  useCollectionGenres,
  useBulkCollectionStatus,
  NATURAL_SORT_DIRECTION,
  type CollectionSummary,
  type BrowseFilters,
  type BrowseSort,
  type CollectionWatchStatus,
} from "../hooks/api/useCollectionInfo";

const PAGE_SIZE = 30;

const SORT_OPTIONS = [
  { value: "popularity", label: "Popularity" },
  { value: "name", label: "Name" },
  { value: "rating", label: "Avg rating" },
  { value: "size", label: "# of movies" },
  { value: "earliest", label: "Earliest release" },
  { value: "latest", label: "Latest release" },
] as const;

function CollectionCard({
  c,
  status,
}: {
  c: CollectionSummary;
  status?: CollectionWatchStatus;
}) {
  const yearRange =
    c.min_year && c.max_year
      ? c.min_year === c.max_year
        ? String(c.min_year)
        : `${c.min_year}–${c.max_year}`
      : null;

  const progressDenom = status?.released_parts ?? 0;
  const watched = status?.watched_parts ?? 0;
  const started = watched > 0;
  const finished = !!status?.finished;
  const pct =
    progressDenom > 0
      ? Math.min(100, Math.round((watched / progressDenom) * 100))
      : 0;

  return (
    <Link to={`/collection/${c.id}`} className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700/50 group-hover:border-neutral-600 transition-colors">
        {c.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${c.poster_path}`}
            alt={c.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center p-3 text-center">
            <span className="text-xs text-neutral-500 line-clamp-4">
              {c.name}
            </span>
          </div>
        )}
        {c.size != null && c.size > 0 && (
          <div className="absolute top-1.5 right-1.5 bg-black/70 backdrop-blur-sm text-[10px] font-semibold text-neutral-100 px-1.5 py-0.5 rounded">
            {c.size} {c.size === 1 ? "movie" : "movies"}
          </div>
        )}

        {finished && (
          <div
            className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-success-500 text-neutral-950 flex items-center justify-center shadow-lg ring-2 ring-neutral-950/40"
            title="You've watched every released film in this collection"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}

        {!finished && started && progressDenom > 0 && (
          <div
            className="absolute left-1.5 right-1.5 bottom-1.5 flex flex-col gap-0.5"
            title={`${watched} of ${progressDenom} watched`}
          >
            <div className="flex items-center justify-between text-[9.5px] font-mono font-semibold text-white drop-shadow">
              <span>{watched}/{progressDenom}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-[3px] bg-black/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="min-w-0">
        <span className="block text-sm font-semibold text-neutral-100 line-clamp-2 group-hover:text-primary-300 transition-colors leading-tight">
          {c.name}
        </span>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-neutral-500">
          {yearRange && <span>{yearRange}</span>}
          {yearRange && c.avg_rating != null && (
            <span className="text-neutral-700">·</span>
          )}
          {c.avg_rating != null && (
            <span className="flex items-center gap-0.5 text-warning-400 font-medium">
              <StarIcon filled className="w-2.5 h-2.5" />
              {c.avg_rating.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function parseIntOrNull(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function parseFloatOrNull(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function BrowseCollections() {
  usePageTitle("Browse collections");
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const initialQuery = searchParams.get("q") ?? "";
  const [queryInput, setQueryInput] = useState(initialQuery);
  const debouncedQuery = useDebounced(queryInput, 250);
  const trimmedQuery = debouncedQuery.trim();
  const isSearching = trimmedQuery.length > 0;

  const filters: BrowseFilters = useMemo(() => {
    const dir = searchParams.get("dir");
    return {
      sort: (searchParams.get("sort") as BrowseSort) ?? "popularity",
      direction: dir === "asc" || dir === "desc" ? dir : undefined,
      genre_id: parseIntOrNull(searchParams.get("genre")),
      min_size: parseIntOrNull(searchParams.get("min_size")),
      max_size: parseIntOrNull(searchParams.get("max_size")),
      min_rating: parseFloatOrNull(searchParams.get("min_rating")),
      year_from: parseIntOrNull(searchParams.get("year_from")),
      year_to: parseIntOrNull(searchParams.get("year_to")),
    };
  }, [searchParams]);

  const activeSort: BrowseSort = filters.sort ?? "popularity";
  const naturalDir = NATURAL_SORT_DIRECTION[activeSort];
  const effectiveDir: "asc" | "desc" = filters.direction ?? naturalDir;

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmedQuery) {
          next.set("q", trimmedQuery);
          next.delete("page");
        } else {
          next.delete("q");
        }
        return next;
      },
      { replace: true },
    );
  }, [trimmedQuery, setSearchParams]);

  const browse = useCollectionsBrowse(page, PAGE_SIZE, filters);
  const search = useCollectionsSearch(trimmedQuery);
  const genres = useCollectionGenres();

  const results: CollectionSummary[] = isSearching
    ? search.data?.results ?? []
    : browse.data?.results ?? [];
  const visibleIds = useMemo(() => results.map((r) => r.id), [results]);
  const { data: statusMap } = useBulkCollectionStatus(visibleIds);
  const total = browse.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loading = isSearching ? search.isPending : browse.isPending;

  const pageStart = (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, total);

  function setParam(key: string, value: string | null) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
      next.delete("page"); // any filter change resets pagination
      return next;
    });
  }

  const [pendingScrollPage, setPendingScrollPage] = useState<number | null>(null);

  function setPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("page", String(p));
      return next;
    });
    setPendingScrollPage(p);
  }

  // Scroll to top only once the data for the requested page has actually
  // arrived — otherwise (because of keepPreviousData) we'd scroll while the
  // previous page's cards are still visible.
  useEffect(() => {
    if (pendingScrollPage == null) return;
    if (browse.isFetching) return;
    if (browse.data?.page !== pendingScrollPage) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    setPendingScrollPage(null);
  }, [pendingScrollPage, browse.isFetching, browse.data?.page]);

  function clearFilters() {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      const q = prev.get("q");
      if (q) next.set("q", q);
      return next;
    });
  }

  function changeSort(next: BrowseSort) {
    // Snap direction back to the natural one for the new sort — keeping a stale
    // override (e.g. "popularity asc" → switching to "name") is rarely what users want.
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "popularity") params.delete("sort");
      else params.set("sort", next);
      params.delete("dir");
      params.delete("page");
      return params;
    });
  }

  function toggleDirection() {
    const flipped: "asc" | "desc" = effectiveDir === "asc" ? "desc" : "asc";
    setParam("dir", flipped === naturalDir ? null : flipped);
  }

  const hasActiveFilters =
    filters.genre_id != null ||
    filters.min_size != null ||
    filters.max_size != null ||
    filters.min_rating != null ||
    filters.year_from != null ||
    filters.year_to != null ||
    filters.direction != null ||
    (filters.sort && filters.sort !== "popularity");

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="px-6 sm:px-10 pt-7 pb-4">
        <div className="text-[11px] font-mono tracking-widest text-neutral-500 uppercase mb-2">
          Discover · Browse collections
        </div>
        <h1
          className="text-[2.6rem] font-light tracking-tight text-neutral-100 leading-none"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          Movie <em className="italic text-primary-400">collections</em>
        </h1>
        <p className="text-neutral-400 mt-3 text-sm max-w-xl">
          Franchises, sagas, and groupings of related films.
        </p>
      </div>

      {/* Search + filters */}
      <div className="px-6 sm:px-10 pb-6 space-y-4">
        <div className="relative max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search collections…"
            className="w-full bg-neutral-800 border border-neutral-700 focus:border-primary-500 focus:outline-none rounded-xl pl-10 pr-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500"
          />
        </div>

        {!isSearching && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-end gap-1.5">
              <FilterSelect
                label="Sort by"
                value={activeSort}
                onChange={(v) => changeSort(v as BrowseSort)}
                options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <button
                type="button"
                onClick={toggleDirection}
                title={
                  effectiveDir === "asc"
                    ? "Ascending — click to reverse"
                    : "Descending — click to reverse"
                }
                aria-label={`Sort direction: ${effectiveDir === "asc" ? "ascending" : "descending"}`}
                className="bg-neutral-800 border border-neutral-700 hover:border-neutral-600 focus:border-primary-500 focus:outline-none rounded-lg w-[34px] h-[34px] flex items-center justify-center text-neutral-300 hover:text-neutral-100 transition-colors"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${effectiveDir === "asc" ? "" : "rotate-180"}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14" />
                  <path d="M6 11l6-6 6 6" />
                </svg>
              </button>
            </div>
            <FilterSelect
              label="Genre"
              value={filters.genre_id != null ? String(filters.genre_id) : ""}
              onChange={(v) => setParam("genre", v || null)}
              options={[
                { value: "", label: "Any" },
                ...(genres.data?.genres ?? []).map((g) => ({
                  value: String(g.id),
                  label: `${g.name} (${g.collection_count})`,
                })),
              ]}
            />
            <FilterNumber
              label="Min rating"
              placeholder="0–10"
              value={filters.min_rating ?? ""}
              onChange={(v) => setParam("min_rating", v)}
              step="0.1"
              min={0}
              max={10}
            />
            <FilterNumber
              label="Year from"
              placeholder="e.g. 1990"
              value={filters.year_from ?? ""}
              onChange={(v) => setParam("year_from", v)}
              min={1800}
              max={2200}
            />
            <FilterNumber
              label="Year to"
              placeholder="e.g. 2020"
              value={filters.year_to ?? ""}
              onChange={(v) => setParam("year_to", v)}
              min={1800}
              max={2200}
            />
            <FilterNumber
              label="Min size"
              placeholder="# of movies"
              value={filters.min_size ?? ""}
              onChange={(v) => setParam("min_size", v)}
              min={1}
            />
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs font-medium text-neutral-400 hover:text-neutral-200 px-3 py-1.5 border border-neutral-700 hover:border-neutral-600 rounded-lg transition-colors h-[34px]"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Toolbar */}
      {!loading && results.length > 0 && (
        <div className="px-6 sm:px-10 pb-4">
          <span className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase">
            {isSearching
              ? `${results.length} match${results.length === 1 ? "" : "es"}`
              : `Showing ${pageStart.toLocaleString()}–${pageEnd.toLocaleString()} of ${total.toLocaleString()}`}
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

      {/* Empty */}
      {!loading && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-300 font-medium mb-1">No collections found</p>
          <p className="text-neutral-500 text-sm">
            {isSearching
              ? "Try a different search term"
              : hasActiveFilters
                ? "Try loosening the filters"
                : "The catalog is empty — the daily sync may not have run yet"}
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && results.length > 0 && (
        <div className="px-6 sm:px-10 pb-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-4">
          {results.map((c) => (
            <CollectionCard key={c.id} c={c} status={statusMap?.[String(c.id)]} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isSearching && !loading && totalPages > 1 && (
        <div className="px-6 sm:px-10 pb-10 flex items-center justify-center gap-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            ← Previous
          </button>
          <span className="font-mono text-xs text-neutral-500 tracking-wider">
            Page {page.toLocaleString()} of {totalPages.toLocaleString()}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-neutral-800 border border-neutral-700 hover:border-neutral-600 focus:border-primary-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-neutral-100 min-w-[140px] h-[34px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterNumber({
  label,
  value,
  onChange,
  placeholder,
  step,
  min,
  max,
}: {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-neutral-800 border border-neutral-700 hover:border-neutral-600 focus:border-primary-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-neutral-100 w-[110px] h-[34px]"
      />
    </label>
  );
}
