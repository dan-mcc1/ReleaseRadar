import { useParams, Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../utils/apiFetch";
import { useAuthUser } from "../hooks/useAuthUser";
import { useFriendProfile } from "../hooks/api/useUser";
import { useRemoveFriend } from "../hooks/api/useFriends";
import { queryKeys } from "../hooks/api/queryKeys";
import { BASE_IMAGE_URL } from "../constants";
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

function usernameToHue(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = (h * 31 + username.charCodeAt(i)) % 360;
  }
  return h;
}

function SectionHead({
  eyebrow,
  title,
  count,
  cta,
  ctaTo,
}: {
  eyebrow: string;
  title: string;
  count?: number;
  cta?: string;
  ctaTo?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      {eyebrow && (
        <span className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase">
          {eyebrow}
        </span>
      )}
      <h2 className="m-0 font-light italic text-[22px] tracking-tight text-neutral-100 leading-none">
        {title}
      </h2>
      {count !== undefined && (
        <span className="font-mono text-[11px] text-neutral-500">· {count}</span>
      )}
      <span className="flex-1" />
      {cta && ctaTo && (
        <Link
          to={ctaTo}
          className="text-[12.5px] text-neutral-400 hover:text-neutral-200 font-medium transition-colors"
        >
          {cta} →
        </Link>
      )}
    </div>
  );
}

