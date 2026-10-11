import { useSearchParams, Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../utils/apiFetch";

export default function Unsubscribe() {
  usePageTitle("Unsubscribe");
  const [params] = useSearchParams();
  const uid = params.get("uid");
  const token = params.get("token");

  // Unsubscribing waits for a click: email security scanners open links
  // (and run their scripts) before the recipient ever sees them.
  const unsubscribe = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/notifications/unsubscribe?uid=${encodeURIComponent(uid!)}&token=${encodeURIComponent(token!)}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("invalid");
    },
  });

  const status =
    !uid || !token || unsubscribe.isError
      ? "error"
      : unsubscribe.isPending
        ? "loading"
        : unsubscribe.isSuccess
          ? "success"
          : "confirm";

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      {status === "confirm" && (
        <>
          <h1 className="text-2xl font-bold text-white mb-2">Unsubscribe?</h1>
          <p className="text-neutral-400 mb-6">
            You'll stop receiving all Release Radar emails.
          </p>
          <button
            type="button"
            onClick={() => unsubscribe.mutate()}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Unsubscribe from all emails
          </button>
        </>
      )}
      {status === "loading" && (
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      )}
      {status === "success" && (
        <>
          <div className="text-success-400 text-5xl mb-4">✓</div>
          <h1 className="text-2xl font-bold text-white mb-2">Unsubscribed</h1>
          <p className="text-neutral-400 mb-6">
            You've been removed from all Release Radar emails.
          </p>
          <p className="text-neutral-500 text-sm mb-6">
            Changed your mind? You can re-enable emails anytime in{" "}
            <Link
              to="/settings#notifications"
              className="text-primary-400 hover:underline"
            >
              Settings
            </Link>
            .
          </p>
          <Link
            to="/"
            className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-sm transition-colors"
          >
            Back to home
          </Link>
        </>
      )}
      {status === "error" && (
        <>
          <div className="text-error-400 text-5xl mb-4">✕</div>
          <h1 className="text-2xl font-bold text-white mb-2">Invalid link</h1>
          <p className="text-neutral-400 mb-6">
            This unsubscribe link is invalid or has already been used.
          </p>
          <Link
            to="/settings#notifications"
            className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-sm transition-colors"
          >
            Manage notifications in Settings
          </Link>
        </>
      )}
    </div>
  );
}
