import { Link, useSearchParams } from "react-router-dom";
import type { Movie, Show } from "../types/calendar";
import { usePageTitle } from "../hooks/usePageTitle";
import { useUpcoming } from "../hooks/api/useSearch";
import { BASE_IMAGE_URL } from "../constants";
import { toLocalISODate } from "../utils/date";
import {
  ButtonLink,
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  PageHeader,
  SectionHeader,
  Segmented,
  focusRing,
  cx,
} from "../components/ui";

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

function BackdropCard({
  item,
  type,
}: {
  item: Movie | Show;
  type: MediaType;
}) {
  const title = getTitle(item);
  const genre = item.genres?.[0]?.name ?? "";
  const releaseDate = getFormattedDate(item);

  return (
    <Link
      to={`/${type === "movie" ? "movie" : "tv"}/${item.id}`}
      className={cx(
        "w-[280px] flex-shrink-0 bg-neutral-900 border border-neutral-800 rounded-surface overflow-hidden group",
        focusRing,
      )}
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
            <span className="text-neutral-500 text-caption">{title}</span>
          </div>
        )}
        <div className="absolute top-2.5 left-2.5 text-caption bg-black/60 text-white px-2 py-1 rounded-md">
          {type === "movie" ? "Film" : "Series"}
        </div>
      </div>
      <div className="p-3.5">
        <div className="text-body font-semibold text-neutral-100 leading-tight truncate group-hover:text-primary-300 transition-colors">
          {title}
        </div>
        <div className="text-caption text-neutral-400 mt-1">
          {genre && releaseDate ? `${genre} · ${releaseDate}` : genre || releaseDate}
        </div>
      </div>
    </Link>
  );
}

export default function Upcoming() {
  usePageTitle("Upcoming");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = (searchParams.get("type") as MediaType) ?? "movie";
  const page = Number(searchParams.get("page") ?? "1");

  const today = new Date();
  const minDate = toLocalISODate(today);
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const maxDate = toLocalISODate(nextMonth);

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
  const heroBackdrop = hero?.backdrop_path
    ? `${BASE_IMAGE_URL}/w1280${hero.backdrop_path}`
    : null;
  const heroDate = hero ? getFormattedDate(hero) : "";

  return (
    <div className="w-full px-6 sm:px-10 pt-8 pb-16">
      <PageHeader title="Upcoming" description={formatDateRange()} className="mb-6" />

      {/* Hero */}
      {loading ? (
        <div className="rounded-surface bg-neutral-800 animate-pulse" style={{ height: 420 }} />
      ) : hero ? (
        <div className="relative rounded-surface overflow-hidden" style={{ height: 420 }}>
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
            <h2 className="text-display font-semibold leading-tight tracking-tight">{heroTitle}</h2>
            {heroDate && (
              <p className="text-body text-white/80 mt-4 leading-relaxed">
                Releases {heroDate}
              </p>
            )}
            <div className="flex items-center gap-3 mt-5">
              <ButtonLink variant="primary" to={`/${activeType === "movie" ? "movie" : "tv"}/${hero.id}`}>
                More info
                <ChevronRightIcon />
              </ButtonLink>
            </div>
          </div>
        </div>
      ) : null}

      {/* Upcoming row */}
      <div className="mt-8">
        <SectionHeader
          title="Coming soon"
          className="mb-5"
          action={
            <Segmented
              label="Type"
              value={activeType}
              onChange={setType}
              options={[
                { value: "movie", label: "Movies" },
                { value: "tv", label: "TV" },
              ]}
            />
          }
        />

        {loading ? (
          <div className="flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="w-[280px] flex-shrink-0 animate-pulse bg-neutral-900 rounded-surface overflow-hidden border border-neutral-800"
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
          <EmptyState title="Nothing coming up" description="No releases found for the next 30 days." />
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
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-10">
          <Button
            icon={<ChevronLeftIcon />}
            onClick={() =>
              setSearchParams({ type: activeType, page: String(Math.max(1, page - 1)) })
            }
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="tabular text-label text-neutral-300">
            Page {page} of {totalPages}
          </span>
          <Button
            onClick={() =>
              setSearchParams({
                type: activeType,
                page: String(Math.min(totalPages, page + 1)),
              })
            }
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
