import { ApiError } from "../../hooks/api/errors";
import Button, { ButtonLink } from "./Button";
import EmptyState from "./EmptyState";
import { ChevronLeftIcon, RefreshIcon } from "./icons";

interface Back {
  to: string;
  label: string;
}

type Props =
  | { status: "loading"; label?: string }
  | {
      status: "error";
      /** The thrown error; picks the wording. Its own message is never shown. */
      error?: unknown;
      /** What failed to load, as people say it: "show", "season", "episode". */
      subject: string;
      /** Where to go instead. Defaults to the home page. */
      back?: Back;
      /** Offered unless the thing doesn't exist. */
      onRetry?: () => void;
    };

/** Plain words for a failed page load; never the error's own message. */
export function describeLoadError(
  error: unknown,
  subject: string,
): { title: string; description: string; retryable: boolean } {
  const status = error instanceof ApiError ? error.status : null;
  if (status === 404 || status === 422 || (error == null && status == null)) {
    return {
      title: `We couldn't find this ${subject}`,
      description: "The link may be wrong, or it may have been removed.",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      title: "Too many requests",
      description: "Give it a few seconds, then try again.",
      retryable: true,
    };
  }
  // fetch() rejects with a TypeError when the request never got an answer.
  if (status == null && (error instanceof TypeError || !navigator.onLine)) {
    return {
      title: "Can't connect right now",
      description: "Check your internet connection, then try again.",
      retryable: true,
    };
  }
  return {
    title: `Couldn't load this ${subject}`,
    description: "Something went wrong on our end. Try again in a moment.",
    retryable: true,
  };
}

/** What a whole page shows while it loads, or when its data didn't arrive. */
export default function PageState(props: Props) {
  if (props.status === "loading") {
    return (
      <div role="status" className="flex flex-col items-center justify-center gap-3 py-32">
        <div
          className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
        <p className="text-body text-neutral-400">{props.label ?? "Loading…"}</p>
      </div>
    );
  }

  const { error, subject, back, onRetry } = props;
  const { title, description, retryable } = describeLoadError(error, subject);
  return (
    <EmptyState
      className="py-24"
      title={title}
      description={description}
      action={
        <>
          {retryable && onRetry && (
            <Button variant="primary" icon={<RefreshIcon />} onClick={onRetry}>
              Try again
            </Button>
          )}
          <ButtonLink to={back?.to ?? "/"} icon={<ChevronLeftIcon />}>
            {back?.label ?? "Back to home"}
          </ButtonLink>
        </>
      }
    />
  );
}
