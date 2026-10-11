import { auth } from "../firebase";
import { API_URL } from "../constants";
import { isAccountRestricted, triggerBanDetected } from "./accountState";

const DEFAULT_TIMEOUT_MS = 30_000;

export type ApiFetchOptions = RequestInit & {
  /** Abort if no response within this many ms (0 = no limit). Default 30s. */
  timeoutMs?: number;
};

/** The caller's signal (React Query cancellation) plus a timeout. */
function withTimeout(
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; clear: () => void } {
  if (!timeoutMs) return { signal: signal ?? undefined, clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

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
  { timeoutMs = DEFAULT_TIMEOUT_MS, ...options }: ApiFetchOptions = {},
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
  // The timeout covers waiting for the response, not reading its body.
  const timeout = withTimeout(options.signal, timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, signal: timeout.signal });
  } finally {
    timeout.clear();
  }

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
