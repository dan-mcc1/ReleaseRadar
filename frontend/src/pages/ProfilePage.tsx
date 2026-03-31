import { useEffect, useState, useCallback } from "react";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL, BASE_IMAGE_URL, getAvatarColor } from "../constants";
import { Movie, Show } from "../types/calendar";
import { Link } from "react-router-dom";
import FriendSearch from "../components/FriendSearch";
import FriendRequests from "../components/FriendRequests";
import FriendsList from "../components/FriendsList";
import StatsSection from "../components/StatsSection";
import { usePageTitle } from "../hooks/usePageTitle";

interface DBUser {
  id: string;
  email: string | null;
  username: string | null;
  avatar_key: string | null;
}

interface FriendEntry {
  friendship_id: number;
  friend: { id: string; username: string; email: string };
}

interface IncomingRequest {
  friendship_id: number;
  from_user: { id: string; username: string; email: string };
  created_at: string;
}

interface OutgoingRequest {
  friendship_id: number;
  to_user: { id: string; username: string; email: string };
  created_at: string;
}

type FriendsTab = "friends" | "requests" | "add";

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
  const auth = getAuth(firebaseApp);
  const [user, setUser] = useState(auth.currentUser);
  const [dbUser, setDbUser] = useState<DBUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [watchlist, setWatchlist] = useState<{
    movies: Movie[];
    shows: Show[];
  }>({ movies: [], shows: [] });
  const [watched, setWatched] = useState<{ movies: Movie[]; shows: Show[] }>({
    movies: [],
    shows: [],
  });
  const [favorites, setFavorites] = useState<{
    movies: Movie[];
    shows: Show[];
  }>({ movies: [], shows: [] });
  const [loading, setLoading] = useState(true);

  // Collapsible sections
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [watchedOpen, setWatchedOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  // Friends
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);

  async function fetchFriends(tok: string) {
    const [friendsRes, incomingRes, outgoingRes] = await Promise.all([
      fetch(`${API_URL}/friends/`, {
        headers: { Authorization: `Bearer ${tok}` },
      }),
      fetch(`${API_URL}/friends/requests/incoming`, {
        headers: { Authorization: `Bearer ${tok}` },
      }),
      fetch(`${API_URL}/friends/requests/outgoing`, {
        headers: { Authorization: `Bearer ${tok}` },
      }),
    ]);
    setFriends(friendsRes.ok ? await friendsRes.json() : []);
    setIncoming(incomingRes.ok ? await incomingRes.json() : []);
    setOutgoing(outgoingRes.ok ? await outgoingRes.json() : []);
  }

  const fetchAll = useCallback(async (firebaseUser: User) => {
    setLoading(true);
    try {
      const tok = await firebaseUser.getIdToken();
      setToken(tok);

      const [watchlistRes, watchedRes, meRes, favoritesRes] = await Promise.all(
        [
          fetch(`${API_URL}/watchlist`, {
            headers: { Authorization: `Bearer ${tok}` },
          }),
          fetch(`${API_URL}/watched`, {
            headers: { Authorization: `Bearer ${tok}` },
          }),
          fetch(`${API_URL}/user/me`, {
            headers: { Authorization: `Bearer ${tok}` },
          }),
          fetch(`${API_URL}/favorites`, {
            headers: { Authorization: `Bearer ${tok}` },
          }),
        ],
      );

      setWatchlist(
        watchlistRes.ok ? await watchlistRes.json() : { movies: [], shows: [] },
      );
      setWatched(
        watchedRes.ok ? await watchedRes.json() : { movies: [], shows: [] },
      );
      setDbUser(meRes.ok ? await meRes.json() : null);
      setFavorites(
        favoritesRes.ok ? await favoritesRes.json() : { movies: [], shows: [] },
      );

      await fetchFriends(tok);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) fetchAll(firebaseUser);
    });
    return () => unsubscribe();
  }, [fetchAll]);

  // Refresh friend requests when a new one arrives via SSE (NavBar broadcasts this event)
  useEffect(() => {
    function handler() {
      if (token) fetchFriends(token);
    }
    window.addEventListener("friend-request-received", handler);
    return () => window.removeEventListener("friend-request-received", handler);
  }, [token]);

  if (!user) {
    return (
      <div className="p-8 text-center text-gray-400">
        You must be signed in to view your profile.
      </div>
    );
  }

  const incomingCount = incoming.length;
  const totalWatched = watched.movies.length + watched.shows.length;
  const totalWatchlist = watchlist.movies.length + watchlist.shows.length;
  const totalFavorites = favorites.movies.length + favorites.shows.length;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* ── Hero banner ── */}
      <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-[#1f3b4d] via-[#2d4e63] to-[#1a3040]">
        <div className="px-6 pt-8 pb-6 flex flex-col sm:flex-row items-center sm:items-end gap-5">
          <HeroAvatar avatarKey={dbUser?.avatar_key} photoURL={user.photoURL} />
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              {user.displayName ?? "User"}
            </h1>
            <div className="mt-1 flex items-center gap-2 justify-center sm:justify-start">
              {dbUser?.username ? (
                <span className="text-slate-300 text-sm">
                  @{dbUser.username}
                </span>
              ) : (
                <span className="text-amber-400 text-sm">No username set</span>
              )}
            </div>
            <p className="text-slate-400 text-sm mt-1">{user.email}</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Joined {user.metadata?.creationTime?.split("T")[0]}
            </p>
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
              <p className="text-xs text-slate-400">{label}</p>
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
            <div className="bg-slate-800 rounded-xl p-4">
              <h2 className="text-base font-semibold text-white mb-3">
                Favorites
              </h2>
              {favorites.movies.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Movies
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {favorites.movies.map((movie) => (
                      <div key={movie.id} className="flex-shrink-0 w-28">
                        <Link to={`/movie/${movie.id}`}>
                          <img
                            src={
                              movie.poster_path
                                ? `${BASE_IMAGE_URL}/w154${movie.poster_path}`
                                : "/movie-icon.png"
                            }
                            alt={movie.title}
                            className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                          />
                          <p className="mt-1 text-xs font-medium text-slate-300 text-center line-clamp-1">
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
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    TV Shows
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {favorites.shows.map((show) => (
                      <div key={show.id} className="flex-shrink-0 w-28">
                        <Link to={`/tv/${show.id}`}>
                          <img
                            src={
                              show.poster_path
                                ? `${BASE_IMAGE_URL}/w154${show.poster_path}`
                                : "/tv-icon.png"
                            }
                            alt={show.name}
                            className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                          />
                          <p className="mt-1 text-xs font-medium text-slate-300 text-center line-clamp-1">
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
          <div className="bg-slate-800 rounded-xl overflow-hidden divide-y divide-slate-700">
            {/* Watchlist */}
            <div>
              <button
                onClick={() => setWatchlistOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-white">
                    Watchlist
                  </span>
                  <span className="text-xs text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded-full">
                    {totalWatchlist}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${watchlistOpen ? "rotate-180" : ""}`}
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
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        Movies
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watchlist.movies.slice(0, 5).map((movie) => (
                          <div key={movie.id} className="flex-shrink-0 w-28">
                            <Link to={`/movie/${movie.id}`}>
                              <img
                                src={
                                  movie.poster_path
                                    ? `${BASE_IMAGE_URL}/w154${movie.poster_path}`
                                    : "/movie-icon.png"
                                }
                                alt={movie.title}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-slate-300 text-center line-clamp-1">
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
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        TV Shows
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watchlist.shows.slice(0, 5).map((show) => (
                          <div key={show.id} className="flex-shrink-0 w-28">
                            <Link to={`/tv/${show.id}`}>
                              <img
                                src={
                                  show.poster_path
                                    ? `${BASE_IMAGE_URL}/w154${show.poster_path}`
                                    : "/tv-icon.png"
                                }
                                alt={show.name}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-slate-300 text-center line-clamp-1">
                                {show.name}
                              </p>
                            </Link>
                          </div>
                        ))}
                      </div>
                      <Link
                        to="/watchlist"
                        className="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block"
                      >
                        View full watchlist →
                      </Link>
                    </div>
                  )}
                  {totalWatchlist === 0 && !loading && (
                    <p className="text-slate-400 text-sm">
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
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-white">
                    Watched
                  </span>
                  <span className="text-xs text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded-full">
                    {totalWatched}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${watchedOpen ? "rotate-180" : ""}`}
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
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        Movies
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watched.movies.slice(0, 5).map((movie) => (
                          <div key={movie.id} className="flex-shrink-0 w-28">
                            <Link to={`/movie/${movie.id}`}>
                              <img
                                src={
                                  movie.poster_path
                                    ? `${BASE_IMAGE_URL}/w154${movie.poster_path}`
                                    : "/movie-icon.png"
                                }
                                alt={movie.title}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-slate-300 text-center line-clamp-1">
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
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        TV Shows
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {watched.shows.slice(0, 5).map((show) => (
                          <div key={show.id} className="flex-shrink-0 w-28">
                            <Link to={`/tv/${show.id}`}>
                              <img
                                src={
                                  show.poster_path
                                    ? `${BASE_IMAGE_URL}/w154${show.poster_path}`
                                    : "/tv-icon.png"
                                }
                                alt={show.name}
                                className="w-full h-auto rounded-lg object-cover hover:opacity-80 transition-opacity"
                              />
                              <p className="mt-1 text-xs font-medium text-slate-300 text-center line-clamp-1">
                                {show.name}
                              </p>
                            </Link>
                          </div>
                        ))}
                      </div>
                      <Link
                        to="/watched"
                        className="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block"
                      >
                        View full watched list →
                      </Link>
                    </div>
                  )}
                  {totalWatched === 0 && !loading && (
                    <p className="text-slate-400 text-sm">
                      Nothing watched yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          {token && (
            <div className="bg-slate-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setStatsOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-700/50 transition-colors"
              >
                <span className="text-base font-semibold text-white">
                  Stats
                </span>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${statsOpen ? "rotate-180" : ""}`}
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
                <div className="px-4 pb-4 border-t border-slate-700">
                  <StatsSection token={token} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Friends (1/3) */}
        <div className="bg-slate-800 rounded-xl p-4">
          <h2 className="text-base font-semibold text-white mb-3">Friends</h2>

          <div className="flex gap-1 mb-4 border-b border-slate-700">
            <button
              onClick={() => setFriendsTab("friends")}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${friendsTab === "friends" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              Friends ({friends.length})
            </button>
            <button
              onClick={() => setFriendsTab("requests")}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${friendsTab === "requests" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              Requests
              {incomingCount > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5">
                  {incomingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setFriendsTab("add")}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${friendsTab === "add" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              Add
            </button>
          </div>

          {friendsTab === "friends" && token && (
            <FriendsList
              token={token}
              friends={friends}
              onFriendRemoved={(friendId) =>
                setFriends((prev) => prev.filter((f) => f.friend.id !== friendId))
              }
            />
          )}
          {friendsTab === "requests" && token && (
            <FriendRequests
              token={token}
              incoming={incoming}
              outgoing={outgoing}
              onResponded={(friendshipId, accepted, req) => {
                setIncoming((prev) => prev.filter((r) => r.friendship_id !== friendshipId));
                if (accepted) {
                  setFriends((prev) => [
                    ...prev,
                    { friendship_id: friendshipId, friend: req.from_user },
                  ]);
                }
              }}
              onCancelled={(friendshipId) =>
                setOutgoing((prev) => prev.filter((r) => r.friendship_id !== friendshipId))
              }
            />
          )}
          {friendsTab === "add" && token && (
            <FriendSearch
              token={token}
              friendIds={new Set(friends.map((f) => f.friend.id))}
              onRequestSent={() => {
                if (token) fetchFriends(token);
                setFriendsTab("requests");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
