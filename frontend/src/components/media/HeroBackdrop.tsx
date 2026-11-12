// frontend/src/components/media/HeroBackdrop.tsx
import type { ReactNode } from "react";
import { BASE_IMAGE_URL } from "../../constants";

interface Props {
  backdropPath?: string | null;
  /** Shown over the middle of the backdrop (the trailer button). */
  children?: ReactNode;
}

/**
 * The backdrop at its full 16:9 shape, never cropped. It is capped at 1400px
 * wide and shrinks on short windows so the title below it stays on the first
 * screen; a blurred copy fills whatever is left at the sides.
 */
export default function HeroBackdrop({ backdropPath, children }: Props) {
  if (!backdropPath) {
    return (
      <div className="h-40 md:h-56 bg-gradient-to-br from-neutral-800 to-neutral-950" />
    );
  }

  return (
    <div className="relative overflow-hidden bg-neutral-950">
      <img
        src={`${BASE_IMAGE_URL}/w300${backdropPath}`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover scale-110 blur-3xl brightness-50"
      />
      <div className="relative mx-auto w-full max-w-[min(1400px,max(720px,calc((100dvh_-_17.5rem)*16/9)))]">
        <img
          src={`${BASE_IMAGE_URL}/w1280${backdropPath}`}
          srcSet={`${BASE_IMAGE_URL}/w780${backdropPath} 780w, ${BASE_IMAGE_URL}/w1280${backdropPath} 1280w`}
          sizes="(min-width: 1400px) 1400px, 100vw"
          alt=""
          className="block w-full aspect-video object-cover"
          loading="eager"
          fetchPriority="high"
        />
        {children && (
          <div className="absolute z-10 left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2">
            {children}
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-neutral-950 via-neutral-950/70 to-transparent" />
    </div>
  );
}
