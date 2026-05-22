import { auth } from "../firebase";
import { API_URL } from "../constants";
import { isAccountRestricted, triggerBanDetected } from "./accountState";

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
  // /user/account-status uses get_uid_only and must remain reachable when restricted
  // so the ban-state poller can detect when a ban/suspension has been lifted.
  if (isAccountRestricted() && path !== "/user/account-status") {
    return new Response(JSON.stringify({ detail: "Account restricted." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 403 && !isAccountRestricted()) {
    res.clone().json().then((body: { detail?: { code?: string } }) => {
      const code = body?.detail?.code;
      if (code === "account_banned" || code === "account_suspended") {
        triggerBanDetected();
      }
    }).catch(() => {});
  }

  return res;
}
