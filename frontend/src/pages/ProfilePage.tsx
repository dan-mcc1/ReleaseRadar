import { useState } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import { BASE_IMAGE_URL, getAvatarColor } from "../constants";
import { Link } from "react-router-dom";
import FriendSearch from "../components/FriendSearch";
import FriendRequests from "../components/FriendRequests";
import FriendsList from "../components/FriendsList";
import StatsSection from "../components/StatsSection";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProfileSummary } from "../hooks/api/useUser";
import { useWatchlist, useWatched } from "../hooks/api/useLists";
import { useSendFriendRequest } from "../hooks/api/useFriends";

type FriendsTab = "friends" | "requests" | "followers" | "add";

/** Avatar for the profile hero: color preset → Google photo → grey fallback. */
function HeroAvatar({
  avatarKey,
  photoURL,
}: {
  avatarKey: string | null | undefined;
  photoURL?: string | null;
}) {
  const color = getAvatarColor(avatarKey);
  const borderStyle = "4px solid rgba(255,255,255,0.2)";
  const shadow = "0 20px 25px -5px rgba(0,0,0,0.4)";

  if (!color && photoURL) {
    return (
      <img
        src={photoURL}
        alt="Profile"
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: borderStyle,
          boxShadow: shadow,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 96,
        height: 96,
        borderRadius: "50%",
        backgroundColor: color ?? "#475569",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border: borderStyle,
        boxShadow: shadow,
      }}
    >
      <svg
        width={53}
        height={53}
        viewBox="0 0 24 24"
        fill="rgba(255,255,255,0.9)"
      >
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
      </svg>
    </div>
  );
}

