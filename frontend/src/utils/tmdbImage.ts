import { BASE_IMAGE_URL } from "../constants";

// TMDb's posters/stills/backdrops are served at fixed widths (in px). The
// browser can pick the right one from a srcset.
const POSTER_WIDTHS = [92, 154, 185, 342, 500, 780] as const;
const BACKDROP_WIDTHS = [300, 780, 1280] as const;
const STILL_WIDTHS = [92, 185, 300] as const;

type ImageKind = "poster" | "backdrop" | "still";

function widthsFor(kind: ImageKind): readonly number[] {
  if (kind === "backdrop") return BACKDROP_WIDTHS;
  if (kind === "still") return STILL_WIDTHS;
  return POSTER_WIDTHS;
}

/**
 * Build a srcSet string for a TMDb image path. Returns "" if path is falsy so
 * callers can drop it straight into a `srcSet={...}` prop without conditionals.
 */
export function tmdbSrcSet(path: string | null | undefined, kind: ImageKind = "poster"): string {
  if (!path) return "";
  return widthsFor(kind)
    .map((w) => `${BASE_IMAGE_URL}/w${w}${path} ${w}w`)
    .join(", ");
}
