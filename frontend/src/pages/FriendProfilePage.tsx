import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL } from "../constants";
import ExpandableMediaList from "../components/ExpandableMediaList";
import { usePageTitle } from "../hooks/usePageTitle";

interface MediaItem {
  id: number;
  poster_path: string | null;
  title?: string;
  name?: string;
}

interface PublicProfile {
  id: string;
  username: string;
  is_friend: boolean;
  watchlist?: { movies: MediaItem[]; shows: MediaItem[] };
  watched?: { movies: MediaItem[]; shows: MediaItem[] };
}

export default function FriendProfilePage() {
  const { username } = useParams<{ username: string }>();
  const auth = getAuth(firebaseApp);

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  usePageTitle(profile ? `@${profile.username}` : undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser || !username) return;
      setLoading(true);
      setError(null);
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`${API_URL}/user/profile/${encodeURIComponent(username)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          setError("User not found.");
        } else if (!res.ok) {
          setError("Could not load profile.");
        } else {
          setProfile(await res.json());
        }
      } catch {
        setError("Network error.");
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [username]);

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading…</div>;
  }

  if (error || !profile) {
    return <div className="p-8 text-center text-slate-400">{error ?? "Something went wrong."}</div>;
  }

  const watchlist = profile.watchlist;
  const watched = profile.watched;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-6 bg-[#2d4e63] p-6 rounded-lg text-white">
        <div className="w-24 h-24 rounded-full bg-slate-600 flex items-center justify-center text-3xl font-bold text-slate-300 border-2 border-white/20">
          {profile.username[0].toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">@{profile.username}</h1>
          {!profile.is_friend && (
            <p className="text-slate-300 text-sm mt-1">
              Add this person as a friend to see their lists.
            </p>
          )}
        </div>
      </div>

      {/* Lists — only shown to friends */}
      {profile.is_friend && watchlist && watched && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Watchlist */}
          <div className="bg-slate-800 rounded-lg p-4 space-y-4">
            <h2 className="text-lg font-semibold text-white">Watchlist</h2>

            {watchlist.movies.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Movies ({watchlist.movies.length})
                </h3>
                <ExpandableMediaList
                  items={watchlist.movies}
                  linkPrefix="/movie"
                  fallbackImage="/src/assets/movie-icon.png"
                />
              </div>
            )}

            {watchlist.shows.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  TV Shows ({watchlist.shows.length})
                </h3>
                <ExpandableMediaList
                  items={watchlist.shows}
                  linkPrefix="/tv"
                  fallbackImage="/src/assets/tv-icon.png"
                />
              </div>
            )}

            {watchlist.movies.length === 0 && watchlist.shows.length === 0 && (
              <p className="text-slate-400 text-sm">Nothing on their watchlist.</p>
            )}
          </div>

          {/* Watched */}
          <div className="bg-slate-800 rounded-lg p-4 space-y-4">
            <h2 className="text-lg font-semibold text-white">Watched</h2>

            {watched.movies.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Movies ({watched.movies.length})
                </h3>
                <ExpandableMediaList
                  items={watched.movies}
                  linkPrefix="/movie"
                  fallbackImage="/src/assets/movie-icon.png"
                />
              </div>
            )}

            {watched.shows.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  TV Shows ({watched.shows.length})
                </h3>
                <ExpandableMediaList
                  items={watched.shows}
                  linkPrefix="/tv"
                  fallbackImage="/src/assets/tv-icon.png"
                />
              </div>
            )}

            {watched.movies.length === 0 && watched.shows.length === 0 && (
              <p className="text-slate-400 text-sm">Nothing watched yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
