import { useState } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import { BASE_IMAGE_URL, AVATAR_PRESETS, getAvatarColor } from "../constants";
import { Link } from "react-router-dom";
import FriendSearch from "../components/FriendSearch";
import FriendRequests from "../components/FriendRequests";
import StatsSection from "../components/StatsSection";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProfileSummary } from "../hooks/api/useUser";
import { useShelves } from "../hooks/api/useShelves";
import { useSendFriendRequest, useRemoveFriend } from "../hooks/api/useFriends";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/api/queryKeys";

type FriendsTab = "friends" | "requests" | "followers" | "add";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchSummary(queryClient: ReturnType<typeof useQueryClient>, uid: string, updater: (old: any) => any) {
  queryClient.setQueryData(queryKeys.profileSummary(uid), (old: unknown) => {
    if (!old) return old;
    return updater(old);
  });
}

function avatarKeyToHue(key: string | null | undefined): number {
  const map: Record<string, number> = {
    green: 160, purple: 280, blue: 220, red: 5,
    orange: 30, teal: 175, pink: 330, yellow: 55,
  };
  return key ? (map[key] ?? 160) : 160;
}

function SectionHead({
  title, sub, action, actionHref,
}: {
  title: string;
  sub?: string;
  action?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <h2 className="m-0 font-normal text-[22px] tracking-tight text-neutral-100 italic leading-none">
        {title}
      </h2>
      {sub && (
        <span className="font-mono text-[10.5px] text-neutral-500 tracking-[0.06em]">
          · {sub.toUpperCase()}
        </span>
      )}
      <span className="flex-1" />
      {action && actionHref && (
        <Link
          to={actionHref}
          className="text-[12.5px] text-neutral-400 hover:text-neutral-200 font-medium transition-colors"
        >
          {action} →
        </Link>
      )}
    </div>
  );
}

type ListPreviewItem = {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
};

