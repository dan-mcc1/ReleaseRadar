// Vercel Routing Middleware (file convention, Node runtime). Gives shared
// /tv/:id and /movie/:id links their own title, description and poster in the
// HTML for crawlers and link unfurlers, which do not run the SPA. Everyone else,
// and any failure, falls through to the normal response.
// Everything lives in this one file on purpose: Vercel doesn't resolve this
// file's local imports at runtime (an import from ./server/ crashed every
// /tv and /movie request with MIDDLEWARE_INVOCATION_FAILED). Keep it
// self-contained: no imports.

export const config = {
  // Without this Vercel picks the deprecated edge runtime.
  runtime: "nodejs",
  matcher: ["/tv/:id(\\d+)", "/movie/:id(\\d+)"],
};

const API_BASE = (
  process.env.API_URL || process.env.VITE_API_URL || "https://api.releaseradar.co"
).replace(/\/+$/, "");
const TIMEOUT_MS = 1500;
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

// ── Pure helpers (exported for middleware.test.ts) ──

export interface PreviewInput {
  kind: "tv" | "movie";
  id: string;
  title: string;
  overview?: string | null;
  posterPath?: string | null;
}

const SITE_URL = "https://releaseradar.co";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const MAX_DESCRIPTION = 155;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapses whitespace and cuts at a word boundary near `max` characters. */
export function trimDescription(text: string, max = MAX_DESCRIPTION): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

function buildTags(input: PreviewInput): string {
  const noun = input.kind === "tv" ? "show" : "movie";
  const title = `${input.title} — Release Radar`;
  const overview = input.overview ? trimDescription(input.overview) : "";
  const description =
    overview || `Track this ${noun}, get its release dates and alerts, and see what your friends think on Release Radar.`;
  const url = `${SITE_URL}/${input.kind}/${input.id}`;
  const poster = input.posterPath ? `${POSTER_BASE}${input.posterPath}` : null;
  const image = poster ?? `${SITE_URL}/og-image.png`;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const lines = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="${input.kind === "tv" ? "video.tv_show" : "video.movie"}" />`,
    `<meta property="og:site_name" content="Release Radar" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(poster ? `Poster for ${input.title}` : "Release Radar")}" />`,
    `<meta name="twitter:card" content="${poster ? "summary" : "summary_large_image"}" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ];
  return lines.map((l) => `    ${l}\n`).join("");
}

const STRIP_PATTERNS: RegExp[] = [
  /[ \t]*<title>[\s\S]*?<\/title>[ \t]*\r?\n?/gi,
  /[ \t]*<meta\s[^>]*?\b(?:name|property)=["'](?:description|og:[^"']*|twitter:[^"']*)["'][^>]*>[ \t]*\r?\n?/gi,
  /[ \t]*<link\s[^>]*?\brel=["']canonical["'][^>]*>[ \t]*\r?\n?/gi,
];

// Only link unfurlers and search crawlers get the rewritten page; people get
// the plain SPA with no extra round trips before it starts.
const PREVIEW_BOTS =
  /bot\b|crawler|spider|facebookexternalhit|facebookcatalog|slackbot|discordbot|twitterbot|whatsapp|telegrambot|linkedinbot|skypeuripreview|embedly|redditbot|pinterest|applebot|googlebot|bingbot|duckduckbot|yandex|iframely|vkshare|outbrain|quora link preview|mastodon/i;

export function isPreviewBot(userAgent: string | null): boolean {
  return !!userAgent && PREVIEW_BOTS.test(userAgent);
}

/** Replaces the page's title, description, canonical, og:* and twitter:* tags. */
export function injectPreviewTags(html: string, input: PreviewInput): string {
  let out = html;
  for (const pattern of STRIP_PATTERNS) out = out.replace(pattern, "");
  const tags = buildTags(input);
  // A function replacer keeps `$` sequences in titles from being read as patterns.
  return /<\/head>/i.test(out)
    ? out.replace(/[ \t]*<\/head>/i, () => `${tags}  </head>`)
    : out;
}
