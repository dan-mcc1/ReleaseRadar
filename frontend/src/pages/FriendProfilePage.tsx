import { useParams, Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../utils/apiFetch";
import { useAuthUser } from "../hooks/useAuthUser";
import { useFriendProfile } from "../hooks/api/useUser";
import { queryKeys } from "../hooks/api/queryKeys";
import ExpandableMediaList from "../components/ExpandableMediaList";
import { usePageTitle } from "../hooks/usePageTitle";
import { useState } from "react";

interface MediaItem {
  id: number;
  poster_path: string | null;
  title?: string;
  name?: string;
}

interface FriendUser {
  id: string;
  username: string;
}

interface PublicProfile {
  id: string;
  username: string;
  bio: string | null;
  is_friend: boolean;
  profile_visibility: "public" | "friends_only" | "private";
  pending_request_id: number | null;
  is_following: boolean;
  following_id: number | null;
  is_followed_by_them: boolean;
  incoming_request_id: number | null;
  favorites?: { movies: MediaItem[]; shows: MediaItem[] };
  watchlist?: { movies: MediaItem[]; shows: MediaItem[] };
  watched?: { movies: MediaItem[]; shows: MediaItem[] };
  friends?: { friendship_id: number; friend: FriendUser }[];
}

export default function FriendProfilePage() {
  const { username } = useParams<{ username: string }>();
  const user = useAuthUser();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useFriendProfile(username);
  const profile =
    data && !("isSelf" in data) ? (data as PublicProfile) : null;
  const isSelf = !!(data && "isSelf" in data && data.isSelf);

  usePageTitle(profile ? `@${profile.username}` : undefined);

  const [requesting, setRequesting] = useState(false);

  function setProfileData(updater: (p: PublicProfile) => PublicProfile) {
    if (!username) return;
    queryClient.setQueryData(
      queryKeys.friendProfile(username),
      (old: PublicProfile | undefined) => (old ? updater(old) : old),
    );
  }

  async function refetchProfile() {
    if (!username) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.friendProfile(username),
    });
  }

  async function sendRequest() {
    if (!profile || requesting) return;
    setRequesting(true);
    try {
      const res = await apiFetch("/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressee_username: profile.username }),
      });
      if (res.ok) {
        const resData = await res.json();
        if (resData.status === "following") {
          setProfileData((p) => ({
            ...p,
            is_following: true,
            following_id: resData.id,
            pending_request_id: null,
          }));
        } else if (resData.status === "accepted") {
          await refetchProfile();
        } else {
          setProfileData((p) => ({ ...p, pending_request_id: resData.id }));
        }
        if (user) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.friendRequestsOutgoing(user.uid),
          });
        }
      }
    } finally {
      setRequesting(false);
    }
  }

  async function cancelRequest() {
    if (!profile?.pending_request_id || requesting) return;
    setRequesting(true);
    try {
      const res = await apiFetch(
        `/friends/cancel/${profile.pending_request_id}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setProfileData((p) => ({ ...p, pending_request_id: null }));
        if (user) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.friendRequestsOutgoing(user.uid),
          });
        }
      }
    } finally {
      setRequesting(false);
    }
  }

  async function unfollow() {
    if (!profile?.following_id || requesting) return;
    setRequesting(true);
    try {
      const res = await apiFetch(`/friends/cancel/${profile.following_id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setProfileData((p) => ({
          ...p,
          is_following: false,
          following_id: null,
        }));
      }
    } finally {
      setRequesting(false);
    }
  }

  async function respondToRequest(accept: boolean) {
    if (!profile?.incoming_request_id || requesting) return;
    setRequesting(true);
    try {
      const res = await apiFetch("/friends/respond", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendship_id: profile.incoming_request_id,
          accept,
        }),
      });
      if (res.ok) {
        if (accept) {
          await refetchProfile();
        } else {
          setProfileData((p) => ({ ...p, incoming_request_id: null }));
        }
        if (user) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.friendRequestsIncoming(user.uid),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.navCounts(user.uid),
          });
          if (accept) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.friends(user.uid),
            });
          }
        }
      }
    } finally {
      setRequesting(false);
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-400">Loading…</div>;
  }

  if (isSelf) return <Navigate to="/profile" replace />;

  if (isError || !profile) {
    return (
      <div className="p-8 text-center text-neutral-400">
        Could not load profile.
      </div>
    );
  }

  const watchlist = profile.watchlist;
  const watched = profile.watched;
  const favorites = profile.favorites;
  const friends = profile.friends ?? [];

  const canSeeDetails =
    (profile.is_friend || profile.profile_visibility === "public") &&
    profile.profile_visibility !== "private";
  const totalWatched = canSeeDetails
    ? (watched?.movies.length ?? 0) + (watched?.shows.length ?? 0)
    : null;
  const totalWatchlist = canSeeDetails
    ? (watchlist?.movies.length ?? 0) + (watchlist?.shows.length ?? 0)
    : null;
  const totalFavorites = canSeeDetails
    ? (favorites?.movies.length ?? 0) + (favorites?.shows.length ?? 0)
    : null;
  const totalFriends = canSeeDetails ? friends.length : null;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="bg-primary-700 rounded-lg text-white overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-6">
          <div className="flex items-center gap-4 sm:gap-6 flex-1 min-w-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-full bg-neutral-600 flex items-center justify-center text-3xl font-bold text-neutral-300 border-2 border-white/20">
              {profile.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold">@{profile.username}</h1>
              {profile.bio && (
                <p className="text-neutral-300 text-sm mt-1">{profile.bio}</p>
              )}
              {!profile.is_friend &&
                !profile.is_following &&
                profile.profile_visibility === "friends_only" && (
                  <p className="text-neutral-300 text-sm mt-1">
                    Add this person as a friend to see their lists.
                  </p>
                )}
              {!profile.is_friend && profile.profile_visibility === "private" && (
                <p className="text-neutral-300 text-sm mt-1">
                  This account is private.
                </p>
              )}
            </div>
          </div>

          {!profile.is_friend &&
            (profile.incoming_request_id ? (
              <div className="flex gap-2">
                <button
                  onClick={() => respondToRequest(true)}
                  disabled={requesting}
                  className="flex items-center gap-2 bg-success-600 hover:bg-success-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {requesting ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : null}
                  Accept
                </button>
                <button
                  onClick={() => respondToRequest(false)}
                  disabled={requesting}
                  className="flex items-center gap-2 bg-neutral-600 hover:bg-neutral-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Decline
                </button>
              </div>
            ) : profile.is_following ? (
              <button
                onClick={unfollow}
                disabled={requesting}
                className="flex items-center gap-2 bg-neutral-600 hover:bg-neutral-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {requesting ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
                Following
              </button>
            ) : profile.pending_request_id ? (
              <button
                onClick={cancelRequest}
                disabled={requesting}
                className="flex items-center gap-2 bg-neutral-600 hover:bg-neutral-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {requesting ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
                Request Sent
              </button>
            ) : (
              <button
                onClick={sendRequest}
                disabled={requesting}
                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {requesting ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                    />
                  </svg>
                )}
                {profile.profile_visibility === "public"
                  ? "Follow"
                  : profile.is_followed_by_them
                    ? "Add back"
                    : "Add Friend"}
              </button>
            ))}
        </div>

        {/* Stats bar — only when content is visible */}
        {canSeeDetails && (
          <div className="flex gap-px border-t border-white/10">
            {[
              { label: "Watched", value: totalWatched ?? 0 },
              { label: "Watchlist", value: totalWatchlist ?? 0 },
              { label: "Favorites", value: totalFavorites ?? 0 },
              { label: "Friends", value: totalFriends ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="flex-1 py-3 text-center">
                <p className="text-lg font-bold text-white">{value}</p>
                <p className="text-xs text-neutral-400">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Favorites — visible based on privacy setting */}
      {canSeeDetails &&
        favorites &&
        (favorites.movies.length > 0 || favorites.shows.length > 0) && (
          <div className="bg-neutral-800 rounded-lg p-4 space-y-4">
            <h2 className="text-lg font-semibold text-white">Favorites</h2>

            {favorites.movies.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  Movies ({favorites.movies.length})
                </h3>
                <ExpandableMediaList
                  items={favorites.movies}
                  linkPrefix="/movie"
                  fallbackImage="/movie-icon.png"
                />
              </div>
            )}

            {favorites.shows.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  TV Shows ({favorites.shows.length})
                </h3>
                <ExpandableMediaList
                  items={favorites.shows}
                  linkPrefix="/tv"
                  fallbackImage="/tv-icon.png"
                />
              </div>
            )}
          </div>
        )}

      {/* Friends list — shown to friends (non-private) and on public profiles */}
      {canSeeDetails && friends.length > 0 && (
        <div className="bg-neutral-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-3">
            Friends{" "}
            <span className="text-neutral-400 text-sm font-normal">
              ({friends.length})
            </span>
          </h2>
          <div className="flex flex-wrap gap-3">
            {friends.map(({ friendship_id, friend }) => (
              <Link
                key={friendship_id}
                to={`/user/${friend.username}`}
                className="flex items-center gap-2 bg-neutral-700 hover:bg-neutral-600 transition-colors px-3 py-2 rounded-lg"
              >
                <div className="w-7 h-7 rounded-full bg-neutral-500 flex items-center justify-center text-xs font-bold text-neutral-200 flex-shrink-0">
                  {friend.username[0].toUpperCase()}
                </div>
                <span className="text-sm text-neutral-200">
                  @{friend.username}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Lists — shown to friends and on public profiles */}
      {canSeeDetails && watchlist && watched && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Watchlist */}
          <div className="bg-neutral-800 rounded-lg p-4 space-y-4">
            <h2 className="text-lg font-semibold text-white">Watchlist</h2>

            {watchlist.movies.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  Movies ({watchlist.movies.length})
                </h3>
                <ExpandableMediaList
                  items={watchlist.movies}
                  linkPrefix="/movie"
                  fallbackImage="/movie-icon.png"
                />
              </div>
            )}

            {watchlist.shows.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  TV Shows ({watchlist.shows.length})
                </h3>
                <ExpandableMediaList
                  items={watchlist.shows}
                  linkPrefix="/tv"
                  fallbackImage="/tv-icon.png"
                />
              </div>
            )}

            {watchlist.movies.length === 0 && watchlist.shows.length === 0 && (
              <p className="text-neutral-400 text-sm">
                Nothing on their watchlist.
              </p>
            )}
          </div>

          {/* Watched */}
          <div className="bg-neutral-800 rounded-lg p-4 space-y-4">
            <h2 className="text-lg font-semibold text-white">Watched</h2>

            {watched.movies.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  Movies ({watched.movies.length})
                </h3>
                <ExpandableMediaList
                  items={watched.movies}
                  linkPrefix="/movie"
                  fallbackImage="/movie-icon.png"
                />
              </div>
            )}

            {watched.shows.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  TV Shows ({watched.shows.length})
                </h3>
                <ExpandableMediaList
                  items={watched.shows}
                  linkPrefix="/tv"
                  fallbackImage="/tv-icon.png"
                />
              </div>
            )}

            {watched.movies.length === 0 && watched.shows.length === 0 && (
              <p className="text-neutral-400 text-sm">Nothing watched yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
