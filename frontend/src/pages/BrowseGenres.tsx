import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useBrowsePage, useGenres } from "../hooks/api/useSearch";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import { useUpdateWatchStatus } from "../hooks/api/useWatchActions";
import { TrackingLimitError } from "../hooks/api/errors";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  BookmarkIcon,
  Button,
  CheckIcon,
  Chip,
  EmptyState,
  IconButton,
  PageHeader,
  PlayIcon,
  PlusIcon,
  PosterCard,
  PosterCardSkeleton,
  SectionHeader,
  Segmented,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type { Movie, Show } from "../types/calendar";
import type { WatchStatus } from "../components/WatchButton";

type MediaType = "movie" | "tv";
type Item = (Movie | Show) & { genre_ids?: number[] };


// A dot per genre, so the chips scan by colour as well as name. Movie and TV
// ids overlap where TMDb shares the genre.
const GENRE_DOTS: Record<number, string> = {
  28: "#f87171", // Action
  12: "#fb923c", // Adventure
  10759: "#fb923c", // Action & Adventure
  16: "#facc15", // Animation
  35: "#a3e635", // Comedy
  80: "#94a3b8", // Crime
  99: "#2dd4bf", // Documentary
  18: "#60a5fa", // Drama
  10751: "#fdba74", // Family
  10762: "#fde047", // Kids
  14: "#c084fc", // Fantasy
  10765: "#a78bfa", // Sci-Fi & Fantasy
  36: "#d6b98c", // History
  27: "#ef4444", // Horror
  10402: "#f472b6", // Music
  9648: "#818cf8", // Mystery
  10763: "#cbd5e1", // News
  10764: "#fbbf24", // Reality
  10749: "#fb7185", // Romance
  10766: "#f9a8d4", // Soap
  878: "#22d3ee", // Science Fiction
  10767: "#5eead4", // Talk
  10770: "#a8a29e", // TV Movie
  53: "#e879f9", // Thriller
  10752: "#84cc16", // War
  10768: "#84cc16", // War & Politics
  37: "#d97706", // Western
};

function titleOf(item: Item): string {
  return "title" in item ? item.title : item.name;
}

function BrowseCard({
  item,
  type,
  status,
  detail,
}: {
  item: Item;
  type: MediaType;
  /** Undefined while signed out or still loading: no buttons. */
  status: WatchStatus | undefined;
  /** "Mystery · ★ 8.1" */
  detail: string;
}) {
  const toast = useToast();
  const update = useUpdateWatchStatus();
  const title = titleOf(item);

  function setStatus(target: WatchStatus) {
    if (!status || update.isPending) return;
    update
      .mutateAsync({ contentType: type, contentId: item.id, currentStatus: status, targetStatus: target })
      .catch((err) =>
        toast.error(
          err instanceof TrackingLimitError
            ? "You've hit the free tracking limit. Upgrade to Premium for unlimited tracking."
            : `Couldn't update ${title}. Try again.`,
        ),
      );
  }

  const onWatchlist = status === "Want To Watch";
  const watched = status === "Watched";

  // Always the same two places: your list on the left, watched on the right.
  const actions = status && (
    <>
      {status === "Currently Watching" ? (
        <span
          role="img"
          aria-label="Currently watching"
          title="Currently watching"
          className="size-touch rounded-full bg-highlight-500 text-neutral-950 flex items-center justify-center"
        >
          <PlayIcon className="w-4 h-4 ml-0.5" />
        </span>
      ) : (
        !watched && (
          <IconButton
            variant="overlay"
            size="touch"
            pressed={onWatchlist}
            label={onWatchlist ? `Remove ${title} from your watchlist` : `Add ${title} to your watchlist`}
            title={onWatchlist ? "On your watchlist · click to remove" : "Add to watchlist"}
            icon={onWatchlist ? <BookmarkIcon filled /> : <PlusIcon />}
            onClick={() => setStatus(onWatchlist ? "none" : "Want To Watch")}
          />
        )
      )}
      <IconButton
        variant="overlay"
        size="touch"
        pressed={watched}
        label={watched ? `Mark ${title} unwatched` : `Mark ${title} watched`}
        title={watched ? "Watched · click to undo" : "Mark watched"}
        icon={<CheckIcon />}
        onClick={() => setStatus(watched ? "none" : "Watched")}
      />
    </>
  );

  return (
    <PosterCard
      to={`/${type}/${item.id}`}
      title={title}
      posterPath={item.poster_path}
      subtitle={detail || undefined}
      actions={actions || undefined}
    />
  );
}

const GRID =
  "grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-posters gap-x-4 gap-y-6";

