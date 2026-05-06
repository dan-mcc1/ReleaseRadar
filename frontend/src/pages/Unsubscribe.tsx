import { useSearchParams, Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../utils/apiFetch";

export default function Unsubscribe() {
  usePageTitle("Unsubscribe");
  const [params] = useSearchParams();
  const uid = params.get("uid");
  const token = params.get("token");

  const { isLoading, isSuccess } = useQuery({
    queryKey: ["unsubscribe", uid, token],
    queryFn: async () => {
      const res = await apiFetch(
        `/notifications/unsubscribe?uid=${encodeURIComponent(uid!)}&token=${encodeURIComponent(token!)}`,
      );
      if (!res.ok) throw new Error("invalid");
      return true;
    },
    enabled: !!uid && !!token,
    retry: false,
    staleTime: Infinity,
  });

  const status = !uid || !token ? "error" : isLoading ? "loading" : isSuccess ? "success" : "error";

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
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
