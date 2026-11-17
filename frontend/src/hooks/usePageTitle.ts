import { useEffect } from "react";

/**
 * Sets document.title for the current page.
 * Pass a page-specific title to get "Title — Release Radar",
 * or nothing to get just "Release Radar". With `full`, the title is used as is.
 */
export function usePageTitle(title?: string | null, full = false) {
  useEffect(() => {
    document.title = title ? (full ? title : `${title} — Release Radar`) : "Release Radar";
  }, [title, full]);
}