export default function BrowseGenres() {
  usePageTitle("Browse");
  const user = useAuthUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const type: MediaType = searchParams.get("type") === "tv" ? "tv" : "movie";
  // A page past the end is sent back to the last one, below.
  const page = Math.min(500, Math.max(1, Math.trunc(Number(searchParams.get("page"))) || 1));

  const { data: genreList } = useGenres();
  const genres = genreList?.[type] ?? [];
  // A genre this type doesn't have (an old link, a movie genre on TV) is
  // treated as no genre; until the list loads, the link is trusted.
  const rawGenre = Math.trunc(Number(searchParams.get("genre"))) || null;
  const genreId =
    rawGenre !== null && (!genreList || genres.some((g) => g.id === rawGenre)) ? rawGenre : null;
  const genre = genres.find((g) => g.id === genreId);
  const genreNames = new Map(genres.map((g) => [g.id, g.name]));

  // "All" is TMDb's trending list; a genre is its most popular titles.
  const active = useBrowsePage(type, genreId, page);
  const items = active.items as Item[];
  const totalPages = active.totalPages;

  const { data: statuses } = useBulkWatchStatus(
    items.map((i) => ({ content_type: type, content_id: i.id })),
  );

  // Set by Previous/Next: once the new page renders, focus its heading and,
  // if it's scrolled out of view, scroll it back.
  const resultsTop = useRef<HTMLElement>(null);
  const pagerMove = useRef<{ scroll: boolean } | null>(null);

  function update(
    next: { type?: MediaType; genre?: number | null; page?: number },
    replace = false,
  ) {
    if (next.page === undefined) pagerMove.current = null;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next.type) params.set("type", next.type);
      if (next.genre !== undefined) {
        if (next.genre === null) params.delete("genre");
        else params.set("genre", String(next.genre));
      }
      params.set("page", String(next.page ?? 1));
      return params;
    }, { replace });
  }

  function changeType(next: MediaType) {
    // Keep the genre when the other side has it too (Comedy, Drama, ...).
    const keep =
      genreId !== null && (!genreList || genreList[next].some((g) => g.id === genreId));
    update({ type: next, genre: keep ? genreId : null });
  }

  // Waits for the new page to render: scrolling earlier gets undone by the
  // browser's scroll anchoring when the titles replace the placeholders.
  function goToPage(next: number) {
    const top = resultsTop.current?.getBoundingClientRect().top ?? 0;
    pagerMove.current = { scroll: top < 80 }; // under the nav bar, or above it
    update({ page: next });
  }
  useEffect(() => {
    const move = pagerMove.current;
    if (active.isPending || !move) return;
    pagerMove.current = null;
    if (move.scroll) resultsTop.current?.scrollIntoView({ block: "start" });
    document.getElementById("browse-heading")?.focus({ preventScroll: true });
  }, [active.isPending, page]);

  // A page past the end (an old link): go to the last one.
  useEffect(() => {
    if (!active.isPending && !active.isError && page > totalPages) {
      update({ page: totalPages }, true);
    }
  });

  function detailFor(item: Item): string {
    // The genre you're browsing goes without saying; name another one.
    const ids = item.genre_ids ?? [];
    const other = ids.find((id) => id !== genreId && genreNames.has(id)) ?? ids[0];
    const parts = [genreNames.get(other ?? -1)];
    if (item.vote_average) parts.push(`★ ${item.vote_average.toFixed(1)}`);
    return parts.filter(Boolean).join(" · ");
  }

  const noun = type === "movie" ? "movies" : "TV shows";
  const heading = genre ? `${genre.name} ${noun}` : `Trending ${noun} this week`;
  const note = genre ? "most popular first" : "all genres";

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <PageHeader
        title="Browse"
        description="What's trending, or the most popular titles in a genre."
        actions={
          <Segmented
            label="Type"
            value={type}
            onChange={changeType}
            options={[
              { value: "movie", label: "Movies" },
              { value: "tv", label: "TV shows" },
            ]}
          />
        }
      />

      {/* ── Genres ── */}
      {/* One scrolling row on phones, where wrapped chips would fill the screen. */}
      <div
        role="group"
        aria-label="Genre"
        className="flex flex-wrap gap-2 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:-mx-6 max-sm:px-6 max-sm:py-1 [scrollbar-width:none] *:shrink-0"
      >
        <Chip pressed={genreId === null} onClick={() => update({ genre: null })}>
          All
        </Chip>
        {genres.map((g) => (
          <Chip
            key={g.id}
            dot={GENRE_DOTS[g.id]}
            pressed={g.id === genreId}
            onClick={() => update({ genre: g.id === genreId ? null : g.id })}
          >
            {g.name}
          </Chip>
        ))}
      </div>

      {/* ── Results ── */}
      <section ref={resultsTop} aria-labelledby="browse-heading" className="scroll-mt-20">
        <SectionHeader id="browse-heading" title={heading} note={note} divider className="mb-4" />
        <p className="sr-only" aria-live="polite">
          {active.isPending ? "Loading" : `Page ${page} of ${totalPages}`}
        </p>

        {active.isPending ? (
          <div className={GRID} aria-hidden="true">
            {Array.from({ length: 36 }).map((_, i) => (
              <PosterCardSkeleton key={i} />
            ))}
          </div>
        ) : active.isError ? (
          <EmptyState
            title="Couldn't load these titles"
            description="TMDb didn't answer. It's usually back in a moment."
            action={<Button onClick={() => active.refetch()}>Try again</Button>}
          />
        ) : items.length === 0 ? (
          <EmptyState title="Nothing here yet" description="Try another genre." />
        ) : (
          <div className={GRID}>
            {items.map((item) => (
              <BrowseCard
                key={item.id}
                item={item}
                type={type}
                status={user ? statuses?.[`${type}:${item.id}`]?.status : undefined}
                detail={detailFor(item)}
              />
            ))}
          </div>
        )}

        {(totalPages > 1 || page > 1) && (
          <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-3">
            <Button onClick={() => goToPage(page - 1)} disabled={page <= 1}>
              Previous
            </Button>
            <span className="tabular text-label text-neutral-300">
              Page {page} of {totalPages}
            </span>
            <Button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages || active.isError}
            >
              Next
            </Button>
          </nav>
        )}
      </section>
    </div>
  );
}
