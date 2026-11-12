import { useParams, Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { EllipsisHorizontalIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { apiFetch } from "../utils/apiFetch";
import { useAuthUser } from "../hooks/useAuthUser";
import { useFriendProfile } from "../hooks/api/useUser";
import { useRemoveFriend } from "../hooks/api/useFriends";
import { queryKeys } from "../hooks/api/queryKeys";
import { usePageTitle } from "../hooks/usePageTitle";
import { useEffect, useRef, useState } from "react";
import { useBlockUser } from "../hooks/api/useModeration";
import { Modal } from "../components/ui";
import ReportModal from "../components/ReportModal";
import {
  Button,
  ButtonLink,
  CheckIcon,
  CloseIcon,
  EmptyState,
  IconButton,
  PageHeader,
  PlusIcon,
  PosterCard,
  SectionHeader,
} from "../components/ui";

interface MediaItem {
  id: number;
  poster_path: string | null;
  title?: string;
  name?: string;
}

interface FriendUser {
  id: string;
  username: string;
  display_name: string | null;
}

interface PublicProfile {
  id: string;
  username: string;
  display_name: string | null;
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

function usernameToHue(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = (h * 31 + username.charCodeAt(i)) % 360;
  }
  return h;
}

function PosterThumb({ item, type }: { item: MediaItem; type: "movie" | "tv" }) {
  return (
    <PosterCard
      to={type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`}
      title={item.title ?? item.name ?? ""}
      posterPath={item.poster_path}
    />
  );
}

function PosterSection({
  label,
  items,
  type,
  cols = 5,
}: {
  label: string;
  items: MediaItem[];
  type: "movie" | "tv";
  cols?: number;
}) {
  if (items.length === 0) return null;
  const preview = items.slice(0, cols);
  return (
    <div>
      <div className="text-label font-medium text-neutral-400 mb-3">
        {label} · {items.length}
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {preview.map((item) => (
          <PosterThumb key={item.id} item={item} type={type} />
        ))}
      </div>
    </div>
  );
}

export default function FriendProfilePage() {
  const { username } = useParams<{ username: string }>();
  const user = useAuthUser();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useFriendProfile(username);
  const profile = data && !("isSelf" in data) && !("blocked_by_viewer" in data) ? (data as PublicProfile) : null;
  const isSelf = !!(data && "isSelf" in data && data.isSelf);
  const blockedByViewer = !!(data && "blocked_by_viewer" in data && (data as { blocked_by_viewer: boolean }).blocked_by_viewer);

  usePageTitle(profile ? `@${profile.username}` : undefined);

  const [requesting, setRequesting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showUnfriendConfirm, setShowUnfriendConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  // The actions menu closes on a tap or click outside it, or Escape (it
  // also shows on touch, where there's no mouse to leave it).
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const blockMutation = useBlockUser();
  const removeFriendMutation = useRemoveFriend();

  async function blockUser() {
    if (!profile) return;
    await blockMutation.mutateAsync(profile.id);
    setShowBlockConfirm(false);
  }

  async function unfriend() {
    if (!profile) return;
    await removeFriendMutation.mutateAsync(profile.id);
    setShowUnfriendConfirm(false);
    if (username)
      await queryClient.invalidateQueries({ queryKey: queryKeys.friendProfile(username) });
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
    await queryClient.invalidateQueries({ queryKey: queryKeys.friendProfile(username) });
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
          setProfileData((p) => ({ ...p, is_following: true, following_id: resData.id, pending_request_id: null }));
        } else if (resData.status === "accepted") {
          await refetchProfile();
        } else {
          setProfileData((p) => ({ ...p, pending_request_id: resData.id }));
        }
        if (user) queryClient.invalidateQueries({ queryKey: queryKeys.friendRequestsOutgoing(user.uid) });
      }
    } finally {
      setRequesting(false);
    }
  }

  async function cancelRequest() {
    if (!profile?.pending_request_id || requesting) return;
    setRequesting(true);
    try {
      const res = await apiFetch(`/friends/cancel/${profile.pending_request_id}`, { method: "DELETE" });
      if (res.ok) {
        setProfileData((p) => ({ ...p, pending_request_id: null }));
        if (user) queryClient.invalidateQueries({ queryKey: queryKeys.friendRequestsOutgoing(user.uid) });
      }
    } finally {
      setRequesting(false);
    }
  }

  async function unfollow() {
    if (!profile?.following_id || requesting) return;
    setRequesting(true);
    try {
      const res = await apiFetch(`/friends/cancel/${profile.following_id}`, { method: "DELETE" });
      if (res.ok) setProfileData((p) => ({ ...p, is_following: false, following_id: null }));
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
        body: JSON.stringify({ friendship_id: profile.incoming_request_id, accept }),
      });
      if (res.ok) {
        if (accept) {
          await refetchProfile();
        } else {
          setProfileData((p) => ({ ...p, incoming_request_id: null }));
        }
        if (user) {
          queryClient.invalidateQueries({ queryKey: queryKeys.friendRequestsIncoming(user.uid) });
          queryClient.invalidateQueries({ queryKey: queryKeys.navCounts(user.uid) });
          if (accept) queryClient.invalidateQueries({ queryKey: queryKeys.friends(user.uid) });
        }
      }
    } finally {
      setRequesting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="w-full">
        <div className="h-[220px] border-b border-neutral-800 animate-pulse bg-neutral-800/40" />
        <div className="px-6 sm:px-10 py-8">
          <div className="h-4 w-48 rounded-full bg-neutral-800 animate-pulse mb-3" />
          <div className="h-4 w-96 rounded-full bg-neutral-800 animate-pulse" />
        </div>
      </div>
    );
  }

  if (isSelf) return <Navigate to="/profile" replace />;

  if (blockedByViewer) {
    const blockedUsername = (data as { username: string }).username;
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-16">
        <EmptyState
          title={`You have blocked @${blockedUsername}.`}
          description="Unblock them in Settings to view their profile."
          action={<ButtonLink to="/settings">Open settings</ButtonLink>}
        />
      </div>
    );
  }

  if (isError || !profile) {
    const is404 = (error as Error)?.message === "404";
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-16">
        <EmptyState title={is404 ? "This account doesn't exist." : "Could not load profile."} />
      </div>
    );
  }

  const hue = usernameToHue(profile.username);
  const heroName = profile.display_name || profile.username;
  const initials = (profile.display_name?.trim()?.[0] ?? profile.username[0]).toUpperCase();
  const favorites = profile.favorites;
  const watchlist = profile.watchlist;
  const watched = profile.watched;
  const friends = profile.friends ?? [];

  const canSeeDetails =
    (profile.is_friend || profile.profile_visibility === "public") &&
    profile.profile_visibility !== "private";

  const totalWatched = canSeeDetails ? (watched?.movies.length ?? 0) + (watched?.shows.length ?? 0) : null;
  const totalWatchlist = canSeeDetails ? (watchlist?.movies.length ?? 0) + (watchlist?.shows.length ?? 0) : null;
  const totalFavorites = canSeeDetails ? (favorites?.movies.length ?? 0) + (favorites?.shows.length ?? 0) : null;

  const relationLabel = profile.is_friend
    ? "Friends"
    : profile.is_following
      ? "Following"
      : profile.profile_visibility === "public"
        ? "Public profile"
        : "Friends only";

  const countsLine = canSeeDetails
    ? `${totalWatched ?? 0} watched · ${totalWatchlist ?? 0} on their watchlist · ${totalFavorites ?? 0} favorites · ${friends.length} ${friends.length === 1 ? "friend" : "friends"}`
    : null;

  const addLabel = profile.profile_visibility === "public" ? "Follow" : profile.is_followed_by_them ? "Add back" : "Add friend";

  return (
    <div className="w-full">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-7 px-5 sm:px-10 pt-8 sm:pt-10 pb-6 sm:pb-8 border-b border-neutral-800">
        {/* Avatar */}
        <div
          className="shrink-0 rounded-full flex items-center justify-center size-[72px] sm:size-[100px] text-heading sm:text-display font-bold text-white/90"
          style={{
            background: `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.38 0.14 ${(hue + 40) % 360}))`,
            boxShadow: "0 0 0 4px rgba(255,255,255,0.07)",
            letterSpacing: "-0.02em",
          }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <PageHeader
            title={heroName}
            description={`@${profile.username} · ${relationLabel}`}
            actions={
              <>
                {!profile.is_friend && (
                  profile.incoming_request_id ? (
                    <>
                      <Button
                        variant="primary"
                        onClick={() => respondToRequest(true)}
                        disabled={requesting}
                        loading={requesting}
                      >
                        Accept
                      </Button>
                      <Button onClick={() => respondToRequest(false)} disabled={requesting}>
                        Decline
                      </Button>
                    </>
                  ) : profile.is_following ? (
                    <Button
                      onClick={unfollow}
                      disabled={requesting}
                      loading={requesting}
                      icon={<CheckIcon className="w-4 h-4" />}
                    >
                      Following
                    </Button>
                  ) : profile.pending_request_id ? (
                    <Button
                      onClick={cancelRequest}
                      disabled={requesting}
                      loading={requesting}
                      icon={<CloseIcon className="w-4 h-4" />}
                    >
                      Request sent
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={sendRequest}
                      disabled={requesting}
                      loading={requesting}
                      icon={<PlusIcon className="w-4 h-4" />}
                    >
                      {addLabel}
                    </Button>
                  )
                )}

                {user && (
                  <div ref={menuRef} className="relative">
                    <IconButton
                      variant="secondary"
                      shape="square"
                      label="More actions"
                      aria-expanded={menuOpen}
                      icon={<EllipsisHorizontalIcon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />}
                      onClick={() => setMenuOpen((v) => !v)}
                    />
                    {menuOpen && (
                      <div
                        className="absolute right-0 mt-1 w-44 bg-neutral-900 border border-neutral-800 rounded-control shadow-xl z-30 overflow-hidden"
                      >
                        {profile.is_friend && (
                          <button
                            onClick={() => { setMenuOpen(false); setShowUnfriendConfirm(true); }}
                            className="w-full text-left px-4 py-2.5 text-body text-neutral-300 hover:bg-neutral-800 transition-colors"
                          >
                            Unfriend
                          </button>
                        )}
                        <button
                          onClick={() => { setMenuOpen(false); setShowBlockConfirm(true); }}
                          className="w-full text-left px-4 py-2.5 text-body text-neutral-300 hover:bg-neutral-800 transition-colors"
                        >
                          Block user
                        </button>
                        <button
                          onClick={() => { setMenuOpen(false); setShowReportModal(true); }}
                          className="w-full text-left px-4 py-2.5 text-body text-error-400 hover:bg-neutral-800 transition-colors"
                        >
                          Report user
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            }
          />
          {profile.bio && (
            <p className="text-body text-neutral-300 mt-3 mb-0 max-w-xl">{profile.bio}</p>
          )}
          {countsLine && <p className="text-body text-neutral-400 mt-3 mb-0">{countsLine}</p>}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      {canSeeDetails ? (
        <div className="px-6 sm:px-10 py-8">
          <div className="grid gap-8 items-start grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
            {/* ── Left column ── */}
            <div className="flex flex-col gap-8">
              {/* Favorites */}
              {favorites && (favorites.movies.length > 0 || favorites.shows.length > 0) && (
                <section>
                  <SectionHeader
                    title="Favorites"
                    note={String((favorites.movies.length ?? 0) + (favorites.shows.length ?? 0))}
                    className="mb-4"
                  />
                  <div className="space-y-6">
                    <PosterSection label="TV shows" items={favorites.shows} type="tv" cols={8} />
                    <PosterSection label="Movies" items={favorites.movies} type="movie" cols={8} />
                  </div>
                </section>
              )}

              {/* Watchlist + Watched */}
              {watchlist && watched && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <ListBlock
                    title="Watchlist"
                    movies={watchlist.movies}
                    shows={watchlist.shows}
                  />
                  <ListBlock
                    title="Watched"
                    movies={watched.movies}
                    shows={watched.shows}
                  />
                </div>
              )}
            </div>

            {/* ── Right sidebar ── */}
            <div className="flex flex-col gap-8 lg:sticky lg:top-24">
              {/* About */}
              <section>
                <SectionHeader title="About" className="mb-4" />
                <div className="grid gap-y-2.5 gap-x-3 text-label" style={{ gridTemplateColumns: "80px 1fr" }}>
                  <span className="text-caption text-neutral-400">Visibility</span>
                  <span className="font-medium text-neutral-200 flex items-center gap-1.5">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${profile.profile_visibility === "public" ? "bg-success-400" : "bg-neutral-500"}`}
                    />
                    {profile.profile_visibility === "public" ? "Public" : "Friends only"}
                  </span>
                  <span className="text-caption text-neutral-400">Relationship</span>
                  <span className="font-medium text-neutral-200">
                    {profile.is_friend ? "Friends" : profile.is_following ? "Following" : "—"}
                  </span>
                </div>
              </section>

              {/* Friends */}
              {friends.length > 0 && (
                <section>
                  <SectionHeader title="Friends" note={String(friends.length)} className="mb-4" />
                  <div className="flex flex-col gap-2.5">
                    {friends.slice(0, 8).map(({ friendship_id, friend }) => (
                      <Link
                        key={friendship_id}
                        to={`/user/${friend.username}`}
                        className="flex items-center gap-2.5 group"
                      >
                        <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-caption font-bold text-neutral-300 flex-shrink-0 group-hover:bg-neutral-600 transition-colors">
                          {(friend.display_name?.[0] ?? friend.username[0]).toUpperCase()}
                        </div>
                        <span className="text-label text-neutral-300 group-hover:text-neutral-100 transition-colors font-medium truncate">
                          {friend.display_name || `@${friend.username}`}
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Moderation actions */}
              {user && (
                <div className="flex gap-2">
                  {profile.is_friend && (
                    <Button size="sm" onClick={() => setShowUnfriendConfirm(true)} className="flex-1">
                      Unfriend
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setShowBlockConfirm(true)} className="flex-1">
                    Block
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setShowReportModal(true)} className="flex-1">
                    Report
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-6 sm:px-10 py-16 flex justify-center">
          <div className="w-full max-w-md flex flex-col items-center">
            <LockClosedIcon className="w-6 h-6 text-neutral-400" strokeWidth={1.5} aria-hidden="true" />
            <EmptyState
              className="py-4"
              title={
                profile.profile_visibility === "private"
                  ? "This account is private."
                  : "Add this person as a friend to see their lists."
              }
              description={
                profile.profile_visibility === "private"
                  ? "Only they can see their activity."
                  : "Their watchlist, watched, and favorites are only visible to friends."
              }
              action={
                <>
                  {!profile.is_friend && !profile.is_following && !profile.pending_request_id && profile.profile_visibility !== "private" && (
                    <Button
                      variant="primary"
                      onClick={sendRequest}
                      disabled={requesting}
                      loading={requesting}
                      icon={<PlusIcon className="w-4 h-4" />}
                    >
                      {profile.is_followed_by_them ? "Add back" : "Add friend"}
                    </Button>
                  )}
                  {user && (
                    <>
                      <Button variant="ghost" onClick={() => setShowBlockConfirm(true)}>
                        Block
                      </Button>
                      <Button variant="ghost" onClick={() => setShowReportModal(true)}>
                        Report
                      </Button>
                    </>
                  )}
                </>
              }
            />
          </div>
        </div>
      )}

      {/* ── Block modal ─────────────────────────────────────────── */}
      {showBlockConfirm && (
        <Modal
          open
          onClose={() => setShowBlockConfirm(false)}
          size="sm"
          title={<>Block @{profile.username}?</>}
          footer={
            <>
            <Button onClick={() => setShowBlockConfirm(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={blockUser}
              disabled={blockMutation.isPending}
              className="flex-1"
            >
              {blockMutation.isPending ? "Blocking…" : "Block"}
            </Button>
            </>
          }
        >
          <p className="text-neutral-400 text-body">
            They won't be able to send you friend requests or recommendations, and their content won't appear to you.
          </p>
        </Modal>
      )}

      {/* ── Unfriend modal ──────────────────────────────────────── */}
      {showUnfriendConfirm && (
        <Modal
          open
          onClose={() => setShowUnfriendConfirm(false)}
          size="sm"
          title={<>Unfriend @{profile.username}?</>}
          footer={
            <>
            <Button onClick={() => setShowUnfriendConfirm(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={unfriend}
              disabled={removeFriendMutation.isPending}
              className="flex-1"
            >
              {removeFriendMutation.isPending ? "Removing…" : "Unfriend"}
            </Button>
            </>
          }
        >
          <p className="text-neutral-400 text-body">
            You'll lose access to their private lists and they'll be removed from your friends.
          </p>
        </Modal>
      )}

      {/* ── Report modal ────────────────────────────────────────── */}
      {showReportModal && (
        <ReportModal
          reportedType="user"
          reportedId={profile.id}
          label={`@${profile.username}`}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
}

function ListBlock({
  title,
  movies,
  shows,
}: {
  title: string;
  movies: MediaItem[];
  shows: MediaItem[];
}) {
  const total = movies.length + shows.length;
  const preview = [...shows, ...movies].slice(0, 4);
  return (
    <section>
      <SectionHeader title={title} note={String(total)} className="mb-4" />
      {total > 0 ? (
        <div className="grid grid-cols-4 gap-2.5">
          {preview.map((item) => {
            const isMovie = movies.some((m) => m.id === item.id);
            return <PosterThumb key={item.id} item={item} type={isMovie ? "movie" : "tv"} />;
          })}
        </div>
      ) : (
        <p className="text-neutral-500 text-body">Nothing here yet.</p>
      )}
    </section>
  );
}
