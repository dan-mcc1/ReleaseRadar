import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthUser } from "../hooks/useAuthUser";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { Link } from "react-router-dom";
import { useForYou } from "../hooks/api/useRecommendations";
import { useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import type { WatchStatus } from "../components/WatchButton";
import { BASE_IMAGE_URL } from "../constants";

type Tab = "movies" | "tv";
type Mode = "recent" | "top_rated";

// TMDB recommendation items have genre_ids, not genre objects
type RecItem = (Movie | Show) & { genre_ids?: number[]; media_type?: string };

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy",
  10768: "War & Politics", 10762: "Kids", 10763: "News", 10764: "Reality",
};


function getTitle(item: RecItem) {
  return "title" in item && item.title ? item.title : (item as Show).name ?? "";
}

function getGenre(item: RecItem): string {
  if (item.genre_ids?.length) return GENRE_MAP[item.genre_ids[0]] ?? "";
  if ("genres" in item && item.genres?.length) return item.genres[0].name;
  return "";
}

function getYear(item: RecItem): string {
  const raw = "release_date" in item ? item.release_date : (item as Show).first_air_date;
  return raw ? raw.slice(0, 4) : "";
}

function PosterSkeleton() {
  return <div className="aspect-[2/3] rounded-xl bg-neutral-800 animate-pulse" />;
}

function HeroSkeleton() {
  return <div className="rounded-2xl bg-neutral-800 animate-pulse" style={{ height: 380 }} />;
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <PosterSkeleton />
          <div className="h-3 bg-neutral-800 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-neutral-800 rounded animate-pulse" />
          <div className="h-3 bg-neutral-800 rounded animate-pulse w-1/2" />
        </div>
      ))}
    </div>
  );
}

interface HeroCardProps {
  item: RecItem;
  contentType: "movie" | "tv";
  onAdd: () => void;
  onAddWatched: () => void;
}

function HeroCard({ item, contentType, onAdd, onAddWatched }: HeroCardProps) {
  const navigate = useNavigate();
  const title = getTitle(item);
  const genre = getGenre(item);
  const year = getYear(item);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
  const backdrop = item.backdrop_path
    ? `${BASE_IMAGE_URL}/original${item.backdrop_path}`
    : null;

  return (
    <div
      className="relative rounded-2xl overflow-hidden cursor-pointer"
      style={{ height: 400 }}
      onClick={() => navigate(`/${contentType === "movie" ? "movie" : "tv"}/${item.id}`)}
    >
      {backdrop ? (
        <img src={backdrop} alt={title} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-neutral-800" />
      )}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.40) 50%, rgba(0,0,0,0.05) 100%)",
        }}
      />
      <div className="absolute inset-y-0 left-0 flex flex-col justify-center px-10 max-w-2xl">
        <div
          className="text-primary-400 mb-3 font-semibold tracking-widest uppercase"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          ◉ Top pick
        </div>
        <h2
          className="text-white leading-none tracking-tight"
          style={{ fontFamily: "var(--font-serif)", fontSize: 52, fontWeight: 600 }}
        >
          {title}
        </h2>
        <p
          className="mt-3 text-neutral-200 leading-snug"
          style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontStyle: "italic", maxWidth: 420 }}
        >
          Most recommended across your watch history
        </p>
        <div className="flex items-center gap-4 mt-3" style={{ fontSize: 13 }}>
          {genre && <span className="text-neutral-300">{genre}</span>}
          {rating && <span className="text-neutral-300">★ {rating}</span>}
          {year && <span className="text-neutral-400">{year}</span>}
        </div>
        <div className="flex items-center gap-2.5 mt-5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-primary-500 hover:bg-primary-400 text-white transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            Add to watchlist
          </button>
          <button
            onClick={onAddWatched}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Mark as watched
          </button>
          <button
            onClick={() => navigate(`/${contentType === "movie" ? "movie" : "tv"}/${item.id}`)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            More info →
          </button>
        </div>
      </div>
    </div>
  );
}

interface GridCardProps {
  item: RecItem;
  contentType: "movie" | "tv";
  onAdd: () => void;
  onAddWatched: () => void;
}