export default function ProfilePage() {
  usePageTitle("My Profile");
  const user = useAuthUser();

  // Collapsible sections
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [watchedOpen, setWatchedOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  // Friends tab
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");

  const { data: summary, isLoading: summaryLoading } = useProfileSummary();
  const { data: watchlistFull, isLoading: watchlistLoading } = useWatchlist(watchlistOpen);
  const { data: watchedFull, isLoading: watchedLoading } = useWatched(watchedOpen);

  const typedDbUser = summary?.user;
  const favorites = summary?.favorites ?? { movies: [], shows: [] };
  const watchlistPreview = summary?.watchlist ?? { movies: [], shows: [], total_movies: 0, total_shows: 0 };
  const watchedPreview = summary?.watched ?? { movies: [], shows: [], total_movies: 0, total_shows: 0 };
  const friends = summary?.friends ?? [];
  const incoming = summary?.incoming_requests ?? [];
  const outgoing = summary?.outgoing_requests ?? [];
  const followers = summary?.followers ?? [];

  const watchlist = watchlistFull ?? { movies: watchlistPreview.movies, shows: watchlistPreview.shows };
  const watched = watchedFull ?? { movies: watchedPreview.movies, shows: watchedPreview.shows };

  const loading = summaryLoading || watchlistLoading || watchedLoading;

  const sendRequestMutation = useSendFriendRequest();
  const addingBackUsername =
    sendRequestMutation.isPending &&
    typeof sendRequestMutation.variables === "string"
      ? (sendRequestMutation.variables as string)
      : null;

  async function addBack(follower: { id: string; username: string }) {
    await sendRequestMutation.mutateAsync(follower.username).catch(() => {});
  }

  if (!user) {
    return (
      <div className="p-8 text-center text-neutral-400">
        You must be signed in to view your profile.
      </div>
    );
  }

  const incomingCount = incoming.length;
  const totalWatched = watchedPreview.total_movies + watchedPreview.total_shows;
  const totalWatchlist = watchlistPreview.total_movies + watchlistPreview.total_shows;
  const totalFavorites = favorites.movies.length + favorites.shows.length;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* ── Hero banner ── */}
      <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900">
        <div className="px-6 pt-8 pb-6 flex flex-col sm:flex-row items-center sm:items-end gap-5">
          <HeroAvatar avatarKey={typedDbUser?.avatar_key} photoURL={user.photoURL} />
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              {user.displayName ?? "User"}
            </h1>
            <div className="mt-1 flex items-center gap-2 justify-center sm:justify-start">
              {typedDbUser?.username ? (
                <span className="text-neutral-300 text-sm">
                  @{typedDbUser.username}
                </span>
              ) : (
                <span className="text-amber-400 text-sm">No username set</span>
              )}
            </div>
            <p className="text-neutral-400 text-sm mt-1">{user.email}</p>
            <p className="text-neutral-500 text-xs mt-0.5">
              Joined {user.metadata?.creationTime?.split("T")[0]}
            </p>
            {typedDbUser?.bio && (
              <p className="text-neutral-300 text-sm mt-2">{typedDbUser.bio}</p>
            )}
          </div>
        </div>

        {/* Quick-stat pills */}
        <div className="flex gap-px border-t border-white/10">
          {[
            { label: "Watched", value: totalWatched },
            { label: "Watchlist", value: totalWatchlist },
            { label: "Favorites", value: totalFavorites },
            { label: "Friends", value: friends.length },
          ].map(({ label, value }) => (
            <div key={label} className="flex-1 py-3 text-center">
              <p className="text-lg font-bold text-white">{value}</p>
              <p className="text-xs text-neutral-400">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: content (2/3) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Favorites */}
          {(favorites.movies.length > 0 || favorites.shows.length > 0) && (
            <div className="bg-neutral-800 rounded-xl p-4">
              <h2 className="text-base font-semibold text-white mb-3">
                Favorites
              </h2>
              {favorites.movies.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                    Movies
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {favorites.movies.map((movie) => (
                      <div key={movie.id} className="flex-shrink-0 w-28">
                        <Link to={`/movie/${movie.id}`}>
                          <img
                            src={
                              movie.poster_path
                                ? `${BASE_IMAGE_URL}/w342${movie.poster_path}`
                                : "/movie-icon.png"
                            }
                            alt={movie.title}
                            className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                          />
                          <p className="mt-1 text-xs font-medium text-neutral-300 text-center line-clamp-1">
                            {movie.title}
                          </p>
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {favorites.shows.length > 0 && (
                <div className={favorites.movies.length > 0 ? "mt-3" : ""}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                    TV Shows
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {favorites.shows.map((show) => (
                      <div key={show.id} className="flex-shrink-0 w-28">
                        <Link to={`/tv/${show.id}`}>
                          <img
                            src={
                              show.poster_path
                                ? `${BASE_IMAGE_URL}/w342${show.poster_path}`
                                : "/tv-icon.png"
                            }
                            alt={show.name}
                            className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                          />
                          <p className="mt-1 text-xs font-medium text-neutral-300 text-center line-clamp-1">
                            {show.name}
                          </p>
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Watchlist + Watched */}
          <div className="bg-neutral-800 rounded-xl overflow-hidden divide-y divide-neutral-700">
            {/* Watchlist */}
            <div>
              <button
                onClick={() => setWatchlistOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-neutral-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-white">
                    Watchlist
                  </span>
                  <span className="text-xs text-neutral-400 bg-neutral-700 px-1.5 py-0.5 rounded-full">
                    {totalWatchlist}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${watchlistOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {watchlistOpen && (
                <div className="px-4 pb-4">
                  {watchlist.movies.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                        Movies
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watchlist.movies.slice(0, 5).map((movie) => (
                          <div key={movie.id} className="flex-shrink-0 w-28">
                            <Link to={`/movie/${movie.id}`}>
                              <img
                                src={
                                  movie.poster_path
                                    ? `${BASE_IMAGE_URL}/w342${movie.poster_path}`
                                    : "/movie-icon.png"
                                }
                                alt={movie.title ?? ""}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-neutral-300 text-center line-clamp-1">
                                {movie.title}
                              </p>
                            </Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {watchlist.shows.length > 0 && (
                    <div className={watchlist.movies.length > 0 ? "mt-3" : ""}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                        TV Shows
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watchlist.shows.slice(0, 5).map((show) => (
                          <div key={show.id} className="flex-shrink-0 w-28">
                            <Link to={`/tv/${show.id}`}>
                              <img
                                src={
                                  show.poster_path
                                    ? `${BASE_IMAGE_URL}/w342${show.poster_path}`
                                    : "/tv-icon.png"
                                }
                                alt={show.name ?? ""}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-neutral-300 text-center line-clamp-1">
                                {show.name}
                              </p>
                            </Link>
                          </div>
                        ))}
                      </div>
                      <Link
                        to="/watchlist"
                        className="text-primary-400 hover:text-primary-300 text-sm mt-2 inline-block"
                      >
                        View full watchlist →
                      </Link>
                    </div>
                  )}
                  {totalWatchlist === 0 && !loading && (
                    <p className="text-neutral-400 text-sm">
                      Your watchlist is empty.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Watched */}
            <div>
              <button
                onClick={() => setWatchedOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-neutral-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-white">
                    Watched
                  </span>
                  <span className="text-xs text-neutral-400 bg-neutral-700 px-1.5 py-0.5 rounded-full">
                    {totalWatched}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${watchedOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {watchedOpen && (
                <div className="px-4 pb-4">
                  {watched.movies.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                        Movies
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watched.movies.slice(0, 5).map((movie) => (
                          <div key={movie.id} className="flex-shrink-0 w-28">
                            <Link to={`/movie/${movie.id}`}>
                              <img
                                src={
                                  movie.poster_path
                                    ? `${BASE_IMAGE_URL}/w342${movie.poster_path}`
                                    : "/movie-icon.png"
                                }
                                alt={movie.title ?? ""}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-neutral-300 text-center line-clamp-1">
                                {movie.title}
                              </p>
                            </Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {watched.shows.length > 0 && (
                    <div className={watched.movies.length > 0 ? "mt-3" : ""}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                        TV Shows
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watched.shows.slice(0, 5).map((show) => (
                          <div key={show.id} className="flex-shrink-0 w-28">
                            <Link to={`/tv/${show.id}`}>
                              <img
                                src={
                                  show.poster_path
                                    ? `${BASE_IMAGE_URL}/w342${show.poster_path}`
                                    : "/tv-icon.png"
                                }
                                alt={show.name ?? ""}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-neutral-300 text-center line-clamp-1">
                                {show.name}
                              </p>
                            </Link>
                          </div>
                        ))}
                      </div>
                      <Link
                        to="/watched"
                        className="text-primary-400 hover:text-primary-300 text-sm mt-2 inline-block"
                      >
                        View full watched list →
                      </Link>
                    </div>
                  )}
                  {totalWatched === 0 && !loading && (
                    <p className="text-neutral-400 text-sm">
                      Nothing watched yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="bg-neutral-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setStatsOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-neutral-700/50 transition-colors"
            >
              <span className="text-base font-semibold text-white">
                Stats
              </span>
              <svg
                className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {statsOpen && (
              <div className="px-4 pb-4 border-t border-neutral-700">
                <StatsSection />
              </div>
            )}
          </div>
        </div>

        {/* Right: Friends (1/3) */}
        <div className="bg-neutral-800 rounded-xl p-4">
          <h2 className="text-base font-semibold text-white mb-3">Friends</h2>

          <div className="flex gap-1 mb-4 border-b border-neutral-700 flex-wrap">
            <button
              onClick={() => setFriendsTab("friends")}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${friendsTab === "friends" ? "border-primary-500 text-primary-400" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}
            >
              Friends ({friends.length})
            </button>
            {typedDbUser?.profile_visibility === "public" && (
              <button
                onClick={() => setFriendsTab("followers")}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${friendsTab === "followers" ? "border-primary-500 text-primary-400" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}
              >
                Followers
                {followers.length > 0 && (
                  <span className="ml-1.5 bg-neutral-600 text-neutral-300 text-xs font-bold rounded-full px-1.5 py-0.5">
                    {followers.length}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => setFriendsTab("requests")}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${friendsTab === "requests" ? "border-primary-500 text-primary-400" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}
            >
              Requests
              {incomingCount > 0 && (
                <span className="ml-1.5 bg-error-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5">
                  {incomingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setFriendsTab("add")}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${friendsTab === "add" ? "border-primary-500 text-primary-400" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}
            >
              Add
            </button>
          </div>

          {friendsTab === "friends" && (
            <FriendsList
              friends={friends}
              onFriendRemoved={() => {}}
              onFindFriends={() => setFriendsTab("add")}
            />
          )}
          {friendsTab === "followers" &&
            typedDbUser?.profile_visibility === "public" && (
              <div className="space-y-2">
                {followers.length === 0 ? (
                  <p className="text-neutral-400 text-sm">No followers yet.</p>
                ) : (
                  followers.map(({ friendship_id, follower }) => (
                    <div
                      key={friendship_id}
                      className="flex items-center justify-between bg-neutral-700 px-3 py-2 rounded-lg"
                    >
                      <Link
                        to={`/user/${follower.username}`}
                        className="text-neutral-200 text-sm font-medium hover:text-primary-400 transition-colors"
                      >
                        @{follower.username}
                      </Link>
                      <button
                        onClick={() => addBack(follower)}
                        disabled={addingBackUsername === follower.username}
                        className="text-xs bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1 rounded transition-colors"
                      >
                        {addingBackUsername === follower.username ? "Adding…" : "Add back"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          {friendsTab === "requests" && (
            <FriendRequests
              incoming={incoming}
              outgoing={outgoing}
              onResponded={() => {}}
              onCancelled={() => {}}
            />
          )}
          {friendsTab === "add" && (
            <FriendSearch
              friendIds={new Set(friends.map((f) => f.friend.id))}
              onRequestSent={() => setFriendsTab("requests")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
