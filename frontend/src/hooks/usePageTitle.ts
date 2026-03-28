import { useEffect } from "react";

/**
 * Sets document.title for the current page.
 * Pass a page-specific title to get "Title — Watch Calendar",
 * or nothing to get just "Watch Calendar".
 */
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} — Watch Calendar` : "Watch Calendar";
  }, [title]);
}
