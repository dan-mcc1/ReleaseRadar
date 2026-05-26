import { useEffect, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSearch } from "../hooks/api/useSearch";
import { BASE_IMAGE_URL } from "../constants";
import WatchButton, { type WatchStatus } from "../components/WatchButton";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import type { Movie, Show, Person, CollectionResult } from "../types/calendar";
import { parseLocalDate } from "../utils/date";

type Tab = "all" | "movies" | "tv" | "people" | "collections";

function getYear(item: Movie | Show): string | null {
  const date = "release_date" in item ? item.release_date : item.first_air_date;
  return date ? String(parseLocalDate(date).getFullYear()) : null;
}

function getTitle(item: Movie | Show): string {
  return "title" in item ? item.title : item.name;
}

// ── Poster grid card ───────────────────────────────────────────────────────

function PosterCard({
  item,
  type,
}: {
  item: Movie | Show;
  type: "movie" | "tv";
}) {
  const title = getTitle(item);
  const year = getYear(item);
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`;
  const genres =
    item.genres
      ?.slice(0, 2)
      .map((g) => g.name)
      .join(" · ") ?? "";

  return (
    <Link to={href} className="group block cursor-pointer">
      <div className="relative rounded-xl overflow-hidden bg-neutral-800 aspect-[2/3]">
        {item.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${item.poster_path}`}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
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
                strokeWidth={1}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
      </div>
      <div className="mt-2.5">
        <p className="text-sm font-semibold text-neutral-100 group-hover:text-white transition-colors leading-tight line-clamp-1 tracking-tight">
          {title}
        </p>
        <p className="text-[11.5px] text-neutral-500 mt-0.5 font-mono">
          {[year, genres, item.vote_average ? `★ ${item.vote_average.toFixed(1)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </Link>
  );
}

// ── Hero top result ─────────────────────────────────────────────────────────

type StatusEntry = { status: string; rating: number | null };

function TopResultHero({
  item,
  type,
  statusEntry,
}: {
  item: Movie | Show;
  type: "movie" | "tv";
  statusEntry: StatusEntry | undefined;
}) {
  const title = getTitle(item);
  const year = getYear(item);
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`;
  const genres =
    item.genres
      ?.slice(0, 2)
      .map((g) => g.name)
      .join(" · ") ?? "";
  const typeLabel = type === "tv" ? "TV Show" : "Movie";
  const skipNotifyPrompt =
    type === "movie"
      ? !!(item as Movie).release_date && new Date((item as Movie).release_date + "T00:00:00") <= new Date()
      : (item as Show).status === "Ended" || (item as Show).status === "Canceled" || (item as Show).status === "Cancelled";

  return (
    <div className="mb-8">
      <p className="font-mono text-[10.5px] tracking-widest uppercase text-neutral-500 mb-3">
        Top result · {typeLabel}
      </p>
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ minHeight: 200, background: "#111" }}
      >
        {item.backdrop_path && (
          <img
            src={`${BASE_IMAGE_URL}/w1280${item.backdrop_path}`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.15) 100%)",
          }}
        />
        <div className="relative flex items-center gap-4 sm:gap-6 px-5 sm:px-7 py-6">
          {item.poster_path && (
            <Link to={href} className="flex-shrink-0">
              <img
                src={`${BASE_IMAGE_URL}/w342${item.poster_path}`}
                alt={title}
                className="h-32 sm:h-48 rounded-lg shadow-2xl object-cover"
                style={{ aspectRatio: "2/3", width: "auto" }}
              />
            </Link>
          )}
          <div className="flex-1 text-white min-w-0">
            <p className="font-mono text-[10.5px] tracking-widest uppercase opacity-60 mb-2">
              {[typeLabel, genres, item.vote_average ? `★ ${item.vote_average.toFixed(1)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <h2
              className="font-sans font-light italic tracking-tight leading-none mb-3 line-clamp-2 text-[24px] sm:text-[40px]"
            >
              {title}
            </h2>
            <div className="flex items-center gap-4 mb-4">
              {year && (
                <span className="font-mono text-[12px] opacity-80">{year}</span>
              )}
              {statusEntry?.status && statusEntry.status !== "none" && (
                <span
                  className="px-2 py-0.5 rounded-full font-mono text-[10.5px] uppercase tracking-wide"
                  style={{
                    background: "rgba(16,185,129,0.2)",
                    color: "#34d399",
                  }}
                >
                  {statusEntry.status}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Link
                to={href}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-500 transition-colors text-white"
              >
                View {typeLabel} →
              </Link>
              <WatchButton
                contentType={type}
                contentId={item.id}
                initialStatus={statusEntry?.status as WatchStatus}
                initialRating={statusEntry?.rating ?? undefined}
                compact
                skipNotifyPrompt={skipNotifyPrompt}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────

function SectionHeader({
  title,
  count,
  onSeeAll,
}: {
  title: string;
  count: number;
  onSeeAll?: () => void;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-5">
      <h2 className="m-0 font-sans font-light italic tracking-tight text-2xl text-neutral-100">
        {title}
      </h2>
      <span className="font-mono text-[11px] text-neutral-600">· {count}</span>
      <div className="flex-1" />
      {onSeeAll && (
        <button
          onClick={onSeeAll}
          className="text-[12.5px] text-neutral-400 hover:text-neutral-200 transition-colors font-medium"
        >
          See all →
        </button>
      )}
    </div>
  );
}

// ── Person card ─────────────────────────────────────────────────────────────

function PersonCard({ person }: { person: Person }) {
  const initials = person.name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const hue =
    ((person.name.charCodeAt(0) ?? 0) * 37 +
      (person.name.charCodeAt(1) ?? 0) * 13) %
    360;

  return (
    <Link
      to={`/person/${person.id}`}
      className="flex items-center gap-3.5 p-3 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/50 hover:border-neutral-700 transition-all group"
    >
      <div
        className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center font-semibold text-white text-base overflow-hidden"
        style={{
          background: `linear-gradient(135deg, oklch(0.6 0.13 ${hue}), oklch(0.4 0.13 ${(hue + 40) % 360}))`,
        }}
      >
        {person.profile_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w185${person.profile_path}`}
            alt={person.name}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          initials
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-neutral-100 group-hover:text-white transition-colors line-clamp-1">
          {person.name}
        </p>
        {person.known_for_department && (
          <p className="font-mono text-[10px] text-neutral-500 mt-0.5 uppercase tracking-wide">
            {person.known_for_department}
          </p>
        )}
      </div>
      <svg
        className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5l7 7-7 7"
        />
      </svg>
    </Link>
  );
}

