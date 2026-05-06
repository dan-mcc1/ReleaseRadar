import { auth } from "../firebase";
import { API_URL } from "../constants";

/**
 * Fetch wrapper that automatically attaches the current user's Firebase ID
 * token as a Bearer Authorization header. Falls back to an unauthenticated
 * request when no user is signed in.
 *
 * Usage:
 *   const res = await apiFetch("/watchlist");
 *   const res = await apiFetch("/watchlist/remove", {
 *     method: "DELETE",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ content_type: "tv", content_id: 123 }),
 *   });
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...options, headers });
}
