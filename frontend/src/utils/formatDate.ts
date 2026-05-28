/**
 * Format an ISO date string ("2024-07-26") or full ISO datetime as
 * "Jul 26, 2024". Done in UTC to avoid off-by-one rendering bugs from the
 * viewer's timezone.
 */
export function formatHumanDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
