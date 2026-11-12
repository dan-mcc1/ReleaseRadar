// Vercel Routing Middleware (file convention, Node runtime). Gives shared
// /tv/:id and /movie/:id links their own title, description and poster in the
// HTML for crawlers and link unfurlers, which do not run the SPA. Everyone else,
// and any failure, falls through to the normal response.
import { injectPreviewTags } from "./middleware/previewTags.ts";

export const config = {
  matcher: ["/tv/:id(\\d+)", "/movie/:id(\\d+)"],
};

const API_BASE = (
  process.env.API_URL || process.env.VITE_API_URL || "https://api.releaseradar.co"
).replace(/\/+$/, "");
const TIMEOUT_MS = 1500;
// Only link unfurlers and search crawlers get the rewritten page; people get
// the plain SPA with no extra round trips before it starts.
const PREVIEW_BOTS =
  /bot\b|crawler|spider|facebookexternalhit|facebookcatalog|slackbot|discordbot|twitterbot|whatsapp|telegrambot|linkedinbot|skypeuripreview|embedly|redditbot|pinterest|applebot|googlebot|bingbot|duckduckbot|yandex|iframely|vkshare|outbrain|quora link preview|mastodon/i;

export function isPreviewBot(userAgent: string | null): boolean {
  return !!userAgent && PREVIEW_BOTS.test(userAgent);
}
const DROP_HEADERS = ["content-length", "content-encoding", "transfer-encoding", "etag"];

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (request.method !== "GET" || !isPreviewBot(request.headers.get("user-agent"))) return undefined;
  try {
    const url = new URL(request.url);
    const match = /^\/(tv|movie)\/(\d+)\/?$/.exec(url.pathname);
    if (!match) return undefined;
    const kind = match[1] as "tv" | "movie";
    const id = match[2];

    const signal = AbortSignal.timeout(TIMEOUT_MS);
    // /index.html is outside the matcher, so this fetch cannot re-enter the middleware.
    const [apiRes, pageRes] = await Promise.all([
      fetch(`${API_BASE}/${kind === "tv" ? "tv" : "movies"}/${id}`, {
        signal,
        headers: { Accept: "application/json" },
      }),
      fetch(new URL("/index.html", url.origin), { signal }),
    ]);
    if (!apiRes.ok || !pageRes.ok) return undefined;

    const data = (await apiRes.json()) as {
      name?: string;
      title?: string;
      overview?: string | null;
      poster_path?: string | null;
    };
    const title = (kind === "tv" ? data.name : data.title)?.trim();
    if (!title) return undefined;

    const html = injectPreviewTags(await pageRes.text(), {
      kind,
      id,
      title,
      overview: data.overview,
      posterPath: data.poster_path,
    });

    const headers = new Headers(pageRes.headers);
    for (const h of DROP_HEADERS) headers.delete(h);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    return new Response(html, { status: 200, headers });
  } catch {
    return undefined;
  }
}
