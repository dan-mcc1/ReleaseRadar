import { useAuthUser } from "../hooks/useAuthUser";
import { useFavoriteStatus, useToggleFavorite } from "../hooks/api/useLists";

interface FavoriteButtonProps {
  contentType: "movie" | "tv" | "collection";
  contentId: number;
  /**
   * "icon" is a square heart with no text, for a crowded action bar.
   * "row" is a labelled row in a list of actions; the caller passes its
   * shared row classes as `className`.
   */
  variant?: "button" | "icon" | "row";
  className?: string;
}

export default function FavoriteButton({
  contentType,
  contentId,
  variant = "button",
  className,
}: FavoriteButtonProps) {
  const user = useAuthUser();
  const { data, isLoading } = useFavoriteStatus(contentType, contentId);
  const toggleMutation = useToggleFavorite();

  const favorited = data?.favorited ?? false;

  function toggle() {
    if (!user) return;
    toggleMutation.mutate({ contentType, contentId, favorited });
  }

  const actionLabel = favorited ? "Remove from favorites" : "Add to favorites";

  const heart = (iconClass: string) => (
    <svg
      className={iconClass}
      viewBox="0 0 24 24"
      fill={favorited ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
  );

  // A row keeps its place while the status loads, so the list doesn't jump.
  if (variant === "row") {
    return (
      <button
        onClick={toggle}
        disabled={isLoading}
        title={actionLabel}
        aria-pressed={favorited}
        className={className}
      >
        {heart(`w-4 h-4 shrink-0 ${favorited ? "text-pink-500" : "text-neutral-400"}`)}
        {favorited ? "Favorited" : "Favorite"}
      </button>
    );
  }

  if (isLoading) return null;

  if (variant === "icon") {
    return (
      <button
        onClick={toggle}
        title={actionLabel}
        aria-label={actionLabel}
        className={`inline-flex items-center justify-center w-[38px] h-[38px] rounded-xl border transition-colors ${
          favorited
            ? "bg-pink-600 hover:bg-pink-500 border-pink-500 text-white"
            : "bg-neutral-800 hover:bg-neutral-700 border-neutral-600 text-neutral-300"
        }`}
      >
        {heart("w-4 h-4")}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title={actionLabel}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
        favorited
          ? "bg-pink-600 hover:bg-pink-500 text-white"
          : "bg-neutral-700 hover:bg-neutral-600 text-neutral-300"
      }`}
    >
      {heart("w-4 h-4")}
      {favorited ? "Favorited" : "Favorite"}
    </button>
  );
}
