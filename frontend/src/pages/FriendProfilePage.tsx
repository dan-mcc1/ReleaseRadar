import { useParams, Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../utils/apiFetch";
import { useAuthUser } from "../hooks/useAuthUser";
import { useFriendProfile } from "../hooks/api/useUser";
import { queryKeys } from "../hooks/api/queryKeys";
import ExpandableMediaList from "../components/ExpandableMediaList";
import { usePageTitle } from "../hooks/usePageTitle";
import { useState } from "react";
import { useBlockUser, useSubmitReport, type ReportReason } from "../hooks/api/useModeration";

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other", label: "Other" },
];

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

  const { data, isLoading, isError, error } = useFriendProfile(username);
  const profile = data && !("isSelf" in data) && !("blocked_by_viewer" in data) ? (data as PublicProfile) : null;
  const isSelf = !!(data && "isSelf" in data && data.isSelf);
  const blockedByViewer = !!(data && "blocked_by_viewer" in data && (data as any).blocked_by_viewer);

  usePageTitle(profile ? `@${profile.username}` : undefined);

  const [requesting, setRequesting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("spam");
  const [reportMessage, setReportMessage] = useState("");
  const [reportDone, setReportDone] = useState(false);
  const blockMutation = useBlockUser();
  const reportMutation = useSubmitReport();

  async function blockUser() {
    if (!profile) return;
    await blockMutation.mutateAsync(profile.id);
    setShowBlockConfirm(false);
  }

  async function submitReport() {
    if (!profile) return;
    await reportMutation.mutateAsync({
      reported_type: "user",
      reported_id: profile.id,
      reason: reportReason,
      message: reportMessage.trim() || undefined,
    });
    setReportDone(true);
  }

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

  if (blockedByViewer) {
    const blockedUsername = (data as any).username as string;
    return (
      <div className="w-full max-w-6xl mx-auto px-4 py-8">
        <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-8 text-center space-y-3">
          <p className="text-neutral-200 font-medium">You have blocked @{blockedUsername}.</p>
          <p className="text-neutral-500 text-sm">Unblock them in Settings to view their profile.</p>
        </div>
      </div>
    );
  }

  if (isError || !profile) {
    const is404 = (error as Error)?.message === "404";
    return (
      <div className="p-8 text-center text-neutral-400">
        {is404 ? "This account doesn't exist." : "Could not load profile."}
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
      <div className="bg-primary-700 rounded-lg text-white">
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
              {!profile.is_friend &&
                profile.profile_visibility === "private" && (
                  <p className="text-neutral-300 text-sm mt-1">
                    This account is private.
                  </p>
                )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
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
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                  )}
                  {profile.profile_visibility === "public"
                    ? "Follow"
                    : profile.is_followed_by_them
                      ? "Add back"
                      : "Add Friend"}
                </button>
              ))}

            {/* Block / Report menu */}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="p-2 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 rounded-lg transition-colors"
                  title="More options"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 w-44 bg-neutral-800 border border-neutral-700 rounded-xl shadow-lg z-30 overflow-hidden">
                    <button
                      onClick={() => { setMenuOpen(false); setShowBlockConfirm(true); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-700 transition-colors"
                    >
                      Block user
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); setShowReportModal(true); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-error-400 hover:bg-neutral-700 transition-colors"
                    >
                      Report user
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stats bar — only when content is visible */}
        {canSeeDetails && (
          <div className="flex gap-px border-t border-white/10 rounded-b-lg overflow-hidden">
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

      {/* Block confirm modal */}
      {showBlockConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowBlockConfirm(false)}>
          <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-semibold">Block @{profile.username}?</h3>
            <p className="text-neutral-400 text-sm">
              They won't be able to send you friend requests or recommendations, and their content won't appear to you.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowBlockConfirm(false)} className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-sm py-2 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={blockUser} disabled={blockMutation.isPending} className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium">
                {blockMutation.isPending ? "Blocking…" : "Block"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report user modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setShowReportModal(false); setReportDone(false); }}>
          <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            {reportDone ? (
              <>
                <p className="text-neutral-200 text-sm">Report submitted. Thank you for letting us know.</p>
                <button onClick={() => { setShowReportModal(false); setReportDone(false); }} className="w-full bg-neutral-700 hover:bg-neutral-600 text-neutral-200 text-sm py-2 rounded-lg transition-colors">
                  Close
                </button>
              </>
            ) : (
              <>
                <h3 className="text-white font-semibold">Report @{profile.username}</h3>
                <div className="space-y-1">
                  {REPORT_REASONS.map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer py-1">
                      <input type="radio" name="reportReason" value={value} checked={reportReason === value} onChange={() => setReportReason(value)} className="accent-highlight-500" />
                      <span className="text-neutral-300 text-sm">{label}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Additional details (optional)</label>
                  <textarea
                    value={reportMessage}
                    onChange={(e) => setReportMessage(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Describe the issue…"
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowReportModal(false)} className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-sm py-2 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button onClick={submitReport} disabled={reportMutation.isPending} className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors font-medium">
                    {reportMutation.isPending ? "Submitting…" : "Report"}
                  </button>
                </div>
              </>
            )}
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