// ── Collection card ─────────────────────────────────────────────────────────

function CollectionCard({ collection }: { collection: CollectionResult }) {
  const hue = (collection.name.charCodeAt(0) * 37) % 360;

  return (
    <Link
      to={`/collection/${collection.id}`}
      className="relative overflow-hidden rounded-xl border border-neutral-800 group block"
      style={{
        background: `linear-gradient(135deg, oklch(0.25 0.10 ${hue}) 0%, oklch(0.15 0.06 ${hue}) 100%)`,
      }}
    >
      {collection.backdrop_path && (
        <>
          <img
            src={`${BASE_IMAGE_URL}/w780${collection.backdrop_path}`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-20 group-hover:opacity-30 transition-opacity"
          />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.45), rgba(0,0,0,0.15))" }}
          />
        </>
      )}
      <div className="relative p-4 flex items-center gap-4">
        {collection.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w92${collection.poster_path}`}
            alt={collection.name}
            className="h-14 rounded-md shadow-lg flex-shrink-0 object-cover"
            style={{ aspectRatio: "2/3", width: "auto" }}
          />
        ) : (
          <div className="w-10 h-14 rounded-md bg-neutral-700/50 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0 text-white">
          <p className="font-sans font-light italic text-lg leading-tight line-clamp-1">
            {collection.name}
          </p>
          <p className="font-mono text-[10px] opacity-60 tracking-widest uppercase mt-1">
            Collection
          </p>
        </div>
      </div>
    </Link>
  );
}

// ── Main Search page ────────────────────────────────────────────────────────

export default function Search() {
  usePageTitle("Search");
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const activeTab = (searchParams.get("tab") as Tab) ?? "all";
  function setActiveTab(tab: Tab) {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }

  useEffect(() => {
    setSearchParams((p) => { p.set("tab", "all"); return p; }, { replace: true });
  }, [query]);

  const { data, isPending: loading } = useSearch(query);
  const results = data ?? { movies: [], shows: [], people: [], collections: [] };
  const { movies, shows, people, collections } = results;

  const total =
    movies.length + shows.length + people.length + collections.length;

  const allTabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "movies", label: "Movies", count: movies.length },
    { key: "tv", label: "TV Shows", count: shows.length },
    { key: "people", label: "People", count: people.length },
    { key: "collections", label: "Collections", count: collections.length },
  ];
  const tabs = allTabs.filter((t) => t.key === "all" || t.count > 0);

  // Top result — highest popularity movie or show
  const topResult = useMemo(() => {
    const candidates: { item: Movie | Show; type: "movie" | "tv" }[] = [
      ...movies.map((m) => ({ item: m as Movie | Show, type: "movie" as const })),
      ...shows.map((s) => ({ item: s as Movie | Show, type: "tv" as const })),
    ];
    if (!candidates.length) return null;
    return candidates.reduce((best, c) =>
      (c.item.popularity ?? 0) > (best.item.popularity ?? 0) ? c : best,
    );
  }, [movies, shows]);

  // Bulk status for hero
  const statusItems = useMemo(() => {
    if (!topResult) return [];
    return [{ content_type: topResult.type, content_id: topResult.item.id }];
  }, [topResult]);
  const { data: statusMap } = useBulkWatchStatus(statusItems);

  const heroStatusEntry = topResult
    ? statusMap?.[`${topResult.type}:${topResult.item.id}`]
    : undefined;

  // Preview slices for "all" tab
  const previewShows = shows.slice(0, 8);
  const previewMovies = movies.slice(0, 8);

  return (
    <div className="min-h-screen pb-16">
      {/* ── Page header ── */}
      <div className="px-6 sm:px-10 pt-7 pb-5">
        <p className="font-mono text-[11px] tracking-widest uppercase text-neutral-500 mb-2">
          {query
            ? `Search · ${total} result${total !== 1 ? "s" : ""}`
            : "Search"}
        </p>
        <h1
          className="font-sans font-light tracking-tight leading-none m-0"
          style={{ fontSize: 40 }}
        >
          {query ? (
            <>
              Results for{" "}
              <em className="italic text-primary-400 not-italic" style={{ fontStyle: "italic" }}>
                &ldquo;{query}&rdquo;
              </em>
            </>
          ) : (
            "Search"
          )}
        </h1>
      </div>

      {/* ── Tabs ── */}
      {!loading && total > 0 && (
        <div className="px-6 sm:px-10 pb-6">
          <div className="flex gap-1.5 flex-wrap">
            {tabs.map((t) => {
              const active = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium border transition-colors ${
                    active
                      ? "bg-neutral-800 border-neutral-600 text-white"
                      : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
                  }`}
                >
                  {t.label}
                  <span className="font-mono text-[10.5px] text-neutral-500 leading-none self-center">
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="font-mono text-[12px] text-neutral-500 tracking-wide">
              Searching…
            </p>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && query && total === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center px-6">
          <div className="w-16 h-16 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-5">
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="text-neutral-200 font-semibold mb-1">No results found</h3>
          <p className="font-mono text-[12px] text-neutral-600">
            Try a different search term
          </p>
        </div>
      )}

      {/* ── "All" tab content ── */}
      {!loading && activeTab === "all" && total > 0 && (
        <div className="px-6 sm:px-10">
          {/* Top result hero */}
          {topResult && (
            <TopResultHero
              item={topResult.item}
              type={topResult.type}
              statusEntry={heroStatusEntry}
            />
          )}

          {(() => {
            const showsBlock = previewShows.length > 0 && (
              <div className="mb-8" key="shows">
                <SectionHeader
                  title="TV Shows"
                  count={shows.length}
                  onSeeAll={shows.length > 8 ? () => setActiveTab("tv") : undefined}
                />
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {previewShows.map((s) => (
                    <PosterCard key={s.id} item={s} type="tv" />
                  ))}
                </div>
              </div>
            );
            const moviesBlock = previewMovies.length > 0 && (
              <div className="mb-8" key="movies">
                <SectionHeader
                  title="Movies"
                  count={movies.length}
                  onSeeAll={movies.length > 8 ? () => setActiveTab("movies") : undefined}
                />
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {previewMovies.map((m) => (
                    <PosterCard key={m.id} item={m} type="movie" />
                  ))}
                </div>
              </div>
            );
            // Order the two sections by the popularity of each list's top
            // result — whichever type's #1 is hotter shows first.
            const moviesFirst =
              (movies[0]?.popularity ?? 0) > (shows[0]?.popularity ?? 0);
            return moviesFirst ? (
              <>
                {moviesBlock}
                {showsBlock}
              </>
            ) : (
              <>
                {showsBlock}
                {moviesBlock}
              </>
            );
          })()}

          {/* People + Collections side by side */}
          {(people.length > 0 || collections.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              {people.length > 0 && (
                <div>
                  <SectionHeader
                    title="People"
                    count={people.length}
                    onSeeAll={people.length > 5 ? () => setActiveTab("people") : undefined}
                  />
                  <div className="flex flex-col gap-2">
                    {people.slice(0, 5).map((p) => (
                      <PersonCard key={p.id} person={p} />
                    ))}
                  </div>
                </div>
              )}
              {collections.length > 0 && (
                <div>
                  <SectionHeader
                    title="Collections"
                    count={collections.length}
                    onSeeAll={collections.length > 5 ? () => setActiveTab("collections") : undefined}
                  />
                  <div className="flex flex-col gap-2.5">
                    {collections.slice(0, 5).map((c) => (
                      <CollectionCard key={c.id} collection={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Individual tab full lists ── */}
      {!loading && activeTab === "tv" && (
        <div className="px-6 sm:px-10">
          <SectionHeader title="TV Shows" count={shows.length} />
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {shows.map((s) => (
              <PosterCard key={s.id} item={s} type="tv" />
            ))}
          </div>
        </div>
      )}

      {!loading && activeTab === "movies" && (
        <div className="px-6 sm:px-10">
          <SectionHeader title="Movies" count={movies.length} />
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {movies.map((m) => (
              <PosterCard key={m.id} item={m} type="movie" />
            ))}
          </div>
        </div>
      )}

      {!loading && activeTab === "people" && (
        <div className="px-6 sm:px-10">
          <SectionHeader title="People" count={people.length} />
          <div className="flex flex-col gap-2">
            {people.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        </div>
      )}

      {!loading && activeTab === "collections" && (
        <div className="px-6 sm:px-10">
          <SectionHeader title="Collections" count={collections.length} />
          <div className="flex flex-col gap-2.5">
            {collections.map((c) => (
              <CollectionCard key={c.id} collection={c} />
            ))}
          </div>
        </div>
      )}

      {/* ── Keyboard tip ── */}
      {!loading && total > 0 && (
        <p className="px-6 sm:px-10 pt-10 text-center font-mono text-[11.5px] text-neutral-700 italic">
          Tip — press{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 not-italic text-neutral-500">
            Esc
          </kbd>{" "}
          to clear search
        </p>
      )}
    </div>
  );
}