function PosterThumb({ item, type }: { item: MediaItem; type: "movie" | "tv" }) {
  const label = item.title ?? item.name ?? "";
  const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`;
  const fallback = type === "movie" ? "/movie-icon.png" : "/tv-icon.png";
  return (
    <Link to={href} className="group block">
      <div className="rounded-xl overflow-hidden aspect-[2/3] bg-neutral-800">
        <img
          src={item.poster_path ? `${BASE_IMAGE_URL}/w185${item.poster_path}` : fallback}
          alt={label}
          className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
        />
      </div>
      <p className="mt-1.5 text-[11.5px] font-medium text-neutral-400 text-center line-clamp-1">
        {label}
      </p>
    </Link>
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
      <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-3">
        {label} · {items.length}
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.min(preview.length, cols)}, 1fr)` }}
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
  const [reportReason, setReportReason] = useState<ReportReason>("spam");
  const [reportMessage, setReportMessage] = useState("");
  const [reportDone, setReportDone] = useState(false);

  const blockMutation = useBlockUser();
  const reportMutation = useSubmitReport();
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
        <div className="relative overflow-hidden border-b border-neutral-800" style={{ background: "#111", height: 220 }}>
          <div className="absolute inset-0 animate-pulse bg-neutral-800/40" />
        </div>
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
      <div className="w-full max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-10 space-y-3">
          <p className="text-neutral-200 font-medium">You have blocked @{blockedUsername}.</p>
          <p className="text-neutral-500 text-sm">Unblock them in Settings to view their profile.</p>
        </div>
      </div>
    );
  }

  if (isError || !profile) {
    const is404 = (error as Error)?.message === "404";
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-10">
          <p className="text-neutral-400">
            {is404 ? "This account doesn't exist." : "Could not load profile."}
          </p>
        </div>
      </div>
    );
  }

  const hue = usernameToHue(profile.username);
  const initials = profile.username[0].toUpperCase();
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

  const statStrip = canSeeDetails
    ? [
        { label: "Watched",   value: totalWatched ?? 0 },
        { label: "Watchlist", value: totalWatchlist ?? 0 },
        { label: "Favorites", value: totalFavorites ?? 0 },
        { label: "Friends",   value: friends.length },
      ]
    : [];

  return (
    <div className="w-full">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div
        className="relative border-b border-neutral-800"
        style={{ background: "#111" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(80% 70% at 80% 0%, oklch(0.28 0.12 ${hue}) 0%, transparent 65%), radial-gradient(60% 70% at 10% 80%, oklch(0.20 0.08 ${hue} / 0.5) 0%, transparent 70%)`,
            opacity: 0.65,
          }}
        />
        <svg
          viewBox="0 0 600 400"
          className="absolute pointer-events-none overflow-hidden"
          style={{ right: -80, top: -80, width: 600, height: 400, opacity: 0.1, clipPath: "inset(0)" }}
        >
          {[60, 110, 160, 210, 260].map((r) => (
            <circle key={r} cx="400" cy="200" r={r} stroke="#10b981" strokeWidth="0.8" fill="none" />
          ))}
        </svg>

        <div
          className="relative items-end gap-7 px-6 sm:px-10 pt-10 pb-8 hidden sm:grid"
          style={{ gridTemplateColumns: "100px 1fr auto" }}
        >
          {/* Avatar */}
          <div
            className="shrink-0 rounded-full flex items-center justify-center text-[36px] font-bold text-white/90"
            style={{
              width: 100, height: 100,
              background: `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.38 0.14 ${(hue + 40) % 360}))`,
              boxShadow: "0 16px 40px rgba(0,0,0,0.4), 0 0 0 4px rgba(255,255,255,0.07)",
              letterSpacing: "-0.02em",
            }}
          >
            {initials}
          </div>

          {/* Identity */}
          <div className="min-w-0">
            <div className="font-mono text-[11px] tracking-[0.15em] text-primary-400 uppercase mb-2">
              {profile.is_friend ? "◉ Friends" : profile.is_following ? "◎ Following" : profile.profile_visibility === "public" ? "◎ Public profile" : "◌ Friends only"}
            </div>
            <div className="flex items-baseline gap-4 flex-wrap">
              <h1 className="m-0 font-light italic text-[48px] tracking-[-0.025em] leading-none text-neutral-100">
                {profile.username}
              </h1>
              <span className="font-mono text-[13px] text-neutral-500 tracking-[0.02em]">
                @{profile.username}
              </span>
            </div>
            {profile.bio && (
              <p className="italic text-[15.5px] leading-snug tracking-[-0.005em] text-neutral-300 mt-3 mb-0 max-w-xl">
                {profile.bio}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              {!profile.is_friend && (
                profile.incoming_request_id ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondToRequest(true)}
                      disabled={requesting}
                      className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
                    >
                      {requesting ? <Spinner /> : null}
                      Accept
                    </button>
                    <button
                      onClick={() => respondToRequest(false)}
                      disabled={requesting}
                      className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50 text-neutral-300 text-sm font-medium px-4 py-2 rounded-xl transition-colors"
                    >
                      Decline
                    </button>
                  </div>
                ) : profile.is_following ? (
                  <button
                    onClick={unfollow}
                    disabled={requesting}
                    className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50 text-neutral-300 text-sm font-medium px-4 py-2 rounded-xl transition-colors"
                  >
                    {requesting ? <Spinner /> : <CheckIcon />}
                    Following
                  </button>
                ) : profile.pending_request_id ? (
                  <button
                    onClick={cancelRequest}
                    disabled={requesting}
                    className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50 text-neutral-300 text-sm font-medium px-4 py-2 rounded-xl transition-colors"
                  >
                    {requesting ? <Spinner /> : <XIcon />}
                    Request Sent
                  </button>
                ) : (
                  <button
                    onClick={sendRequest}
                    disabled={requesting}
                    className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
                  >
                    {requesting ? <Spinner /> : <PlusIcon />}
                    {profile.profile_visibility === "public" ? "Follow" : profile.is_followed_by_them ? "Add back" : "Add Friend"}
                  </button>
                )
              )}

              {user && (
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-transparent border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors"
                  >
                    <DotsIcon />
                  </button>
                  {menuOpen && (
                    <div
                      className="absolute right-0 mt-1 w-44 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl z-30 overflow-hidden"
                      onMouseLeave={() => setMenuOpen(false)}
                    >
                      {profile.is_friend && (
                        <button
                          onClick={() => { setMenuOpen(false); setShowUnfriendConfirm(true); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
                        >
                          Unfriend
                        </button>
                      )}
                      <button
                        onClick={() => { setMenuOpen(false); setShowBlockConfirm(true); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
                      >
                        Block user
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); setShowReportModal(true); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-error-400 hover:bg-neutral-800 transition-colors"
                      >
                        Report user
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile hero */}
        <div className="relative sm:hidden px-5 pt-8 pb-6 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div
              className="shrink-0 rounded-full flex items-center justify-center text-[28px] font-bold text-white/90"
              style={{
                width: 72, height: 72,
                background: `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.38 0.14 ${(hue + 40) % 360}))`,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4), 0 0 0 3px rgba(255,255,255,0.07)",
              }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="m-0 font-light italic text-[32px] tracking-[-0.025em] leading-none text-neutral-100">
                {profile.username}
              </h1>
              <span className="font-mono text-[12px] text-neutral-500">@{profile.username}</span>
            </div>
          </div>
          {profile.bio && (
            <p className="italic text-[14px] leading-snug text-neutral-300 m-0">{profile.bio}</p>
          )}
          <MobileActions
            profile={profile}
            requesting={requesting}
            user={user}
            onSend={sendRequest}
            onCancel={cancelRequest}
            onUnfollow={unfollow}
            onRespond={respondToRequest}
            onOpenMenu={() => setMenuOpen(true)}
          />
        </div>

        {/* Stat strip */}
        {canSeeDetails && statStrip.length > 0 && (
          <div
            className="relative grid border-t border-neutral-800"
            style={{ gridTemplateColumns: `repeat(${statStrip.length}, 1fr)`, background: "#0d0d0d" }}
          >
            {statStrip.map((s, i) => (
              <div
                key={s.label}
                className="flex flex-col gap-1 py-4 px-5"
                style={{ borderLeft: i === 0 ? "none" : "1px solid #262626" }}
              >
                <span className="font-mono text-[10px] text-neutral-600 tracking-[0.12em] uppercase">
                  {s.label}
                </span>
                <span className="italic font-light text-[28px] leading-none tracking-[-0.02em] text-neutral-100">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      {canSeeDetails ? (
        <div
          className="grid gap-8 px-6 sm:px-10 py-8 items-start"
          style={{ gridTemplateColumns: "1fr" }}
        >
          <div
            className="grid gap-8 items-start"
            style={{ gridTemplateColumns: "minmax(0,1fr) 280px" }}
          >
            {/* ── Left column ── */}
            <div className="flex flex-col gap-8">
              {/* Favorites */}
              {favorites && (favorites.movies.length > 0 || favorites.shows.length > 0) && (
                <section>
                  <SectionHead
                    eyebrow=""
                    title="Favorites"
                    count={(favorites.movies.length ?? 0) + (favorites.shows.length ?? 0)}
                  />
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-6">
                    <PosterSection label="TV Shows" items={favorites.shows} type="tv" cols={5} />
                    <PosterSection label="Movies" items={favorites.movies} type="movie" cols={5} />
                  </div>
                </section>
              )}

              {/* Watchlist + Watched */}
              {watchlist && watched && (
                <div className="grid grid-cols-2 gap-5">
                  <ListBlock
                    eyebrow=""
                    title="Watchlist"
                    movies={watchlist.movies}
                    shows={watchlist.shows}
                  />
                  <ListBlock
                    eyebrow=""
                    title="Watched"
                    movies={watched.movies}
                    shows={watched.shows}
                  />
                </div>
              )}
            </div>

            {/* ── Right sidebar ── */}
            <div className="flex flex-col gap-4 sticky top-24">
              {/* About */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                <div className="font-mono text-[10px] text-neutral-600 tracking-[0.15em] uppercase mb-4">
                  About
                </div>
                <div className="grid gap-y-2.5 gap-x-3 text-[13px]" style={{ gridTemplateColumns: "80px 1fr" }}>
                  <span className="text-neutral-500">Visibility</span>
                  <span className="font-medium text-neutral-200 flex items-center gap-1.5">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ background: profile.profile_visibility === "public" ? "#10b981" : "#6b7280" }}
                    />
                    {profile.profile_visibility === "public" ? "Public" : "Friends only"}
                  </span>
                  <span className="text-neutral-500">Relationship</span>
                  <span className="font-medium text-neutral-200">
                    {profile.is_friend ? "Friends" : profile.is_following ? "Following" : "—"}
                  </span>
                </div>
              </div>

              {/* Friends */}
              {friends.length > 0 && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                  <div className="font-mono text-[10px] text-neutral-600 tracking-[0.15em] uppercase mb-4">
                    Friends · {friends.length}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {friends.slice(0, 8).map(({ friendship_id, friend }) => (
                      <Link
                        key={friendship_id}
                        to={`/user/${friend.username}`}
                        className="flex items-center gap-2.5 group"
                      >
                        <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-[11px] font-bold text-neutral-300 flex-shrink-0 group-hover:bg-neutral-600 transition-colors">
                          {friend.username[0].toUpperCase()}
                        </div>
                        <span className="text-[13px] text-neutral-300 group-hover:text-neutral-100 transition-colors font-medium">
                          @{friend.username}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Moderation actions */}
              {user && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
                  <div className="flex gap-2 text-[12px]">
                    {profile.is_friend && (
                      <button
                        onClick={() => setShowUnfriendConfirm(true)}
                        className="flex-1 py-2 px-3 rounded-xl border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 bg-transparent font-medium transition-colors"
                      >
                        Unfriend
                      </button>
                    )}
                    <button
                      onClick={() => setShowBlockConfirm(true)}
                      className="flex-1 py-2 px-3 rounded-xl border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 bg-transparent font-medium transition-colors"
                    >
                      Block
                    </button>
                    <button
                      onClick={() => setShowReportModal(true)}
                      className="flex-1 py-2 px-3 rounded-xl border border-neutral-800 text-error-400 hover:text-error-300 hover:border-neutral-700 bg-transparent font-medium transition-colors"
                    >
                      Report
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-6 sm:px-10 py-16 flex justify-center">
          <div className="w-full max-w-md text-center space-y-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-2"
              style={{ background: `oklch(0.22 0.06 ${hue})`, border: `1px solid oklch(0.32 0.06 ${hue})` }}
            >
              <LockIcon />
            </div>
            <p className="text-neutral-200 font-medium text-[15px]">
              {profile.profile_visibility === "private"
                ? "This account is private."
                : "Add this person as a friend to see their lists."}
            </p>
            <p className="text-neutral-500 text-sm">
              {profile.profile_visibility === "private"
                ? "Only they can see their activity."
                : "Their watchlist, watched, and favorites are only visible to friends."}
            </p>
            {!profile.is_friend && !profile.is_following && !profile.pending_request_id && profile.profile_visibility !== "private" && (
              <button
                onClick={sendRequest}
                disabled={requesting}
                className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors mt-2"
              >
                {requesting ? <Spinner /> : <PlusIcon />}
                {profile.is_followed_by_them ? "Add back" : "Add Friend"}
              </button>
            )}
            {user && (
              <div className="flex justify-center gap-2 pt-4">
                <button
                  onClick={() => setShowBlockConfirm(true)}
                  className="text-[12px] text-neutral-500 hover:text-neutral-300 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-colors"
                >
                  Block
                </button>
                <button
                  onClick={() => setShowReportModal(true)}
                  className="text-[12px] text-error-500 hover:text-error-400 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-colors"
                >
                  Report
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Block modal ─────────────────────────────────────────── */}
      {showBlockConfirm && (
        <Modal onClose={() => setShowBlockConfirm(false)}>
          <h3 className="text-white font-semibold mb-1">Block @{profile.username}?</h3>
          <p className="text-neutral-400 text-sm mb-5">
            They won't be able to send you friend requests or recommendations, and their content won't appear to you.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowBlockConfirm(false)}
              className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm py-2.5 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={blockUser}
              disabled={blockMutation.isPending}
              className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl transition-colors font-medium"
            >
              {blockMutation.isPending ? "Blocking…" : "Block"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Unfriend modal ──────────────────────────────────────── */}
      {showUnfriendConfirm && (
        <Modal onClose={() => setShowUnfriendConfirm(false)}>
          <h3 className="text-white font-semibold mb-1">Unfriend @{profile.username}?</h3>
          <p className="text-neutral-400 text-sm mb-5">
            You'll lose access to their private lists and they'll be removed from your friends.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnfriendConfirm(false)}
              className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm py-2.5 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={unfriend}
              disabled={removeFriendMutation.isPending}
              className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl transition-colors font-medium"
            >
              {removeFriendMutation.isPending ? "Removing…" : "Unfriend"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Report modal ────────────────────────────────────────── */}
      {showReportModal && (
        <Modal onClose={() => { setShowReportModal(false); setReportDone(false); }}>
          {reportDone ? (
            <>
              <p className="text-neutral-200 text-sm mb-5">Report submitted. Thank you for letting us know.</p>
              <button
                onClick={() => { setShowReportModal(false); setReportDone(false); }}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm py-2.5 rounded-xl transition-colors"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <h3 className="text-white font-semibold mb-4">Report @{profile.username}</h3>
              <div className="space-y-0.5 mb-4">
                {REPORT_REASONS.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2.5 cursor-pointer py-1.5">
                    <input
                      type="radio"
                      name="reportReason"
                      value={value}
                      checked={reportReason === value}
                      onChange={() => setReportReason(value)}
                      className="accent-primary-500"
                    />
                    <span className="text-neutral-300 text-sm">{label}</span>
                  </label>
                ))}
              </div>
              <div className="mb-5">
                <label className="text-[11px] text-neutral-500 block mb-1.5 font-mono uppercase tracking-wider">
                  Additional details (optional)
                </label>
                <textarea
                  value={reportMessage}
                  onChange={(e) => setReportMessage(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Describe the issue…"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-neutral-200 placeholder-neutral-700 focus:outline-none focus:border-neutral-600 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowReportModal(false)}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm py-2.5 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitReport}
                  disabled={reportMutation.isPending}
                  className="flex-1 bg-error-600 hover:bg-error-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl transition-colors font-medium"
                >
                  {reportMutation.isPending ? "Submitting…" : "Report"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function ListBlock({
  eyebrow,
  title,
  movies,
  shows,
}: {
  eyebrow: string;
  title: string;
  movies: MediaItem[];
  shows: MediaItem[];
}) {
  const total = movies.length + shows.length;
  const preview = [...shows, ...movies].slice(0, 4);
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
      <SectionHead eyebrow={eyebrow} title={title} count={total} />
      {total > 0 ? (
        <div className="grid grid-cols-4 gap-2.5">
          {preview.map((item) => {
            const isMovie = movies.some((m) => m.id === item.id);
            return <PosterThumb key={item.id} item={item} type={isMovie ? "movie" : "tv"} />;
          })}
        </div>
      ) : (
        <p className="text-neutral-600 text-sm italic">Nothing here yet.</p>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function MobileActions({
  profile, requesting, user,
  onSend, onCancel, onUnfollow, onRespond, onOpenMenu,
}: {
  profile: PublicProfile;
  requesting: boolean;
  user: ReturnType<typeof useAuthUser>;
  onSend: () => void;
  onCancel: () => void;
  onUnfollow: () => void;
  onRespond: (accept: boolean) => void;
  onOpenMenu: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {!profile.is_friend && (
        profile.incoming_request_id ? (
          <>
            <button onClick={() => onRespond(true)} disabled={requesting} className="flex-1 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-xl transition-colors">Accept</button>
            <button onClick={() => onRespond(false)} disabled={requesting} className="flex-1 bg-neutral-800 border border-neutral-700 disabled:opacity-50 text-neutral-300 text-sm font-medium py-2 rounded-xl transition-colors">Decline</button>
          </>
        ) : profile.is_following ? (
          <button onClick={onUnfollow} disabled={requesting} className="flex-1 bg-neutral-800 border border-neutral-700 disabled:opacity-50 text-neutral-300 text-sm font-medium py-2 rounded-xl transition-colors">Following</button>
        ) : profile.pending_request_id ? (
          <button onClick={onCancel} disabled={requesting} className="flex-1 bg-neutral-800 border border-neutral-700 disabled:opacity-50 text-neutral-300 text-sm font-medium py-2 rounded-xl transition-colors">Request Sent</button>
        ) : (
          <button onClick={onSend} disabled={requesting} className="flex-1 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-xl transition-colors">
            {profile.profile_visibility === "public" ? "Follow" : profile.is_followed_by_them ? "Add back" : "Add Friend"}
          </button>
        )
      )}
      {user && (
        <button onClick={onOpenMenu} className="w-9 h-9 flex items-center justify-center rounded-xl border border-neutral-700 text-neutral-500">
          <DotsIcon />
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />;
}
function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg className="w-6 h-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}
