import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../../constants";
import { cx, focusRing } from "./styles";

export interface PosterCardProps {
  /** Where the poster and the title lead: "/movie/27205". */
  to: string;
  title: string;
  posterPath: string | null | undefined;
  /** TMDb image width; w342 suits grid cards. */
  posterSize?: "w185" | "w342" | "w500";
  /** One quiet line under the title: "Mystery · 8.1", "2024". */
  subtitle?: ReactNode;
  /** A row under the subtitle for richer content, e.g. a rating control. */
  footer?: ReactNode;
  /** Buttons laid over the poster's bottom-right corner (IconButton
   *  variant="overlay" size="touch"). Always in that corner, whatever the
   *  item's state, so they never move under the pointer. */
  actions?: ReactNode;
  /** Something laid over the top-left corner, e.g. a remove button. */
  corner?: ReactNode;
  className?: string;
}

/**
 * A title in a poster grid. The poster and the title are both links to the
 * same page; only the title is in the tab order.
 */
export default function PosterCard({
  to,
  title,
  posterPath,
  posterSize = "w342",
  subtitle,
  footer,
  actions,
  corner,
  className,
}: PosterCardProps) {
  return (
    <div className={cx("@container group/poster flex flex-col gap-1.5 min-w-0", className)}>
      <div className="relative">
        <Link
          to={to}
          tabIndex={-1}
          aria-hidden="true"
          className="block aspect-[2/3] rounded-surface overflow-hidden bg-neutral-800 border border-white/10"
        >
          {posterPath ? (
            <img
              src={`${BASE_IMAGE_URL}/${posterSize}${posterPath}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover transition-opacity duration-200 group-hover/poster:opacity-85"
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center p-3 text-center text-caption text-neutral-500">
              {title}
            </span>
          )}
        </Link>
        {corner && <div className="absolute top-1.5 left-1.5">{corner}</div>}
        {actions && <div className="absolute right-1.5 bottom-1.5 flex gap-1.5">{actions}</div>}
      </div>
      <Link
        to={to}
        className={cx(
          "truncate rounded-sm text-label font-semibold text-neutral-100 hover:text-primary-300 transition-colors",
          focusRing,
        )}
      >
        {title}
      </Link>
      {subtitle && <p className="truncate text-caption text-neutral-400">{subtitle}</p>}
      {footer}
    </div>
  );
}

/** A placeholder with PosterCard's shape, for loading grids. */
export function PosterCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse" aria-hidden="true">
      <div className="aspect-[2/3] rounded-surface bg-neutral-800" />
      <div className="h-3 w-3/4 rounded bg-neutral-800" />
      <div className="h-3 w-1/2 rounded bg-neutral-800" />
    </div>
  );
}
