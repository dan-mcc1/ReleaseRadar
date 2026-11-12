import { useSearchParams, Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../utils/apiFetch";
import { Button, ButtonLink, EmptyState } from "../components/ui";

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
        <EmptyState
          className="py-0"
          title="Unsubscribe?"
          description="You'll stop receiving all Release Radar emails."
          action={
            <Button variant="primary" onClick={() => unsubscribe.mutate()}>
              Unsubscribe from all emails
            </Button>
          }
        />
      )}
      {status === "loading" && (
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      )}
      {status === "success" && (
        <>
          <EmptyState
            className="py-0"
            title="Unsubscribed"
            description="You've been removed from all Release Radar emails."
          />
          <p className="text-neutral-400 text-label my-6">
            Changed your mind? You can re-enable emails anytime in{" "}
            <Link
              to="/settings#notifications"
              className="text-neutral-200 underline hover:text-primary-300"
            >
              Settings
            </Link>
            .
          </p>
          <ButtonLink to="/">Back to home</ButtonLink>
        </>
      )}
      {status === "error" && (
        <EmptyState
          className="py-0"
          title="Invalid link"
          description="This unsubscribe link is invalid or has already been used."
          action={
            <ButtonLink to="/settings#notifications">
              Manage notifications in Settings
            </ButtonLink>
          }
        />
      )}
    </div>
  );
}
