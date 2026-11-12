import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, IconButton, PosterCardSkeleton } from "../ui";

interface Props {
  /** Names the rail for screen readers, e.g. "Trending titles". */
  label: string;
  loading: boolean;
  /** PosterCards; each is given a fixed width by the rail. */
  children: ReactNode;
  /** Re-checks the scroll buttons when the content changes (e.g. a filter). */
  contentKey?: string;
}

/** A row of posters that scrolls sideways, with previous/next buttons on hover. */
export default function PosterRail({ label, loading, children, contentKey }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    if (!loading) requestAnimationFrame(sync);
  }, [loading, contentKey, sync]);

  function scroll(dir: 1 | -1) {
    const el = scrollRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  const edge =
    "absolute inset-y-0 z-10 flex items-center opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100 focus-within:opacity-100 pointer-coarse:hidden";

  return (
    <div className="group/rail relative">
      {canLeft && (
        <div className={`${edge} left-0 pl-1 pr-6 bg-gradient-to-r from-neutral-950/90 to-transparent`}>
          <IconButton
            label={`Scroll ${label} back`}
            icon={<ChevronLeftIcon />}
            variant="overlay"
            onClick={() => scroll(-1)}
          />
        </div>
      )}
      {canRight && (
        <div className={`${edge} right-0 pr-1 pl-6 bg-gradient-to-l from-neutral-950/90 to-transparent`}>
          <IconButton
            label={`Scroll ${label} forward`}
            icon={<ChevronRightIcon />}
            variant="overlay"
            onClick={() => scroll(1)}
          />
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] *:w-40 sm:*:w-44 *:flex-none"
        onScroll={sync}
      >
        {loading ? Array.from({ length: 8 }).map((_, i) => <PosterCardSkeleton key={i} />) : children}
      </div>
    </div>
  );
}
