import { useAuthUser } from "../hooks/useAuthUser";
import { useFavoriteStatus, useToggleFavorite } from "../hooks/api/useLists";

interface FavoriteButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
}

export default function FavoriteButton({ contentType, contentId }: FavoriteButtonProps) {
  const user = useAuthUser();
  const { data, isLoading } = useFavoriteStatus(contentType, contentId);
  const toggleMutation = useToggleFavorite();

  const favorited = data?.favorited ?? false;

  function toggle() {
    if (!user) return;
    toggleMutation.mutate({ contentType, contentId, favorited });
  }

  if (isLoading) return null;

  return (
    <button
      onClick={toggle}
      title={favorited ? "Remove from favorites" : "Add to favorites"}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
        favorited
          ? "bg-pink-600 hover:bg-pink-500 text-white"
          : "bg-neutral-700 hover:bg-neutral-600 text-neutral-300"
      }`}
    >
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill={favorited ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
      {favorited ? "Favorited" : "Favorite"}
    </button>
  );
}