function GridCard({ item, contentType, onAdd, onAddWatched }: GridCardProps) {
  const navigate = useNavigate();
  const title = getTitle(item);
  const genre = getGenre(item);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
  const poster = item.poster_path
    ? `${BASE_IMAGE_URL}/w342${item.poster_path}`
    : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="relative rounded-xl overflow-hidden cursor-pointer aspect-[2/3] bg-neutral-800"
        onClick={() => navigate(`/${contentType === "movie" ? "movie" : "tv"}/${item.id}`)}
      >
        {poster ? (
          <img src={poster} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
            <span className="text-neutral-600 text-xs">No image</span>
          </div>
        )}
      </div>

      <div>
        <div
          className="text-neutral-100 font-semibold leading-snug cursor-pointer hover:text-primary-300 transition-colors"
          style={{ fontSize: 13.5, letterSpacing: "-0.005em" }}
          onClick={() => navigate(`/${contentType === "movie" ? "movie" : "tv"}/${item.id}`)}
        >
          {title}
        </div>
        <div className="text-neutral-500 mt-0.5" style={{ fontSize: 11.5 }}>
          {[genre, rating ? `★ ${rating}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div className="flex gap-1.5 mt-0.5">
        <button
          onClick={onAdd}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold bg-primary-500/15 hover:bg-primary-500/25 text-primary-400 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Watchlist
        </button>
        <button
          onClick={onAddWatched}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold bg-neutral-700/60 hover:bg-neutral-700 text-neutral-300 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Watched
        </button>
      </div>
    </div>
  );
}

export default function ForYou() {
  usePageTitle("For You");
  const currentUser = useAuthUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as Tab) ?? "tv";
  const mode = (searchParams.get("mode") as Mode) ?? "recent";
  function setActiveTab(tab: Tab) {
    setSearchParams((p) => { p.set("tab", tab); return p; }, { replace: true });
  }
  function setMode(m: Mode) {
    setSearchParams((p) => { p.set("mode", m); return p; }, { replace: true });
  }

  const { data, isLoading } = useForYou(mode);
  const updateWatchStatus = useUpdateWatchStatus();

  const movies = (data?.movies ?? []) as RecItem[];
  const shows = (data?.shows ?? []) as RecItem[];
  const seedCount = data?.seed_count ?? 0;

  const activeItems = activeTab === "tv" ? shows : movies;
  const contentType = activeTab === "tv" ? "tv" : "movie";

  const heroItem = activeItems[0] as RecItem | undefined;
  const gridItems = activeItems.slice(1);

  function handleAdd(item: RecItem) {
    updateWatchStatus.mutate({
      contentType: contentType as "movie" | "tv",
      contentId: item.id,
      currentStatus: "none" as WatchStatus,
      targetStatus: "Want To Watch" as WatchStatus,
    });
  }

  function handleAddWatched(item: RecItem) {
    updateWatchStatus.mutate({
      contentType: contentType as "movie" | "tv",
      contentId: item.id,
      currentStatus: "none" as WatchStatus,
      targetStatus: "Watched" as WatchStatus,
    });
  }

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-4">
        <p className="text-neutral-300 font-medium mb-2">Sign in to see recommendations</p>
        <Link to="/signIn" className="text-primary-400 hover:text-primary-300 text-sm">
          Sign in →
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-8 py-7 pb-20">
      {/* ── Header ── */}
      <div className="mb-5">
        <div
          className="text-neutral-500 uppercase tracking-widest mb-2"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.13em" }}
        >
          For you
          {seedCount > 0 && ` · Built from your ${seedCount} most recent watched & watchlist items`}
        </div>
        <div className="flex items-end gap-5 flex-wrap">
          <h1
            className="text-neutral-100 leading-none tracking-tight"
            style={{ fontFamily: "var(--font-serif)", fontSize: 40, fontWeight: 600 }}
          >
            Watch{" "}
            <em style={{ fontStyle: "italic", color: "var(--color-primary-400)" }}>
              next
            </em>
          </h1>
          <div className="flex-1" />
          <div className="flex items-center p-0.5 bg-neutral-800/80 border border-neutral-700/60 rounded-xl gap-0.5">
            {(["recent", "top_rated"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  mode === m
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {m === "recent" ? "Most recent" : "Highest rated"}
              </button>
            ))}
          </div>
          <div className="flex items-center p-0.5 bg-neutral-800/80 border border-neutral-700/60 rounded-xl gap-0.5">
            {([["tv", "TV", shows.length], ["movies", "Movies", movies.length]] as const).map(
              ([key, label, count]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === key
                      ? "bg-neutral-700 text-neutral-100"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {label}
                  <span
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                    className={activeTab === key ? "text-neutral-400" : "text-neutral-600"}
                  >
                    {count}
                  </span>
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="flex flex-col gap-6">
          <HeroSkeleton />
          <GridSkeleton />
        </div>
      )}

      {/* ── Empty: no history ── */}
      {!isLoading && seedCount === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <p className="text-neutral-300 font-medium mb-1">Nothing to go on yet</p>
          <p className="text-neutral-500 text-sm max-w-xs">
            Add some movies or shows to your watched list or watchlist and we'll suggest things you might like.
          </p>
        </div>
      )}

      {/* ── Empty: no results for tab ── */}
      {!isLoading && seedCount > 0 && activeItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-neutral-400 text-sm">
            No {activeTab === "movies" ? "movie" : "TV show"} recommendations found.
          </p>
        </div>
      )}

      {/* ── Hero ── */}
      {!isLoading && heroItem && (
        <div className="mb-5">
          <HeroCard
            item={heroItem}
            contentType={contentType as "movie" | "tv"}
            onAdd={() => handleAdd(heroItem)}
            onAddWatched={() => handleAddWatched(heroItem)}
          />
        </div>
      )}

      {/* ── Grid ── */}
      {!isLoading && gridItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {gridItems.map((item) => (
            <GridCard
              key={item.id}
              item={item}
              contentType={contentType as "movie" | "tv"}
              onAdd={() => handleAdd(item)}
              onAddWatched={() => handleAddWatched(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
