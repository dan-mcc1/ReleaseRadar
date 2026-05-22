import { apiFetch } from "../../utils/apiFetch";
import { TrackingLimitError } from "./errors";

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

/**
 * Thin wrapper for mutation fetches that return no body.
 * Throws TrackingLimitError on 403 tracking_limit_reached, generic Error otherwise.
 */
export async function checkedFetch(path: string, options: RequestInit): Promise<void> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      if (body?.detail?.error === "tracking_limit_reached") {
        throw new TrackingLimitError(body.detail.limit, body.detail.current);
      }
    }
    throw new Error(`Request failed: ${res.status}`);
  }
}
