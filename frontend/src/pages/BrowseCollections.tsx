import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpIcon } from "@heroicons/react/24/outline";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  Button,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  IconButton,
  PageHeader,
  PosterCard,
  PosterCardSkeleton,
  SearchField,
  StarIcon,
  cx,
  selectClass,
} from "../components/ui";
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
    <PosterCard
      to={`/collection/${c.id}`}
      title={c.name}
      posterPath={c.poster_path}
      corner={
        finished ? (
          <span
            className="size-6 rounded-full bg-success-500 text-neutral-950 flex items-center justify-center"
            title="You've watched every released film in this collection"
          >
            <CheckIcon className="w-3.5 h-3.5" />
          </span>
        ) : undefined
      }
      subtitle={
        (yearRange || (c.size != null && c.size > 0) || c.avg_rating != null) && (
          <span className="inline-flex items-center gap-1.5">
            {yearRange && <span>{yearRange}</span>}
            {c.size != null && c.size > 0 && (
              <>
                {yearRange && <span aria-hidden="true">·</span>}
                <span>
                  {c.size} {c.size === 1 ? "movie" : "movies"}
                </span>
              </>
            )}
            {c.avg_rating != null && (
              <>
                {(yearRange || (c.size != null && c.size > 0)) && <span aria-hidden="true">·</span>}
                <span className="inline-flex items-center gap-1">
                  <StarIcon className="w-3 h-3 text-warning-400" />
                  <span className="tabular">{c.avg_rating.toFixed(1)}</span>
                </span>
              </>
            )}
          </span>
        )
      }
      footer={
        !finished && started && progressDenom > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="h-1 bg-neutral-800 rounded-full overflow-hidden" aria-hidden="true">
              <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-caption text-neutral-400 tabular">
              {watched} of {progressDenom} watched
            </p>
          </div>
        ) : undefined
      }
    />
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

  const pendingScrollPage = useRef<number | null>(null);

  function setPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("page", String(p));
      return next;
    });
    pendingScrollPage.current = p;
  }

  // Scroll to top only once the data for the requested page has actually
  // arrived — otherwise (because of keepPreviousData) we'd scroll while the
  // previous page's cards are still visible.
  useEffect(() => {
    if (pendingScrollPage.current == null) return;
    if (browse.isFetching) return;
    if (browse.data?.page !== pendingScrollPage.current) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    pendingScrollPage.current = null;
  }, [browse.isFetching, browse.data?.page]);

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
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <PageHeader
        title="Movie collections"
        description="Franchises, sagas, and groupings of related films."
      />

      {/* Search + filters */}
      <div className="space-y-4">
        <SearchField
          value={queryInput}
          onChange={setQueryInput}
          label="Search collections"
          placeholder="Search collections…"
          className="w-96"
        />

        {!isSearching && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-end gap-1.5">
              <FilterSelect
                label="Sort by"
                value={activeSort}
                onChange={(v) => changeSort(v as BrowseSort)}
                options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <IconButton
                label={`Sort direction: ${effectiveDir === "asc" ? "ascending" : "descending"}. Click to reverse`}
                icon={
                  <ArrowUpIcon
                    className={cx("w-4 h-4 transition-transform", effectiveDir !== "asc" && "rotate-180")}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                }
                variant="secondary"
                shape="square"
                onClick={toggleDirection}
              />
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
            {hasActiveFilters && <Button onClick={clearFilters}>Clear filters</Button>}
          </div>
        )}
      </div>

      {/* Toolbar */}
      {!loading && results.length > 0 && (
        <p className="text-label text-neutral-400 tabular">
          {isSearching
            ? `${results.length} match${results.length === 1 ? "" : "es"}`
            : `Showing ${pageStart.toLocaleString()}–${pageEnd.toLocaleString()} of ${total.toLocaleString()}`}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-posters gap-4"
          aria-hidden="true"
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <PosterCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && results.length === 0 && (
        <EmptyState
          title="No collections found"
          description={
            isSearching
              ? "Try a different search term."
              : hasActiveFilters
                ? "Try loosening the filters."
                : "The catalog is empty. The daily sync may not have run yet."
          }
          action={
            !isSearching && hasActiveFilters ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : undefined
          }
        />
      )}

      {/* Grid */}
      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-posters gap-4">
          {results.map((c) => (
            <CollectionCard key={c.id} c={c} status={statusMap?.[String(c.id)]} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isSearching && !loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            icon={<ChevronLeftIcon />}
          >
            Previous
          </Button>
          <span className="text-label text-neutral-400 tabular">
            Page {page.toLocaleString()} of {totalPages.toLocaleString()}
          </span>
          <Button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
          >
            Next
            <ChevronRightIcon />
          </Button>
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
      <span className="text-caption text-neutral-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(selectClass, "min-w-[140px]")}
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
      <span className="text-caption text-neutral-400">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-control w-[110px] rounded-control border border-neutral-700 bg-neutral-900 px-3 text-label text-neutral-100 placeholder-neutral-500 hover:border-neutral-500 focus:border-neutral-400 focus:outline-none"
      />
    </label>
  );
}
