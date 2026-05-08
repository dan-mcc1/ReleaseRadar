import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";

export interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  source: { id: string | null; name: string };
  author: string | null;
  content: string | null;
}

interface NewsResults {
  articles: NewsArticle[];
  totalResults: number;
}

export type NewsCategory = "entertainment" | "movies" | "tv";

export function useNews(category: NewsCategory, page: number, q?: string) {
  const params = new URLSearchParams({ category, page: String(page) });
  if (q) params.set("q", q);

  return useQuery({
    queryKey: queryKeys.news(category, page, q ?? ""),
    queryFn: () => queryFetch<NewsResults>(`/news/?${params}`),
    staleTime: 30 * 60 * 1000,
  });
}
