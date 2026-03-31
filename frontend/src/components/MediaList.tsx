import { BASE_IMAGE_URL, API_URL } from "../constants";
import { Link } from "react-router-dom";
import { Movie, Show, Person } from "../types/calendar";
import { parseLocalDate } from "../utils/date";
import { useState, useEffect } from "react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../firebase";
import WatchButton, { WatchStatus } from "./WatchButton";

interface MediaListProps {
  results: {
    movies?: Movie[];
    shows?: Show[];
    people?: Person[];
  };
  showWatchButton?: boolean;
}

const INITIAL_COUNT = 6;

const known_for_to_job: Record<string, string> = {
  Acting: "Actor",
  Production: "Producer",
  Directing: "Director",
  Art: "Artist",
  Writing: "Writer",
  Sound: "Sound",
  "Visual Effects": "VFX",
};

function getYear(item: Movie | Show): string | null {
  const date = "release_date" in item ? item.release_date : item.first_air_date;
  return date ? String(parseLocalDate(date).getFullYear()) : null;
}

function formatFullDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-us", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type StatusMap = Record<string, { status: WatchStatus; rating: number | null }>;

// ── Media row card (movie / show) ──────────────────────────────────────────

function MediaRow({
  item,
  type,
  showWatchButton = true,
  statusMap,
}: {
  item: Movie | Show;
  type: "movie" | "tv";
  showWatchButton?: boolean;
  showFullDate?: boolean;
  statusMap?: StatusMap;
}) {
  const title = "title" in item ? item.title : item.name;
  const year = getYear(item);
  const genres: { id: number; name: string }[] = item.genres ?? [];
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`;
  const rawDate =
    "release_date" in item ? item.release_date : item.first_air_date;
  const releaseDate = rawDate ? formatFullDate(rawDate) : null;

  return (
    <div className="flex gap-4 bg-slate-800/60 border border-slate-700 hover:border-slate-600 rounded-xl transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:shadow-black/30">
      {/* Thumbnail */}
      <Link
        to={href}
        className="relative flex-shrink-0 w-36 sm:w-44 overflow-hidden rounded-l-xl"
      >
        {item.backdrop_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w300${item.backdrop_path}`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : item.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w154${item.poster_path}`}
            alt=""
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="h-full w-full min-h-[88px] bg-slate-700 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-slate-500"
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
        {/* Type badge */}
        <div className="absolute top-2 left-2">
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full backdrop-blur-sm ${
              type === "tv"
                ? "bg-purple-600/80 text-purple-100"
                : "bg-amber-600/80 text-amber-100"
            }`}
          >
            {type === "tv" ? "TV" : "Film"}
          </span>
        </div>
      </Link>

      {/* Info */}
      <div className="flex flex-col justify-center gap-1.5 py-3 pr-3 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={href}>
              <h3 className="font-semibold text-slate-100 hover:text-white transition-colors line-clamp-1 text-sm sm:text-base">
                {title}
              </h3>
            </Link>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {releaseDate ? (
                <span className="text-xs text-slate-500">{releaseDate}</span>
              ) : (
                year && <span className="text-xs text-slate-500">{year}</span>
              )}
              {genres.slice(0, 3).map((g, i) => (
                <span key={g.id} className="flex items-center gap-2">
                  {i > 0 || year || releaseDate ? (
                    <span className="text-slate-700">·</span>
                  ) : null}
                  <span className="text-xs text-slate-500">{g.name}</span>
                </span>
              ))}
              {item.vote_average != null && item.vote_average > 0 && (
                <span className="flex items-center gap-1 text-xs text-yellow-400 font-medium">
                  <span className="text-slate-700">·</span>
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  {item.vote_average.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          {showWatchButton && (
            <div className="flex-shrink-0 hidden sm:block">
              {statusMap === undefined ? (
                <div className="h-9 w-36 rounded-xl bg-slate-700 animate-pulse" />
              ) : (
                <WatchButton
                  contentType={type}
                  contentId={item.id}
                  initialStatus={statusMap[`${type}:${item.id}`]?.status}
                  initialRating={statusMap[`${type}:${item.id}`]?.rating}
                />
              )}
            </div>
          )}
        </div>

        {item.overview && (
          <p className="text-slate-400 text-xs sm:text-sm line-clamp-2 leading-relaxed">
            {item.overview}
          </p>
        )}

        {/* WatchButton on mobile (below overview) */}
        {showWatchButton && (
          <div className="sm:hidden mt-1">
            {statusMap === undefined ? (
              <div className="h-9 w-36 rounded-xl bg-slate-700 animate-pulse" />
            ) : (
              <WatchButton
                contentType={type}
                contentId={item.id}
                initialStatus={statusMap[`${type}:${item.id}`]?.status}
                initialRating={statusMap[`${type}:${item.id}`]?.rating}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Person row ─────────────────────────────────────────────────────────────

function PersonRow({ person }: { person: Person }) {
  return (
    <Link
      to={`/person/${person.id}`}
      className="flex gap-4 items-center bg-slate-800/60 border border-slate-700 hover:border-slate-600 rounded-xl overflow-hidden transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:shadow-black/30 group"
    >
      <div className="relative flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 m-2 rounded-full overflow-hidden bg-slate-700">
        {person.profile_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w154${person.profile_path}`}
            alt={person.name}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-slate-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
        )}
      </div>
      <div>
        <p className="font-semibold text-slate-100 group-hover:text-white transition-colors text-sm sm:text-base">
          {person.name}
        </p>
        {person.known_for_department && (
          <p className="text-xs text-slate-500 mt-0.5">
            {known_for_to_job[person.known_for_department] ??
              person.known_for_department}
          </p>
        )}
      </div>
    </Link>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({
  title,
  total,
  visible,
  onToggle,
  children,
}: {
  title: string;
  total: number;
  visible: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const isExpanded = visible >= total;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        <span className="text-xs text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
          {total}
        </span>
        <div className="flex-1 h-px bg-slate-800" />
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3">{children}</div>

      {/* Toggle */}
      {total > INITIAL_COUNT && (
        <button
          onClick={onToggle}
          className="mt-4 flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          {isExpanded ? "Show less" : `Show ${total - visible} more`}
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export default function MediaList({
  results,
  showWatchButton = true,
}: MediaListProps) {
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>(
    {},
  );
  // undefined = not yet fetched, {} = fetched (user logged out or no items)
  const [statusMap, setStatusMap] = useState<StatusMap | undefined>(undefined);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const movies = results.movies ?? [];
  const shows = results.shows ?? [];
  const people = results.people ?? [];

  // Fetch all statuses in one request instead of one per WatchButton.
  // Wait for auth state before fetching so currentUser is available.
  useEffect(() => {
    if (!showWatchButton) {
      setStatusMap({});
      return;
    }

    const items = [
      ...movies.map((m) => ({ content_type: "movie", content_id: m.id })),
      ...shows.map((s) => ({ content_type: "tv", content_id: s.id })),
    ];

    const auth = getAuth(firebaseApp);
    // onAuthStateChanged fires immediately with the cached user (or null)
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setIsSignedIn(!!user);
      if (!user || !items.length) {
        setStatusMap({});
        return;
      }
      user.getIdToken().then((token) =>
        fetch(`${API_URL}/watchlist/status/bulk`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(items),
        })
          .then((r) => (r.ok ? r.json() : {}))
          .then(setStatusMap)
          .catch(() => setStatusMap({})),
      );
    });
    return unsubscribe;
  }, [movies, shows, showWatchButton]);

  if (movies.length === 0 && shows.length === 0 && people.length === 0)
    return null;

  const mediaSections = [
    { key: "Movies", items: movies, type: "movie" as const },
    { key: "TV Shows", items: shows, type: "tv" as const },
  ]
    .filter((s) => s.items.length > 0)
    .sort(
      (a, b) => (b.items[0]?.popularity ?? 0) - (a.items[0]?.popularity ?? 0),
    );

  function toggle(key: string, total: number) {
    setVisibleCounts((prev) => {
      const current = prev[key] ?? INITIAL_COUNT;
      return { ...prev, [key]: current >= total ? INITIAL_COUNT : total };
    });
  }

  return (
    <div className="flex flex-col gap-10">
      {mediaSections.map((section) => {
        const visible = visibleCounts[section.key] ?? INITIAL_COUNT;
        return (
          <Section
            key={section.key}
            title={section.key}
            total={section.items.length}
            visible={visible}
            onToggle={() => toggle(section.key, section.items.length)}
          >
            {section.items.slice(0, visible).map((item) => (
              <MediaRow
                key={item.id}
                item={item as Movie | Show}
                type={section.type}
                showWatchButton={showWatchButton && isSignedIn}
                statusMap={statusMap}
              />
            ))}
          </Section>
        );
      })}

      {people.length > 0 &&
        (() => {
          const visible = visibleCounts["People"] ?? INITIAL_COUNT;
          return (
            <Section
              title="People"
              total={people.length}
              visible={visible}
              onToggle={() => toggle("People", people.length)}
            >
              {people.slice(0, visible).map((p) => (
                <PersonRow key={p.id} person={p} />
              ))}
            </Section>
          );
        })()}
    </div>
  );
}
