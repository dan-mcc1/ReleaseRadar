import { useNavigate, useSearchParams } from "react-router-dom";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { useUpcoming } from "../hooks/api/useSearch";
import { BASE_IMAGE_URL } from "../constants";

type MediaType = "movie" | "tv";

function getTitle(item: Movie | Show) {
  return "title" in item ? item.title : item.name;
}

function getFormattedDate(item: Movie | Show): string {
  const raw = "release_date" in item ? item.release_date : item.first_air_date;
  if (!raw) return "";
  const d = new Date(raw + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function splitHeroTitle(title: string) {
  const words = title.trim().split(" ");
  if (words.length === 1) return { prefix: "", italic: title };
  return { prefix: words.slice(0, -1).join(" "), italic: words[words.length - 1] };
}

function BackdropCard({
  item,
  type,
  onClick,
}: {
  item: Movie | Show;
  type: MediaType;
  onClick: () => void;
}) {
  const title = getTitle(item);
  const genre = item.genres?.[0]?.name ?? "";
  const releaseDate = getFormattedDate(item);

  return (
    <div
      className="w-[280px] flex-shrink-0 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden cursor-pointer group"
      onClick={onClick}
    >
      <div className="relative" style={{ aspectRatio: "16/9" }}>
        {item.backdrop_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w500${item.backdrop_path}`}
            alt={title}
            className="w-full h-full object-cover transition-opacity duration-200 group-hover:opacity-80"
          />
        ) : (
          <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
            <span className="text-neutral-600 text-xs">{title}</span>
          </div>
        )}
        <div className="absolute top-2.5 left-2.5 font-mono text-[10px] tracking-[0.1em] bg-black/50 text-white px-2 py-1 rounded-md uppercase">
          {type === "movie" ? "Film" : "Series"}
        </div>
      </div>
      <div className="p-3.5">
        <div className="text-[14px] font-semibold text-neutral-100 tracking-tight leading-tight truncate">
          {title}
        </div>
        <div className="text-[12px] text-neutral-500 mt-1">
          {genre && releaseDate ? `${genre} · ${releaseDate}` : genre || releaseDate}
        </div>
      </div>
    </div>
  );
}

export default function Upcoming() {
  usePageTitle("Upcoming");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = (searchParams.get("type") as MediaType) ?? "movie";
  const page = Number(searchParams.get("page") ?? "1");

  const today = new Date();
  const minDate = today.toISOString().split("T")[0];
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const maxDate = nextMonth.toISOString().split("T")[0];

  const formatDateRange = () => {
    const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
    return `${today.toLocaleDateString("en-US", opts)} – ${nextMonth.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
  };

  const { data, isPending: loading } = useUpcoming(activeType, page, minDate, maxDate);
  const items = data?.results ?? [];
  const totalPages = data?.total_pages ?? 1;
  const hero = items[0] ?? null;
  const rowItems = items.slice(1);

  function setType(t: MediaType) {
    setSearchParams({ type: t, page: "1" });
  }

  const heroTitle = hero ? getTitle(hero) : "";
  const { prefix, italic } = splitHeroTitle(heroTitle);
  const heroBackdrop = hero?.backdrop_path
    ? `${BASE_IMAGE_URL}/w1280${hero.backdrop_path}`
    : null;
  const heroGenre = hero?.genres?.[0]?.name ?? "";
  const heroDate = hero ? getFormattedDate(hero) : "";

  return (
    <div className="w-full px-6 sm:px-10 pt-8 pb-16">
      {/* Hero */}
      {loading ? (
        <div className="rounded-2xl bg-neutral-800 animate-pulse" style={{ height: 420 }} />
      ) : hero ? (
        <div className="relative rounded-2xl overflow-hidden" style={{ height: 420 }}>
          {heroBackdrop ? (
            <img
              src={heroBackdrop}
              alt={heroTitle}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-neutral-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
          <div
            className="absolute inset-y-0 left-10 flex flex-col justify-center text-white"
            style={{ maxWidth: 540 }}
          >
            <p className="font-mono text-[11px] tracking-[0.15em] uppercase text-white/75 mb-3.5">
              Spotlight · Coming soon
              {heroGenre ? ` · ${heroGenre}` : ""}
            </p>
            <h2
              className="font-normal leading-[0.95] tracking-tight"
              style={{ fontFamily: "var(--font-serif)", fontSize: 52 }}
            >
              {prefix && <>{prefix} </>}
              <em className="italic">{italic}</em>
            </h2>
            {heroDate && (
              <p className="text-[14px] text-white/80 mt-4 leading-relaxed">
                Releases {heroDate}
              </p>
            )}
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() =>
                  navigate(`/${activeType === "movie" ? "movie" : "tv"}/${hero.id}`)
                }
                className="bg-primary-500 hover:bg-primary-400 text-neutral-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                More info →
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Upcoming row */}
      <div className="mt-8">
        <div className="flex items-baseline gap-4 mb-5 flex-wrap">
          <span className="font-mono text-[11px] text-neutral-600 tracking-[0.1em]">01</span>
          <h2
            className="font-normal tracking-tight"
            style={{ fontFamily: "var(--font-serif)", fontSize: 28 }}
          >
            Coming soon
          </h2>
          <span className="text-[13px] text-neutral-500">{formatDateRange()}</span>
          <span className="flex-1" />
          <div className="flex items-center gap-1 p-0.5 bg-neutral-800 rounded-lg">
            {(["movie", "tv"] as MediaType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeType === t
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {t === "movie" ? "Movies" : "TV"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="w-[280px] flex-shrink-0 animate-pulse bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800"
              >
                <div className="bg-neutral-800" style={{ aspectRatio: "16/9" }} />
                <div className="p-3.5 space-y-2">
                  <div className="h-3.5 bg-neutral-800 rounded w-3/4" />
                  <div className="h-3 bg-neutral-800 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
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
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="text-neutral-300 font-medium mb-1">Nothing coming up</h3>
            <p className="text-neutral-500 text-sm">No releases found for the next 30 days</p>
          </div>
        ) : (
          <div
            className="flex gap-4 overflow-x-auto pb-2"
            style={{ scrollbarWidth: "thin", scrollbarColor: "#404040 transparent" }}
          >
            {rowItems.map((item) => (
              <BackdropCard
                key={item.id}
                item={item}
                type={activeType}
                onClick={() =>
                  navigate(`/${activeType === "movie" ? "movie" : "tv"}/${item.id}`)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-10">
          <button
            onClick={() =>
              setSearchParams({ type: activeType, page: String(Math.max(1, page - 1)) })
            }
            disabled={page === 1}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span className="font-mono text-[12px] text-neutral-500 tracking-wide">
            {page} / {totalPages}
          </span>
          <button
            onClick={() =>
              setSearchParams({
                type: activeType,
                page: String(Math.min(totalPages, page + 1)),
              })
            }
            disabled={page === totalPages}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
