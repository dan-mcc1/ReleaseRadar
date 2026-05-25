const SAFE_SCHEMES = ["http:", "https:", "mailto:"];

export function safeHref(url: string | null | undefined): string {
  if (!url) return "#";
  const trimmed = url.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (SAFE_SCHEMES.includes(parsed.protocol)) return parsed.toString();
  } catch {
    // fall through
  }
  return "#";
}
