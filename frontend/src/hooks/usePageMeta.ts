import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { usePageTitle } from "./usePageTitle";

const SITE_URL = "https://releaseradar.co";
const MAX_DESCRIPTION = 155;

const DEFAULT_TITLE = "Release Radar";
const DEFAULT_DESCRIPTION =
  "Never miss a release you care about. A calendar and alerts built from the movies and shows you track, with friends and lists that keep themselves up to date.";

/** Collapses whitespace and cuts at a word boundary near ~155 characters. */
export function trimDescription(text: string, max = MAX_DESCRIPTION): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function apply(title: string, description: string, canonical: string | null) {
  setMeta("name", "description", description);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setCanonical(canonical);
}

/**
 * Sets the page title (like usePageTitle) plus the meta description,
 * og:/twitter: title and description, and the canonical URL
 * (https://releaseradar.co + current pathname). Defaults come back when the
 * page unmounts. A missing description keeps the site default.
 */
export function usePageMeta({ title, description }: { title?: string | null; description?: string | null }) {
  const { pathname } = useLocation();
  usePageTitle(title);

  useEffect(() => {
    const fullTitle = title ? `${title} — ${DEFAULT_TITLE}` : DEFAULT_TITLE;
    const desc = description ? trimDescription(description) : DEFAULT_DESCRIPTION;
    apply(fullTitle, desc, `${SITE_URL}${pathname === "/" ? "/" : pathname.replace(/\/+$/, "")}`);
    return () => apply(DEFAULT_TITLE, DEFAULT_DESCRIPTION, null);
  }, [title, description, pathname]);
}
