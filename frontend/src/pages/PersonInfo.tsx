import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { formatLocalDate, parseLocalDate } from "../utils/date";
import { safeHref } from "../utils/safeHref";
import { usePageTitle } from "../hooks/usePageTitle";
import { usePersonInfo } from "../hooks/api/usePersonInfo";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import { useAuthUser } from "../hooks/useAuthUser";
import type { WatchStatus } from "../components/WatchButton";
import {
  BookmarkIcon,
  Button,
  Card,
  CheckIcon,
  EmptyState,
  PageState,
  PageHeader,
  PlayIcon,
  PosterCard,
  SectionHeader,
  Segmented,
  buttonClass,
  selectClass,
} from "../components/ui";

type MediaType = "movie" | "tv";

// A cast or crew credit as TMDb returns it.
type RawCredit = {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  first_credit_air_date?: string;
  character?: string;
  job?: string;
  department?: string;
  popularity?: number;
  vote_count?: number;
  order?: number;
  episode_count?: number;
  genre_ids?: number[];
};

type RawCredits = { cast?: RawCredit[]; crew?: RawCredit[] };

type FullPersonData = {
  id: number;
  name: string;
  profile_path: string | null;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  known_for_department: string;
  external_ids: {
    imdb_id: string | null;
    facebook_id: string | null;
    instagram_id: string | null;
    twitter_id: string | null;
    wikidata_id: string | null;
  };
  movie_credits: RawCredits;
  tv_credits: RawCredits;
};

// One title in the filmography, with every credit the person has on it merged.
type Credit = {
  id: number;
  type: MediaType;
  title: string;
  poster: string | null;
  date: string; // "" when TMDb has none
  role: string;
  popularity: number;
  knownFor: number;
};

type SeenFilter = "all" | "seen" | "unseen";
type SortType = "newest" | "popular";

const FILMOGRAPHY_LIMIT = 40;
// The status endpoint takes at most this many titles per request.
const BULK_STATUS_MAX = 500;

const TALK_GENRES = [10767, 10763]; // Talk, News
const AS_SELF = /^(self|himself|herself|themselves)\b/i;

// How strongly a credit stands for the person: how widely the title is known,
// weighted by how big their part in it was. Zero keeps it out of "Known for".
function knownForScore(c: RawCredit, type: MediaType, isCast: boolean, department: string): number {
  const votes = c.vote_count ?? 0;
  // A guest spot counts for less than a regular role.
  const share = type === "tv" ? Math.min(1, (c.episode_count ?? 1) / 10) : 1;
  if (department === "Acting") {
    if (!isCast) return 0;
    if (AS_SELF.test(c.character ?? "")) return 0;
    if (c.genre_ids?.some((g) => TALK_GENRES.includes(g))) return 0;
    const billing = type === "movie" ? 1 + (c.order ?? 8) / 4 : 1;
    return (votes * share) / billing;
  }
  return !isCast && c.department === department ? votes * share : 0;
}

function mergeCredits(raw: RawCredits | undefined, type: MediaType, department: string): Credit[] {
  const byId = new Map<number, Credit & { characters: string[]; jobs: string[] }>();
  const add = (c: RawCredit, isCast: boolean) => {
    let entry = byId.get(c.id);
    if (!entry) {
      entry = {
        id: c.id,
        type,
        title: c.title ?? c.name ?? "Untitled",
        poster: c.poster_path,
        date: c.release_date || c.first_credit_air_date || c.first_air_date || "",
        role: "",
        popularity: c.popularity ?? 0,
        knownFor: 0,
        characters: [],
        jobs: [],
      };
      byId.set(c.id, entry);
    }
    const label = isCast ? c.character : c.job;
    const labels = isCast ? entry.characters : entry.jobs;
    if (label && !labels.includes(label)) {
      // Jobs in the person's own department lead, so a director reads "Director, Writer".
      if (!isCast && c.department === department) labels.unshift(label);
      else labels.push(label);
    }
    entry.knownFor = Math.max(entry.knownFor, knownForScore(c, type, isCast, department));
  };
  raw?.cast?.forEach((c) => add(c, true));
  // A "Thanks" credit isn't work on the title, so it stays out of the filmography.
  raw?.crew?.filter((c) => c.job !== "Thanks").forEach((c) => add(c, false));
  return [...byId.values()].map(({ characters, jobs, ...credit }) => {
    // Actors are listed by character, everyone else by job.
    const [first, second] = department === "Acting" ? [characters, jobs] : [jobs, characters];
    return { ...credit, role: (first.length > 0 ? first : second).slice(0, 2).join(", ") };
  });
}

