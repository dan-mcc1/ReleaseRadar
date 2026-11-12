import { describe, expect, it } from "vitest";
import { escapeHtml, injectPreviewTags, trimDescription } from "./previewTags.ts";

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="theme-color" content="#0a0a0a" />
    <title>Release Radar</title>
    <meta name="description" content="old" />
    <meta property="og:title" content="old title" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="https://releaseradar.co/" />
  </head>
  <body><div id="root"></div></body>
</html>`;

const base = { kind: "tv" as const, id: "1396", title: "Breaking Bad" };

describe("injectPreviewTags", () => {
  it("replaces existing tags instead of duplicating them", () => {
    const out = injectPreviewTags(PAGE, {
      ...base,
      overview: "A teacher turns to crime.",
      posterPath: "/poster.jpg",
    });
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain("<title>Breaking Bad — Release Radar</title>");
    expect(out.match(/name="description"/g)).toHaveLength(1);
    expect(out).toContain('content="A teacher turns to crime."');
    expect(out.match(/property="og:title"/g)).toHaveLength(1);
    expect(out.match(/name="twitter:card"/g)).toHaveLength(1);
    expect(out.match(/rel="canonical"/g)).toHaveLength(1);
    expect(out).toContain('href="https://releaseradar.co/tv/1396"');
    expect(out).toContain('content="https://image.tmdb.org/t/p/w500/poster.jpg"');
    expect(out).toContain('name="theme-color"');
    expect(out).toContain('<div id="root">');
  });

  it("escapes HTML in titles and overviews", () => {
    const out = injectPreviewTags(PAGE, {
      ...base,
      title: `"><script>alert(1)</script> $& '`,
      overview: `<b>bold</b> & "quoted"`,
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; &#39;");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;");
  });

  it("falls back to a generic description and the site image without overview or poster", () => {
    const out = injectPreviewTags(PAGE, { ...base, kind: "movie", id: "603", overview: "  ", posterPath: null });
    expect(out).toContain("Track this movie");
    expect(out).toContain('property="og:image" content="https://releaseradar.co/og-image.png"');
    expect(out).toContain('name="twitter:card" content="summary_large_image"');
    expect(out).toContain('property="og:type" content="video.movie"');
  });

  it("returns the page unchanged apart from stripping when there is no head", () => {
    expect(injectPreviewTags("<p>hi</p>", base)).toBe("<p>hi</p>");
  });
});

describe("trimDescription", () => {
  it("keeps short text and cuts long text at a word boundary", () => {
    expect(trimDescription("short  text")).toBe("short text");
    const long = "word ".repeat(80);
    const out = trimDescription(long);
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("isPreviewBot", () => {
  it("matches link unfurlers and crawlers but not browsers", async () => {
    const { isPreviewBot } = await import("../middleware");
    for (const ua of [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Twitterbot/1.0",
      "WhatsApp/2.23.20.0 A",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1)",
    ]) {
      expect(isPreviewBot(ua), ua).toBe(true);
    }
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      null,
    ]) {
      expect(isPreviewBot(ua), String(ua)).toBe(false);
    }
  });
});