function PosterGrid({
  items,
  type,
  cols = 5,
}: {
  items: ListPreviewItem[];
  type: "movie" | "tv";
  cols?: number;
}) {
  const gridClass =
    cols === 8
      ? "grid grid-cols-8 gap-2"
      : cols === 6
        ? "grid grid-cols-6 gap-3"
        : cols === 4
          ? "grid grid-cols-4 gap-3"
          : "grid grid-cols-5 gap-3";

  return (
    <div className={gridClass}>
      {items.map((item) => {
        const label = item.title ?? item.name ?? "";
        const href = type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`;
        const fallback = type === "movie" ? "/movie-icon.png" : "/tv-icon.png";
        return (
          <Link key={item.id} to={href} className="group block">
            <div className="rounded-xl overflow-hidden aspect-[2/3] bg-neutral-800">
              <img
                src={
                  item.poster_path
                    ? `${BASE_IMAGE_URL}/w342${item.poster_path}`
                    : fallback
                }
                alt={label}
                className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
              />
            </div>
            <p className="mt-1.5 text-[11.5px] font-medium text-neutral-400 text-center line-clamp-1">
              {label}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

export default function ProfilePage() {
  usePageTitle("My Profile");
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useProfileSummary();
  const { data: shelves = [] } = useShelves();

  const removeMutation = useRemoveFriend();
  const sendRequestMutation = useSendFriendRequest();
  const addingBackUsername = sendRequestMutation.isPending
    ? sendRequestMutation.variables?.addresseeUsername ?? null
    : null;

  const typedDbUser = summary?.user;
  const favorites = summary?.favorites ?? { movies: [], shows: [] };
  const watchlistPreview = summary?.watchlist ?? { movies: [], shows: [], total_movies: 0, total_shows: 0 };
  const watchedPreview = summary?.watched ?? { movies: [], shows: [], total_movies: 0, total_shows: 0 };
  const friends = summary?.friends ?? [];
  const incoming = summary?.incoming_requests ?? [];
  const outgoing = summary?.outgoing_requests ?? [];
  const followers = summary?.followers ?? [];

  const incomingCount = incoming.length;
  const totalWatched = watchedPreview.total_movies + watchedPreview.total_shows;
  const totalWatchlist = watchlistPreview.total_movies + watchlistPreview.total_shows;
  const totalFavorites = favorites.movies.length + favorites.shows.length;
  const hue = avatarKeyToHue(typedDbUser?.avatar_key);
  const avatarColor = getAvatarColor(typedDbUser?.avatar_key);

  async function handleShareProfile() {
    const username = typedDbUser?.username;
    if (!username) return;
    const url = `${window.location.origin}/user/${username}`;
    if (navigator.share) {
      await navigator.share({ title: `${username} on ReleaseRadar`, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url).catch(() => {});
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }

  async function addBack(follower: { id: string; username: string }) {
    await sendRequestMutation.mutateAsync({ addresseeUsername: follower.username }).catch(() => {});
  }

  async function removeFriend(friendId: string) {
    try {
      await removeMutation.mutateAsync(friendId);
      if (!user) return;
      patchSummary(queryClient, user.uid, (old) => ({
        ...old,
        friends: old.friends.filter((f: { friend: { id: string } }) => f.friend.id !== friendId),
      }));
    } finally {
      setConfirmRemoveId(null);
    }
  }

  if (!user) {
    return (
      <div className="p-8 text-center text-neutral-400">
        You must be signed in to view your profile.
      </div>
    );
  }

  const initials = (user.displayName ?? typedDbUser?.username ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const statStrip = [
    { label: "Watched",   value: summaryLoading ? "—" : totalWatched },
    { label: "Watchlist", value: summaryLoading ? "—" : totalWatchlist },
    { label: "Favorites", value: summaryLoading ? "—" : totalFavorites },
    { label: "Shelves",   value: summaryLoading ? "—" : shelves.length },
    { label: "Friends",   value: summaryLoading ? "—" : friends.length },
  ];

  return (
    <div className="w-full">
      {/* ── Hero ────────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden border-b border-neutral-800"
        style={{ background: "#111" }}
      >
        {/* Atmospheric gradient */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(80% 70% at 80% 0%, oklch(0.28 0.12 ${hue}) 0%, transparent 65%), radial-gradient(60% 70% at 10% 80%, oklch(0.20 0.08 ${hue} / 0.5) 0%, transparent 70%)`,
            opacity: 0.7,
          }}
        />
        {/* Radar rings decoration */}
        <svg
          viewBox="0 0 600 400"
          className="absolute pointer-events-none"
          style={{ right: -80, top: -80, width: 600, height: 400, opacity: 0.14 }}
        >
          {[60, 110, 160, 210, 260].map((r) => (
            <circle key={r} cx="400" cy="200" r={r} stroke="#10b981" strokeWidth="0.8" fill="none" />
          ))}
        </svg>

        <div
          className="relative grid items-end gap-8 px-6 sm:px-10 pt-10 pb-8"
          style={{ gridTemplateColumns: "116px 1fr auto" }}
        >
          {/* Avatar */}
          <div className="relative shrink-0">
            {!avatarColor && user.photoURL ? (
              <img
                src={user.photoURL}
                alt="Profile"
                style={{ width: 116, height: 116 }}
                className="rounded-full object-cover border-4 border-white/10 shadow-2xl"
              />
            ) : (
              <div
                style={{
                  width: 116, height: 116, borderRadius: "50%",
                  background: avatarColor
                    ? `linear-gradient(135deg, ${avatarColor}cc, ${avatarColor}88)`
                    : `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.38 0.14 ${(hue + 40) % 360}))`,
                  boxShadow: "0 16px 40px rgba(0,0,0,0.4), 0 0 0 4px rgba(255,255,255,0.07)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 40, fontWeight: 700, color: "rgba(255,255,255,0.92)",
                  letterSpacing: "-0.02em",
                }}
              >
                {initials}
              </div>
            )}
            {typedDbUser?.subscription_tier === "premium" && (
              <span className="absolute bottom-0 right-0 font-mono text-[9px] font-bold tracking-wider bg-amber-400 text-amber-900 rounded-full px-2 py-0.5 shadow-lg uppercase">
                ★ Pro
              </span>
            )}
          </div>

          {/* Name + meta */}
          <div className="min-w-0">
            <div className="font-mono text-[11px] tracking-[0.15em] text-primary-400 uppercase mb-2">
              ◉ Member since{" "}
              {user.metadata?.creationTime
                ? new Date(user.metadata.creationTime).toLocaleDateString("en-US", { month: "long", year: "numeric" })
                : "—"}
            </div>
            <div className="flex items-baseline gap-4 flex-wrap">
              <h1 className="m-0 font-normal text-[50px] tracking-[-0.025em] leading-none text-neutral-100">
                {user.displayName ?? "User"}
              </h1>
              {typedDbUser?.username && (
                <span className="font-mono text-[14px] text-neutral-400 tracking-[0.02em]">
                  @{typedDbUser.username}
                </span>
              )}
              {typedDbUser?.subscription_tier === "admin" && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-highlight-500/20 text-highlight-400 border border-highlight-500/30 rounded-full px-2 py-0.5">
                  Admin
                </span>
              )}
            </div>
            {typedDbUser?.bio && (
              <p className="italic text-[17px] leading-snug tracking-tight text-neutral-300 mt-3 max-w-xl">
                {typedDbUser.bio}
              </p>
            )}
            <div className="flex gap-4 mt-3 font-mono text-[11.5px] text-neutral-500 tracking-[0.02em] uppercase flex-wrap">
              {user.email && <span>{user.email}</span>}
              {user.email && <span className="text-neutral-700">·</span>}
              <span className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-primary-500"
                  style={{ display: "inline-block" }}
                />
                Online now
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 items-end shrink-0">
            <div className="flex gap-2">
              {typedDbUser?.username && (
                <button
                  onClick={handleShareProfile}
                  className="flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-300 hover:text-neutral-100 bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700 px-3.5 py-2 rounded-xl transition-colors"
                >
                  {shareCopied ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                      </svg>
                      Share profile
                    </>
                  )}
                </button>
              )}
              <Link
                to="/settings"
                className="flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-900 bg-primary-500 hover:bg-primary-400 px-3.5 py-2 rounded-xl transition-colors"
              >
                Edit profile
              </Link>
            </div>
            {typedDbUser?.username && (
              <span className="font-mono text-[10px] text-neutral-600 tracking-[0.06em] uppercase">
                releaseradar.app/user/{typedDbUser.username}
              </span>
            )}
          </div>
        </div>

        {/* Stat strip */}
        <div
          className="relative grid border-t border-neutral-800"
          style={{ gridTemplateColumns: `repeat(${statStrip.length}, 1fr)`, background: "#0d0d0d" }}
        >
          {statStrip.map((s, i) => (
            <div
              key={s.label}
              className="flex flex-col gap-1 px-6 py-5"
              style={{ borderLeft: i === 0 ? "none" : "1px solid #262626" }}
            >
              <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase">
                {s.label}
              </div>
              <div
                className="text-[30px] leading-none tracking-tight text-neutral-100 italic font-normal"
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 px-6 sm:px-10 py-8 items-start">
        {/* Main column */}
        <div className="flex flex-col gap-10">

          {/* Favorites */}
          {(favorites.movies.length > 0 || favorites.shows.length > 0) && (
            <section>
              <SectionHead title="Favorites" sub={`${totalFavorites} pinned`} />
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex flex-col gap-6">
                {favorites.shows.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-3">
                      TV Shows · {favorites.shows.length}
                    </div>
                    <PosterGrid items={favorites.shows} type="tv" cols={8} />
                  </div>
                )}
                {favorites.movies.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-3">
                      Movies · {favorites.movies.length}
                    </div>
                    <PosterGrid items={favorites.movies} type="movie" cols={8} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Watchlist + Watched side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <section>
              <SectionHead
                title="Watchlist"
                sub={String(totalWatchlist)}
                action="View all"
                actionHref="/watchlist"
              />
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                {watchlistPreview.shows.length > 0 && (
                  <div className="mb-4">
                    <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-3">TV</div>
                    <PosterGrid items={watchlistPreview.shows} type="tv" cols={5} />
                  </div>
                )}
                {watchlistPreview.movies.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-3">Movies</div>
                    <PosterGrid items={watchlistPreview.movies} type="movie" cols={5} />
                  </div>
                )}
                {totalWatchlist === 0 && !summaryLoading && (
                  <p className="text-neutral-500 text-[13px]">Your watchlist is empty.</p>
                )}
              </div>
            </section>

            <section>
              <SectionHead
                title="Watched"
                sub={String(totalWatched)}
                action="View all"
                actionHref="/watched"
              />
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
                {watchedPreview.shows.length > 0 && (
                  <div className="mb-4">
                    <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-3">TV</div>
                    <PosterGrid items={watchedPreview.shows} type="tv" cols={5} />
                  </div>
                )}
                {watchedPreview.movies.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-3">Movies</div>
                    <PosterGrid items={watchedPreview.movies} type="movie" cols={5} />
                  </div>
                )}
                {totalWatched === 0 && !summaryLoading && (
                  <p className="text-neutral-500 text-[13px]">Nothing watched yet.</p>
                )}
              </div>
            </section>
          </div>

          {/* Shelves */}
          {shelves.length > 0 && (
            <section>
              <SectionHead
                title="Shelves"
                sub={`${shelves.length} curated`}
                action="Manage"
                actionHref="/shelves"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {shelves.map((shelf, i) => {
                  const SHELF_HUES = [160, 220, 285, 30, 175, 330];
                  const shelfHue = SHELF_HUES[i % SHELF_HUES.length];
                  return (
                    <Link
                      key={shelf.id}
                      to={`/shelves/${shelf.id}`}
                      className="group block bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-2xl p-5 transition-colors relative overflow-hidden"
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl"
                        style={{
                          background: `linear-gradient(180deg, oklch(0.65 0.14 ${shelfHue}), oklch(0.45 0.14 ${shelfHue}))`,
                        }}
                      />
                      <div className="pl-1">
                        <h3 className="font-normal text-[17px] tracking-tight text-neutral-100 italic group-hover:text-primary-400 transition-colors truncate">
                          {shelf.name}
                        </h3>
                        <div className="font-mono text-[10px] text-neutral-500 tracking-[0.08em] uppercase mt-1.5">
                          {shelf.item_count} {shelf.item_count === 1 ? "title" : "titles"}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Stats */}
          <section>
            <SectionHead title="Your stats" action="Full stats" actionHref="/stats" />
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
              <StatsSection />
            </div>
          </section>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">

          {/* About */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase mb-4">
              About
            </div>
            <div className="grid gap-x-4 gap-y-2.5 text-[13px]" style={{ gridTemplateColumns: "72px 1fr" }}>
              <span className="text-neutral-500">Joined</span>
              <span className="font-medium text-neutral-200">
                {user.metadata?.creationTime
                  ? new Date(user.metadata.creationTime).toLocaleDateString("en-US", { month: "long", year: "numeric" })
                  : "—"}
              </span>
              <span className="text-neutral-500">Plan</span>
              <span className="font-medium text-neutral-200 flex items-center gap-1.5">
                {typedDbUser?.subscription_tier === "premium" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    Premium
                  </>
                ) : typedDbUser?.subscription_tier === "admin" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-highlight-400 inline-block" />
                    Admin
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 inline-block" />
                    Free
                  </>
                )}
              </span>
              <span className="text-neutral-500">Visibility</span>
              <span className="font-medium text-neutral-200 capitalize">
                {typedDbUser?.profile_visibility?.replace("_", " ") ?? "—"}
              </span>
              {user.email && (
                <>
                  <span className="text-neutral-500">Email</span>
                  <span className="font-medium text-neutral-200 text-[12px] truncate">{user.email}</span>
                </>
              )}
            </div>
            {/* Avatar color picker hint */}
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <div className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase mb-2.5">
                Avatar color
              </div>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_PRESETS.map((p) => (
                  <div
                    key={p.key}
                    title={p.label}
                    className="w-5 h-5 rounded-full ring-1 ring-neutral-700"
                    style={{
                      background: p.color,
                      boxShadow: typedDbUser?.avatar_key === p.key
                        ? `0 0 0 2px #0d0d0d, 0 0 0 4px ${p.color}`
                        : undefined,
                    }}
                  />
                ))}
              </div>
              <Link
                to="/settings"
                className="mt-2 inline-block text-[11.5px] text-primary-400 hover:text-primary-300 transition-colors"
              >
                Change in settings →
              </Link>
            </div>
          </div>

          {/* Friends */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase flex-1">
                Friends · {friends.length}
              </div>
              {incomingCount > 0 && (
                <span className="font-mono text-[10px] font-bold bg-primary-500 text-neutral-900 px-1.5 py-0.5 rounded">
                  {incomingCount} new
                </span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-neutral-800 mb-4 -mx-1 px-1">
              {(
                [
                  { id: "friends" as FriendsTab, label: "Friends", count: friends.length },
                  ...(typedDbUser?.profile_visibility === "public"
                    ? [{ id: "followers" as FriendsTab, label: "Followers", count: followers.length }]
                    : []),
                  { id: "requests" as FriendsTab, label: "Requests", count: incomingCount, badge: incomingCount > 0 },
                  { id: "add" as FriendsTab, label: "Add" },
                ] as { id: FriendsTab; label: string; count?: number; badge?: boolean }[]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFriendsTab(t.id)}
                  className={[
                    "flex items-center gap-1.5 pb-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors px-1",
                    friendsTab === t.id
                      ? "border-primary-500 text-neutral-100"
                      : "border-transparent text-neutral-500 hover:text-neutral-300",
                  ].join(" ")}
                >
                  {t.label}
                  {t.count != null && t.count > 0 && (
                    <span
                      className={[
                        "font-mono text-[9.5px] px-1 py-px rounded font-semibold",
                        t.badge ? "bg-primary-500 text-neutral-900" : "bg-neutral-800 text-neutral-500",
                      ].join(" ")}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Friends list */}
            {friendsTab === "friends" && (
              <div className="flex flex-col gap-2.5">
                {friends.length === 0 ? (
                  <p className="text-neutral-500 text-[13px]">No friends yet.</p>
                ) : (
                  friends.map(({ friendship_id, friend }) => (
                    <div key={friendship_id} className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                        style={{
                          background: `oklch(0.32 0.10 ${avatarKeyToHue(undefined) + (friend.username.charCodeAt(0) * 7) % 360})`,
                          color: `oklch(0.85 0.08 ${(friend.username.charCodeAt(0) * 7) % 360})`,
                        }}
                      >
                        {friend.username.slice(0, 2).toUpperCase()}
                      </div>
                      <Link
                        to={`/user/${friend.username}`}
                        className="flex-1 text-[13px] font-medium text-neutral-200 hover:text-primary-400 transition-colors truncate"
                      >
                        @{friend.username}
                      </Link>
                      {confirmRemoveId === friend.id ? (
                        <div className="flex gap-1 items-center">
                          <button
                            onClick={() => removeFriend(friend.id)}
                            disabled={removeMutation.isPending && removeMutation.variables === friend.id}
                            className="text-[10.5px] bg-error-600 hover:bg-error-500 text-white px-2 py-0.5 rounded disabled:opacity-50"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmRemoveId(null)}
                            className="text-[10.5px] text-neutral-500 hover:text-neutral-300"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRemoveId(friend.id)}
                          className="text-neutral-700 hover:text-neutral-400 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Followers list */}
            {friendsTab === "followers" && typedDbUser?.profile_visibility === "public" && (
              <div className="flex flex-col gap-2.5">
                {followers.length === 0 ? (
                  <p className="text-neutral-500 text-[13px]">No followers yet.</p>
                ) : (
                  followers.map(({ friendship_id, follower }) => (
                    <div key={friendship_id} className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 bg-neutral-800 text-neutral-400"
                      >
                        {follower.username.slice(0, 2).toUpperCase()}
                      </div>
                      <Link
                        to={`/user/${follower.username}`}
                        className="flex-1 text-[13px] font-medium text-neutral-200 hover:text-primary-400 transition-colors truncate"
                      >
                        @{follower.username}
                      </Link>
                      <button
                        onClick={() => addBack(follower)}
                        disabled={addingBackUsername === follower.username}
                        className="text-[11px] font-semibold text-primary-400 bg-primary-500/15 hover:bg-primary-500/25 disabled:opacity-50 px-2.5 py-1 rounded-lg transition-colors"
                      >
                        {addingBackUsername === follower.username ? "…" : "Add back"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Requests */}
            {friendsTab === "requests" && (
              <FriendRequests
                incoming={incoming}
                outgoing={outgoing}
                onResponded={(friendshipId, accepted, req) => {
                  if (!user) return;
                  patchSummary(queryClient, user.uid, (old) => ({
                    ...old,
                    incoming_requests: old.incoming_requests.filter(
                      (r: { friendship_id: number }) => r.friendship_id !== friendshipId,
                    ),
                    friends: accepted
                      ? [...old.friends, { friendship_id: friendshipId, friend: req.from_user }]
                      : old.friends,
                  }));
                }}
                onCancelled={(friendshipId) => {
                  if (!user) return;
                  patchSummary(queryClient, user.uid, (old) => ({
                    ...old,
                    outgoing_requests: old.outgoing_requests.filter(
                      (r: { friendship_id: number }) => r.friendship_id !== friendshipId,
                    ),
                  }));
                }}
              />
            )}

            {/* Add friend search */}
            {friendsTab === "add" && (
              <FriendSearch
                friendIds={new Set(friends.map((f) => f.friend.id))}
                onRequestSent={() => setFriendsTab("requests")}
              />
            )}

            <button
              onClick={() => setFriendsTab("add")}
              className="mt-4 w-full text-[12.5px] font-medium text-primary-400 bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/20 py-2 rounded-xl transition-colors"
            >
              + Find friends
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
