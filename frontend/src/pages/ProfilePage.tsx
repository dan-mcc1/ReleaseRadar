import { useEffect, useState, useCallback } from "react";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL, BASE_IMAGE_URL } from "../constants";
import { Movie, Show } from "../types/calendar";
import { Link } from "react-router-dom";
import FriendSearch from "../components/FriendSearch";
import FriendRequests from "../components/FriendRequests";
import FriendsList from "../components/FriendsList";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

interface DBUser {
  id: string;
  email: string | null;
  username: string | null;
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

export default function ProfilePage() {
  const auth = getAuth(firebaseApp);
  const [user, setUser] = useState(auth.currentUser);
  const [dbUser, setDbUser] = useState<DBUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [watchlist, setWatchlist] = useState<{ movies: Movie[]; shows: Show[] }>({ movies: [], shows: [] });
  const [watched, setWatched] = useState<{ movies: Movie[]; shows: Show[] }>({ movies: [], shows: [] });
  const [loading, setLoading] = useState(true);

  // Username editing
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaving, setUsernameSaving] = useState(false);

  // Friends
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);

  async function fetchFriends(tok: string) {
    const [friendsRes, incomingRes, outgoingRes] = await Promise.all([
      fetch(`${API_URL}/friends/`, { headers: { Authorization: `Bearer ${tok}` } }),
      fetch(`${API_URL}/friends/requests/incoming`, { headers: { Authorization: `Bearer ${tok}` } }),
      fetch(`${API_URL}/friends/requests/outgoing`, { headers: { Authorization: `Bearer ${tok}` } }),
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

      const [watchlistRes, watchedRes, meRes] = await Promise.all([
        fetch(`${API_URL}/watchlist`, { headers: { Authorization: `Bearer ${tok}` } }),
        fetch(`${API_URL}/watched`, { headers: { Authorization: `Bearer ${tok}` } }),
        fetch(`${API_URL}/user/me`, { headers: { Authorization: `Bearer ${tok}` } }),
      ]);

      setWatchlist(watchlistRes.ok ? await watchlistRes.json() : { movies: [], shows: [] });
      setWatched(watchedRes.ok ? await watchedRes.json() : { movies: [], shows: [] });
      setDbUser(meRes.ok ? await meRes.json() : null);

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

  // Username availability check
  async function checkUsername(value: string) {
    if (!USERNAME_RE.test(value)) { setUsernameAvailable(null); return; }
    setUsernameChecking(true);
    try {
      const res = await fetch(`${API_URL}/user/check-username?username=${encodeURIComponent(value)}`);
      const data = await res.json();
      setUsernameAvailable(data.available);
    } catch {
      setUsernameAvailable(null);
    } finally {
      setUsernameChecking(false);
    }
  }

  function handleUsernameInput(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setNewUsername(value);
    setUsernameAvailable(null);
    setUsernameError(null);
    if (value.length >= 3) checkUsername(value);
  }

  async function saveUsername() {
    if (!USERNAME_RE.test(newUsername)) {
      setUsernameError("3–30 chars, letters/numbers/underscores only.");
      return;
    }
    if (usernameAvailable === false) {
      setUsernameError("That username is already taken.");
      return;
    }
    setUsernameSaving(true);
    setUsernameError(null);
    try {
      const res = await fetch(`${API_URL}/user/update-username`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ new_username: newUsername }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDbUser(updated);
        setEditingUsername(false);
        setNewUsername("");
      } else {
        const err = await res.json().catch(() => ({}));
        setUsernameError(err.detail ?? "Could not save username.");
      }
    } finally {
      setUsernameSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="p-8 text-center text-gray-400">
        You must be signed in to view your profile.
      </div>
    );
  }

  const incomingCount = incoming.length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* User Info */}
      <div className="flex items-center gap-6 bg-[#2d4e63] p-6 rounded-lg text-white">
        <img
          src={user.photoURL ?? "/src/assets/avatar-placeholder.png"}
          alt={user.displayName ?? "User Avatar"}
          className="w-24 h-24 rounded-full object-cover border-2 border-white/20"
        />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{user.displayName ?? "User"}</h1>

          {/* Username row */}
          {editingUsername ? (
            <div className="mt-2 flex flex-col gap-1 max-w-xs">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={newUsername}
                  onChange={handleUsernameInput}
                  placeholder="new_username"
                  className="bg-slate-700 text-slate-100 px-2 py-1 rounded text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={saveUsername}
                  disabled={usernameSaving || usernameAvailable === false}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1 rounded"
                >
                  {usernameSaving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => { setEditingUsername(false); setNewUsername(""); setUsernameError(null); }}
                  className="text-slate-400 hover:text-slate-200 text-sm"
                >
                  Cancel
                </button>
              </div>
              {newUsername.length >= 3 && (
                <p className={`text-xs pl-1 ${
                  usernameChecking ? "text-slate-400"
                  : usernameAvailable === true ? "text-green-400"
                  : usernameAvailable === false ? "text-red-400"
                  : "text-slate-400"
                }`}>
                  {usernameChecking ? "Checking…"
                    : usernameAvailable === true ? "Available"
                    : usernameAvailable === false ? "Already taken"
                    : ""}
                </p>
              )}
              {usernameError && <p className="text-red-400 text-xs pl-1">{usernameError}</p>}
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              {dbUser?.username ? (
                <span className="text-slate-300 text-sm">@{dbUser.username}</span>
              ) : (
                <span className="text-amber-400 text-sm">No username set</span>
              )}
              <button
                onClick={() => { setEditingUsername(true); setNewUsername(dbUser?.username ?? ""); }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {dbUser?.username ? "Edit" : "Set username"}
              </button>
            </div>
          )}

          <p className="text-gray-200 mt-1">{user.email}</p>
          <p className="mt-1 text-sm text-slate-300">
            Joined {user.metadata?.creationTime?.split("T")[0]}
          </p>
        </div>
      </div>

      {/* Media Lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Watchlist */}
        <div className="bg-slate-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4 text-white">Watchlist</h2>

          {watchlist.movies.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">Movies</h3>
              <div className="flex gap-4 overflow-x-auto pb-1">
                {watchlist.movies.slice(0, 5).map((movie) => (
                  <div key={movie.id} className="flex-shrink-0 w-32">
                    <Link to={`/movie/${movie.id}`}>
                      <img
                        src={movie.poster_path ? `${BASE_IMAGE_URL}/w154${movie.poster_path}` : "/src/assets/movie-icon.png"}
                        alt={movie.title}
                        className="w-full h-auto rounded-md object-cover"
                      />
                      <p className="mt-1 text-sm font-medium text-slate-200 text-center">{movie.title}</p>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {watchlist.shows.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">TV Shows</h3>
              <div className="flex gap-4 overflow-x-auto pb-1">
                {watchlist.shows.slice(0, 5).map((show) => (
                  <div key={show.id} className="flex-shrink-0 w-32">
                    <Link to={`/tv/${show.id}`}>
                      <img
                        src={show.poster_path ? `${BASE_IMAGE_URL}/w154${show.poster_path}` : "/src/assets/tv-icon.png"}
                        alt={show.name}
                        className="w-full h-auto rounded-md object-cover"
                      />
                      <p className="mt-1 text-sm font-medium text-slate-200 text-center">{show.name}</p>
                    </Link>
                  </div>
                ))}
              </div>
              <Link to="/watchlist" className="text-blue-400 hover:text-blue-300 font-medium mt-2 inline-block text-sm">
                View full watchlist →
              </Link>
            </div>
          )}

          {watchlist.movies.length === 0 && watchlist.shows.length === 0 && !loading && (
            <p className="text-slate-400 text-sm">Your watchlist is empty.</p>
          )}
        </div>

        {/* Watched */}
        <div className="bg-slate-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4 text-white">Watched</h2>

          {watched.movies.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">Movies</h3>
              <div className="flex gap-4 overflow-x-auto pb-1">
                {watched.movies.slice(0, 5).map((movie) => (
                  <div key={movie.id} className="flex-shrink-0 w-32">
                    <Link to={`/movie/${movie.id}`}>
                      <img
                        src={movie.poster_path ? `${BASE_IMAGE_URL}/w154${movie.poster_path}` : "/src/assets/movie-icon.png"}
                        alt={movie.title}
                        className="w-full h-auto rounded-md object-cover"
                      />
                      <p className="mt-1 text-sm font-medium text-slate-200 text-center">{movie.title}</p>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {watched.shows.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">TV Shows</h3>
              <div className="flex gap-4 overflow-x-auto pb-1">
                {watched.shows.slice(0, 5).map((show) => (
                  <div key={show.id} className="flex-shrink-0 w-32">
                    <Link to={`/tv/${show.id}`}>
                      <img
                        src={show.poster_path ? `${BASE_IMAGE_URL}/w154${show.poster_path}` : "/src/assets/tv-icon.png"}
                        alt={show.name}
                        className="w-full h-auto rounded-md object-cover"
                      />
                      <p className="mt-1 text-sm font-medium text-slate-200 text-center">{show.name}</p>
                    </Link>
                  </div>
                ))}
              </div>
              <Link to="/watched" className="text-blue-400 hover:text-blue-300 font-medium mt-2 inline-block text-sm">
                View full watched list →
              </Link>
            </div>
          )}

          {watched.movies.length === 0 && watched.shows.length === 0 && !loading && (
            <p className="text-slate-400 text-sm">Nothing watched yet.</p>
          )}
        </div>
      </div>

      {/* Friends Section */}
      <div className="bg-slate-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4 text-white">Friends</h2>

        {/* Tab bar */}
        <div className="flex gap-1 mb-4 border-b border-slate-700">
          <button
            onClick={() => setFriendsTab("friends")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              friendsTab === "friends"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Friends ({friends.length})
          </button>
          <button
            onClick={() => setFriendsTab("requests")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors relative ${
              friendsTab === "requests"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
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
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              friendsTab === "add"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Add Friend
          </button>
        </div>

        {/* Tab content */}
        {friendsTab === "friends" && token && (
          <FriendsList
            token={token}
            friends={friends}
            onUpdate={() => token && fetchFriends(token)}
          />
        )}

        {friendsTab === "requests" && token && (
          <FriendRequests
            token={token}
            incoming={incoming}
            outgoing={outgoing}
            onUpdate={() => token && fetchFriends(token)}
          />
        )}

        {friendsTab === "add" && token && (
          <FriendSearch
            token={token}
            onRequestSent={() => {
              if (token) fetchFriends(token);
              setFriendsTab("requests");
            }}
          />
        )}
      </div>
    </div>
  );
}
