import { useRef, useState, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Movie, Show } from "../../types/calendar";
import { useTrendingMulti } from "../../hooks/api/useSearch";
import { BASE_IMAGE_URL } from "../../constants";

type AnyItem = Movie | Show;
type TypedItem = AnyItem & { _type: "movie" | "tv" };
type ContentFilter = "all" | "movie" | "tv";

const FILTER_OPTS: { id: ContentFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "tv", label: "TV" },
];

function getTitle(item: AnyItem) {
  return "title" in item ? item.title : item.name;
}

export default function TrendingSection() {
  const navigate = useNavigate();
  const { data, isPending: loading } = useTrendingMulti();
  const [filter, setFilter] = useState<ContentFilter>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const syncState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    if (!loading) requestAnimationFrame(syncState);
  }, [loading, syncState]);

  useEffect(() => {
    requestAnimationFrame(syncState);
  }, [filter, syncState]);

  function scrollBy(dir: "left" | "right") {
    scrollRef.current?.scrollBy({ left: dir === "right" ? 600 : -600, behavior: "smooth" });
  }

  const movies = data?.movies ?? [];
  const shows = data?.shows ?? [];

  const items: TypedItem[] = [];
  const maxLen = Math.max(movies.length, shows.length);
  for (let i = 0; i < maxLen; i++) {
    if (movies[i]) items.push({ ...movies[i], _type: "movie" });
    if (shows[i]) items.push({ ...shows[i], _type: "tv" });
  }

  const filtered = filter === "all" ? items : items.filter((i) => i._type === filter);

  return (
    <div>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <h2 className="text-2xl font-bold text-white">Trending</h2>
        <span className="text-lg">🔥</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 p-0.5 bg-neutral-800/70 rounded-lg border border-neutral-700/50">
          {FILTER_OPTS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === opt.id
                  ? "bg-neutral-700 text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Link
          to="/trending"
          className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
        >
          See all →
        </Link>
      </div>

      <div
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          className={`absolute left-0 inset-y-0 mb-2 z-10 flex items-center pl-1 bg-gradient-to-r from-neutral-950/90 to-transparent transition-opacity duration-200 ${
            hovered && canLeft ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <button
            onClick={() => scrollBy("left")}
            className="w-9 h-9 rounded-full bg-neutral-800/90 border border-neutral-700 flex items-center justify-center text-neutral-200 hover:bg-neutral-700 transition-colors shadow-lg"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div
          className={`absolute right-0 inset-y-0 mb-2 z-10 flex items-center pr-1 bg-gradient-to-l from-neutral-950/90 to-transparent transition-opacity duration-200 ${
            hovered && canRight ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <button
            onClick={() => scrollBy("right")}
            className="w-9 h-9 rounded-full bg-neutral-800/90 border border-neutral-700 flex items-center justify-center text-neutral-200 hover:bg-neutral-700 transition-colors shadow-lg"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-2"
          style={{ scrollbarWidth: "none" }}
          onScroll={syncState}
        >
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                  <div className="aspect-[2/3] rounded-xl bg-neutral-800" />
                  <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                  <div className="h-2.5 bg-neutral-800 rounded mt-1.5 w-1/2" />
                </div>
              ))
            : filtered.map((item) => {
                const title = getTitle(item);
                const genre = item.genres?.[0]?.name ?? "";
                const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
                return (
                  <div
                    key={`${item._type}-${item.id}`}
                    className="w-[180px] flex-shrink-0 cursor-pointer group"
                    onClick={() => navigate(`/${item._type}/${item.id}`)}
                  >
                    <div className="aspect-[2/3] rounded-xl overflow-hidden bg-neutral-800">
                      {item.poster_path ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w342${item.poster_path}`}
                          alt={title}
                          className="w-full h-full object-cover transition-opacity duration-200 group-hover:opacity-80"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center p-3 text-center">
                          <span className="text-neutral-600 text-xs leading-tight">{title}</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 text-[13.5px] font-semibold text-neutral-100 tracking-tight leading-tight truncate">
                      {title}
                    </div>
                    <div className="text-[11.5px] text-neutral-500 mt-0.5">
                      {[genre, rating ? `★ ${rating}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}
