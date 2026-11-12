// frontend/src/components/media/BackdropCard.tsx
import type { ReactNode } from "react";
import { BASE_IMAGE_URL } from "../../constants";

interface Props {
  backdropPath?: string | null;
  className?: string;
  /** The page title, laid over the bottom-left of the image. */
  title?: ReactNode;
  /** Shown in the bottom-right corner of the image (the trailer button). */
  children?: ReactNode;
}

/**
 * The backdrop as a rounded card at its full 16:9 shape, never cropped, with
 * the title over its lower edge. With no backdrop, the title stands alone.
 */
export default function BackdropCard({ backdropPath, className = "", title, children }: Props) {
  if (!backdropPath) {
    return title ? <div className={className}>{title}</div> : null;
  }

  return (
    <div className={`relative rounded-2xl overflow-hidden bg-neutral-900 ${className}`}>
      <img
        src={`${BASE_IMAGE_URL}/w1280${backdropPath}`}
        srcSet={`${BASE_IMAGE_URL}/w780${backdropPath} 780w, ${BASE_IMAGE_URL}/w1280${backdropPath} 1280w`}
        sizes="(min-width: 1536px) 1200px, (min-width: 1024px) 70vw, 100vw"
        alt=""
        className="block w-full aspect-video object-cover"
        loading="eager"
        fetchPriority="high"
      />
      {(title || children) && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-neutral-950/90 via-neutral-950/45 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 lg:p-8 flex items-end justify-between gap-4">
            <div className="min-w-0">{title}</div>
            {children && <div className="shrink-0">{children}</div>}
          </div>
        </>
      )}
    </div>
  );
}