function yearsBetween(from: string, to: Date): number {
  const start = parseLocalDate(from);
  let years = to.getFullYear() - start.getFullYear();
  if (
    to.getMonth() < start.getMonth() ||
    (to.getMonth() === start.getMonth() && to.getDate() < start.getDate())
  ) {
    years--;
  }
  return years;
}

const LONG_DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={safeHref(href)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
      {label}
    </a>
  );
}

const STATUS_BADGES: Partial<Record<WatchStatus, { label: string; className: string; icon: ReactNode }>> = {
  Watched: {
    label: "Seen",
    className: "bg-primary-500 text-primary-950",
    icon: <CheckIcon className="w-4 h-4" />,
  },
  "Want To Watch": {
    label: "On your watchlist",
    className: "bg-neutral-950 text-primary-400 border border-primary-400",
    icon: <BookmarkIcon filled className="w-3.5 h-3.5" />,
  },
  "Currently Watching": {
    label: "Watching",
    className: "bg-neutral-950 text-primary-400 border border-primary-400",
    icon: <PlayIcon className="w-3.5 h-3.5" />,
  },
};

function StatusBadge({ status }: { status: WatchStatus }) {
  const badge = STATUS_BADGES[status];
  if (!badge) return null;
  return (
    <span
      title={badge.label}
      className={`w-6 h-6 rounded-full flex items-center justify-center shadow-md shadow-black/40 ${badge.className}`}
    >
      {badge.icon}
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

function CreditCard({
  credit,
  status,
  sub,
  className,
}: {
  credit: Credit;
  status: WatchStatus;
  sub: string;
  className?: string;
}) {
  const card = (
    <PosterCard
      to={`/${credit.type}/${credit.id}`}
      title={credit.title}
      posterPath={credit.poster}
      subtitle={sub || undefined}
      corner={<StatusBadge status={status} />}
    />
  );
  return className ? <div className={className}>{card}</div> : card;
}

function PersonPage({ person }: { person: FullPersonData }) {
  const user = useAuthUser();
  const department = person.known_for_department ?? "";

  const movies = useMemo(() => mergeCredits(person.movie_credits, "movie", department), [person, department]);
  const shows = useMemo(() => mergeCredits(person.tv_credits, "tv", department), [person, department]);

  const knownFor = useMemo(
    () =>
      [...movies, ...shows]
        .filter((c) => c.knownFor > 0)
        .sort((a, b) => b.knownFor - a.knownFor)
        .slice(0, 8),
    [movies, shows],
  );

  // Open on whichever type the person is better known for.
  const [tab, setTab] = useState<MediaType>(() => {
    if (movies.length === 0) return "tv";
    if (shows.length === 0) return "movie";
    return knownFor.filter((c) => c.type === "tv").length > knownFor.length / 2 ? "tv" : "movie";
  });
  const [filter, setFilter] = useState<SeenFilter>("all");
  const [sort, setSort] = useState<SortType>("newest");
  const [showAll, setShowAll] = useState(false);

  const movieItems = useMemo(
    () => movies.slice(0, BULK_STATUS_MAX).map((c) => ({ content_type: "movie", content_id: c.id })),
    [movies],
  );
  const showItems = useMemo(
    () => shows.slice(0, BULK_STATUS_MAX).map((c) => ({ content_type: "tv", content_id: c.id })),
    [shows],
  );
  const movieStatuses = useBulkWatchStatus(movieItems);
  const showStatuses = useBulkWatchStatus(showItems);
  const statusReady =
    (movieItems.length === 0 || movieStatuses.data !== undefined) &&
    (showItems.length === 0 || showStatuses.data !== undefined);
  const statusOf = (c: Credit): WatchStatus =>
    (c.type === "movie" ? movieStatuses.data : showStatuses.data)?.[`${c.type}:${c.id}`]?.status ?? "none";

  const total = movies.length + shows.length;
  const tally = { seen: 0, watching: 0, watchlist: 0 };
  for (const c of [...movies, ...shows]) {
    const status = statusOf(c);
    if (status === "Watched") tally.seen++;
    else if (status === "Currently Watching") tally.watching++;
    else if (status === "Want To Watch") tally.watchlist++;
  }

  const credits = tab === "movie" ? movies : shows;
  const visible = credits
    .filter((c) => {
      if (!user || filter === "all") return true;
      return (statusOf(c) === "Watched") === (filter === "seen");
    })
    .sort((a, b) =>
      sort === "popular"
        ? b.popularity - a.popularity
        : // Newest first; titles with no date go last.
          (b.date || "0").localeCompare(a.date || "0"),
    );
  const displayed = showAll ? visible : visible.slice(0, FILMOGRAPHY_LIMIT);

  // "Read more" only appears when the clamped biography is actually cut off.
  const bioRef = useRef<HTMLParagraphElement>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [bioOverflows, setBioOverflows] = useState(false);
  useEffect(() => {
    const el = bioRef.current;
    if (!el || bioExpanded) return;
    const observer = new ResizeObserver(() => setBioOverflows(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [bioExpanded]);

  const ids = person.external_ids;
  const links = ids
    ? [
        ids.imdb_id && { label: "IMDb", href: `https://www.imdb.com/name/${ids.imdb_id}` },
        ids.instagram_id && { label: "Instagram", href: `https://www.instagram.com/${ids.instagram_id}` },
        ids.twitter_id && { label: "Twitter / X", href: `https://twitter.com/${ids.twitter_id}` },
        ids.facebook_id && { label: "Facebook", href: `https://www.facebook.com/${ids.facebook_id}` },
        ids.wikidata_id && { label: "Wikidata", href: `https://www.wikidata.org/wiki/${ids.wikidata_id}` },
      ].filter((l): l is { label: string; href: string } => !!l)
    : [];

  const creditCounts = [
    movies.length > 0 && `${movies.length} ${movies.length === 1 ? "movie" : "movies"}`,
    shows.length > 0 && `${shows.length} ${shows.length === 1 ? "show" : "shows"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const typeNoun = tab === "movie" ? "movies" : "shows";
  const emptyMessage =
    filter === "seen" && user
      ? `You haven't marked any of these ${typeNoun} as watched.`
      : filter === "unseen" && user
        ? `You've seen every one of these ${typeNoun}.`
        : `No ${typeNoun} listed.`;

  return (
    <div className="pb-16 w-full">
      {/* Phones: photo beside the name, then everything in one column. lg: side panel + main. */}
      <div className="mx-auto max-w-[1920px] px-6 sm:px-10 pt-6 grid grid-cols-[6rem_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] gap-x-4 lg:gap-x-10 gap-y-6 items-start">
        {/* Side panel. Below lg its parts sit straight on the page grid. */}
        <div className="contents lg:flex lg:flex-col lg:gap-5 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:min-w-0 lg:[@media(min-height:800px)]:sticky lg:[@media(min-height:800px)]:top-20">
          {person.profile_path ? (
            <img
              src={`${BASE_IMAGE_URL}/h632${person.profile_path}`}
              srcSet={`${BASE_IMAGE_URL}/w185${person.profile_path} 185w, ${BASE_IMAGE_URL}/h632${person.profile_path} 421w`}
              sizes="(min-width: 1024px) 280px, 96px"
              alt={`Photo of ${person.name}`}
              className="col-start-1 row-start-1 w-full aspect-[2/3] object-cover rounded-surface shadow-2xl border border-white/10"
            />
          ) : (
            <div aria-hidden="true" className="col-start-1 row-start-1 w-full aspect-[2/3] rounded-surface bg-neutral-800 border border-white/10" />
          )}

          <div className="col-span-2 pt-4 border-t border-neutral-800">
            <SectionHeader title="Key facts" className="mb-3" />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              {department && (
                <>
                  <dt className="text-neutral-400">Known for</dt>
                  <dd className="text-neutral-100">{department}</dd>
                </>
              )}
              {person.birthday && (
                <>
                  <dt className="text-neutral-400">Born</dt>
                  <dd className="text-neutral-100">
                    {formatLocalDate(person.birthday, LONG_DATE)}
                    {!person.deathday && ` (age ${yearsBetween(person.birthday, new Date())})`}
                  </dd>
                </>
              )}
              {person.deathday && (
                <>
                  <dt className="text-neutral-400">Died</dt>
                  <dd className="text-neutral-100">
                    {formatLocalDate(person.deathday, LONG_DATE)}
                    {person.birthday &&
                      ` (aged ${yearsBetween(person.birthday, parseLocalDate(person.deathday))})`}
                  </dd>
                </>
              )}
              {person.place_of_birth && (
                <>
                  <dt className="text-neutral-400">From</dt>
                  <dd className="text-neutral-100">{person.place_of_birth}</dd>
                </>
              )}
              {creditCounts && (
                <>
                  <dt className="text-neutral-400">Credits</dt>
                  <dd className="text-neutral-100">{creditCounts}</dd>
                </>
              )}
            </dl>
          </div>

          {links.length > 0 && (
            <div className="col-span-2 flex flex-wrap gap-2">
              {links.map((l) => (
                <ExternalLink key={l.label} href={l.href} label={l.label} />
              ))}
            </div>
          )}
        </div>

        <PageHeader title={person.name} className="col-start-2 row-start-1 self-center lg:self-start min-w-0" />

        <div className="@container col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-2 min-w-0 flex flex-col gap-10">
          {user && total > 0 && (
            <Card
              as="section"
              aria-label={`Your history with ${person.name}`}
              padding="md"
            >
              <div className="text-caption text-neutral-400">Your history</div>
              <p className="mt-2 mb-3.5 text-title text-neutral-100">
                {!statusReady ? (
                  "Checking your lists…"
                ) : tally.seen === 0 ? (
                  <>You haven't seen any of {person.name}'s {total} titles yet.</>
                ) : (
                  <>
                    You've seen <strong className="font-semibold">{tally.seen}</strong> of {person.name}'s {total}{" "}
                    titles.
                  </>
                )}
              </p>
              <div
                role="img"
                aria-label={`${tally.seen} seen, ${tally.watching + tally.watchlist} watching or on your watchlist, out of ${total}`}
                className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-neutral-800"
              >
                {tally.seen > 0 && (
                  <div className="bg-primary-500" style={{ width: `${(tally.seen / total) * 100}%` }} />
                )}
                {tally.watching + tally.watchlist > 0 && (
                  <div
                    className="bg-primary-200"
                    style={{ width: `${((tally.watching + tally.watchlist) / total) * 100}%` }}
                  />
                )}
              </div>
              {statusReady && (
                <p className="tabular mt-3 text-label text-neutral-400">
                  {[
                    `${tally.seen} seen`,
                    tally.watching > 0 && `${tally.watching} watching`,
                    `${tally.watchlist} on watchlist`,
                    `${total - tally.seen} not seen`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </Card>
          )}

          {person.biography && (
            <section aria-label="Biography" className="max-w-[75ch]">
              <p
                ref={bioRef}
                className={`text-body sm:text-title leading-relaxed text-neutral-300 whitespace-pre-line ${
                  bioExpanded ? "" : "line-clamp-5"
                }`}
              >
                {person.biography}
              </p>
              {bioOverflows && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={bioExpanded}
                  onClick={() => setBioExpanded(!bioExpanded)}
                  className="mt-2 -ml-3"
                >
                  {bioExpanded ? "Show less" : "Read more"}
                </Button>
              )}
            </section>
          )}

          {knownFor.length > 0 && (
            <section aria-label="Known for">
              <SectionHeader title="Known for" divider className="mb-4" />
              <div className="grid grid-cols-3 @md:grid-cols-4 @2xl:grid-cols-6 @4xl:grid-cols-8 gap-x-4 gap-y-6">
                {knownFor.map((c, i) => (
                  <CreditCard
                    key={`${c.type}:${c.id}`}
                    credit={c}
                    status={statusOf(c)}
                    sub={c.role}
                    // Three and six across show six, so the rows stay full.
                    className={i >= 6 ? "hidden @md:block @2xl:hidden @4xl:block" : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          {total > 0 && (
            <section aria-label="Filmography">
              <SectionHeader
                title="Filmography"
                divider
                className="mb-4"
                action={
                  <div className="flex flex-wrap items-center gap-3">
                    {movies.length > 0 && shows.length > 0 && (
                      <Segmented
                        label="Type"
                        value={tab}
                        onChange={(t) => {
                          setTab(t);
                          setShowAll(false);
                        }}
                        options={[
                          { value: "movie", label: <>Movies <span className="ml-1 tabular opacity-70">{movies.length}</span></> },
                          { value: "tv", label: <>TV shows <span className="ml-1 tabular opacity-70">{shows.length}</span></> },
                        ]}
                      />
                    )}
                    {user && (
                      <Segmented
                        label="Show"
                        value={filter}
                        onChange={setFilter}
                        options={[
                          { value: "all", label: "All" },
                          { value: "seen", label: "Seen" },
                          { value: "unseen", label: "Not seen" },
                        ]}
                      />
                    )}
                    <select
                      aria-label="Sort"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortType)}
                      className={selectClass}
                    >
                      <option value="newest">Newest first</option>
                      <option value="popular">Most popular</option>
                    </select>
                  </div>
                }
              />

              {visible.length === 0 ? (
                <EmptyState title={emptyMessage} className="py-10" />
              ) : (
                <div className="grid grid-cols-3 @md:grid-cols-4 @2xl:grid-cols-6 @4xl:grid-cols-8 @6xl:grid-cols-10 gap-x-4 gap-y-6">
                  {displayed.map((c) => (
                    <CreditCard
                      key={c.id}
                      credit={c}
                      status={statusOf(c)}
                      sub={[c.date.slice(0, 4), c.role].filter(Boolean).join(" · ")}
                    />
                  ))}
                </div>
              )}

              {visible.length > FILMOGRAPHY_LIMIT && (
                <Button className="mt-6" onClick={() => setShowAll(!showAll)}>
                  {showAll ? "Show fewer" : `Show ${visible.length - FILMOGRAPHY_LIMIT} more`}
                </Button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PersonInfo() {
  const { id } = useParams<{ id: string }>();
  const {
    data: person,
    isPending: loading,
    error,
    refetch,
  } = usePersonInfo<FullPersonData>(id);
  usePageTitle(person?.name);

  if (loading) return <PageState status="loading" label="Loading…" />;
  if (error || !person)
    return (
      <PageState
        status="error"
        error={error}
        subject="person"
        back={{ to: "/search", label: "Search" }}
        onRetry={() => refetch()}
      />
    );

  // Keyed so the tab, filter and expanded sections reset when moving to another person.
  return <PersonPage key={person.id} person={person} />;
}
