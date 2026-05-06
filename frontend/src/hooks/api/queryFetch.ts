import { apiFetch } from "../../utils/apiFetch";

/**
 * Thin wrapper around apiFetch for use as a TanStack Query `queryFn`.
 * Returns parsed JSON on success, throws on non-ok responses.
 */
export async function queryFetch<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}
