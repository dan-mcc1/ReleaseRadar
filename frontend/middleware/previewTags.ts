// Pure HTML transform for link-preview tags. Used by ../middleware.ts, which
// runs on Vercel, so keep this free of DOM and browser APIs.

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
