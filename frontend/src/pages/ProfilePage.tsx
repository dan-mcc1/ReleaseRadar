import { lazy, Suspense, useState, type ReactNode } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import { AVATAR_PRESETS, getAvatarColor } from "../constants";
import { Link } from "react-router-dom";
import { ShareIcon, UserMinusIcon } from "@heroicons/react/24/outline";
import FriendSearch from "../components/FriendSearch";
import FriendRequests from "../components/FriendRequests";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  Button,
  ButtonLink,
  CheckIcon,
  IconButton,
  PageHeader,
  PlusIcon,
  PosterCard,
  SectionHeader,
  StarIcon,
  cx,
  focusRing,
} from "../components/ui";

// Charts (Recharts) are most of this page's code; load them on their own.
const StatsSection = lazy(() => import("../components/StatsSection"));
import { useProfileSummary, type ProfileSummary } from "../hooks/api/useUser";
import { useShelves } from "../hooks/api/useShelves";
import { useSendFriendRequest, useRemoveFriend } from "../hooks/api/useFriends";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/api/queryKeys";

type FriendsTab = "friends" | "requests" | "followers" | "add";

function patchSummary(queryClient: ReturnType<typeof useQueryClient>, uid: string, updater: (old: ProfileSummary) => ProfileSummary) {
  queryClient.setQueryData(queryKeys.profileSummary(uid), (old: unknown) => {
    if (!old) return old;
    return updater(old as ProfileSummary);
  });
}

function avatarKeyToHue(key: string | null | undefined): number {
  const map: Record<string, number> = {
    green: 160, purple: 280, blue: 220, red: 5,
    orange: 30, teal: 175, pink: 330, yellow: 55,
  };
  return key ? (map[key] ?? 160) : 160;
}

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cx("rounded-sm text-label text-neutral-300 hover:text-primary-300 transition-colors", focusRing)}
    >
      {children}
    </Link>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div className="text-label font-medium text-neutral-400 mb-3">{children}</div>;
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
      ? "grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 2xl:grid-cols-posters-dense gap-2"
      : cols === 6
        ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3"
        : cols === 4
          ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"
          : "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3";

  return (
    <div className={gridClass}>
      {items.map((item) => (
        <PosterCard
          key={item.id}
          to={type === "movie" ? `/movie/${item.id}` : `/tv/${item.id}`}
          title={item.title ?? item.name ?? ""}
          posterPath={item.poster_path}
        />
      ))}
    </div>
  );
}

function CollectionPosterGrid({
  items,
}: {
  items: { id: number; name: string; poster_path: string | null }[];
}) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 2xl:grid-cols-posters-dense gap-2">
      {items.map((c) => (
        <PosterCard key={c.id} to={`/collection/${c.id}`} title={c.name} posterPath={c.poster_path} />
      ))}
    </div>
  );
}

// Self-contained friends panel — owns its tab + confirm state so switching
// tabs doesn't re-render the hero, stats, or shelves above it.
function FriendsWidget() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const { data: summary } = useProfileSummary();
  const removeMutation = useRemoveFriend();
  const sendRequestMutation = useSendFriendRequest();

  const typedDbUser = summary?.user;
  const friends = summary?.friends ?? [];
  const incoming = summary?.incoming_requests ?? [];
  const outgoing = summary?.outgoing_requests ?? [];
  const followers = summary?.followers ?? [];
  const incomingCount = incoming.length;
  const addingBackUsername = sendRequestMutation.isPending
    ? sendRequestMutation.variables?.addresseeUsername ?? null
    : null;

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

  return (
    <section>
      <SectionHeader
        title="Friends"
        note={String(friends.length)}
        action={
          incomingCount > 0 && (
            <span className="tabular text-caption font-semibold bg-primary-500 text-neutral-900 px-1.5 py-0.5 rounded">
              {incomingCount} new
            </span>
          )
        }
        className="mb-4"
      />

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
            className={cx(
              "flex items-center gap-1.5 pb-2.5 text-caption font-medium border-b-2 -mb-px transition-colors px-1",
              focusRing,
              friendsTab === t.id
                ? "border-primary-500 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span
                className={cx(
                  "tabular text-caption px-1 py-px rounded font-semibold",
                  t.badge ? "bg-primary-500 text-neutral-900" : "bg-neutral-800 text-neutral-400",
                )}
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
            <p className="text-neutral-500 text-label">No friends yet.</p>
          ) : (
            friends.map(({ friendship_id, friend }) => (
              <div key={friendship_id} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-caption font-semibold shrink-0"
                  style={{
                    background: `oklch(0.32 0.10 ${avatarKeyToHue(undefined) + (friend.username.charCodeAt(0) * 7) % 360})`,
                    color: `oklch(0.85 0.08 ${(friend.username.charCodeAt(0) * 7) % 360})`,
                  }}
                >
                  {friend.username.slice(0, 2).toUpperCase()}
                </div>
                <Link
                  to={`/user/${friend.username}`}
                  className="flex-1 min-w-0 hover:text-primary-300 transition-colors"
                >
                  <div className="text-label font-medium text-neutral-200 truncate">
                    {friend.display_name || `@${friend.username}`}
                  </div>
                  {friend.display_name && (
                    <div className="text-caption text-neutral-500 truncate">@{friend.username}</div>
                  )}
                </Link>
                {confirmRemoveId === friend.id ? (
                  <div className="flex gap-1 items-center">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => removeFriend(friend.id)}
                      disabled={removeMutation.isPending && removeMutation.variables === friend.id}
                    >
                      Yes
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveId(null)}>
                      No
                    </Button>
                  </div>
                ) : (
                  <IconButton
                    size="sm"
                    label={`Remove @${friend.username}`}
                    icon={<UserMinusIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
                    onClick={() => setConfirmRemoveId(friend.id)}
                  />
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
            <p className="text-neutral-500 text-label">No followers yet.</p>
          ) : (
            followers.map(({ friendship_id, follower }) => (
              <div key={friendship_id} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-caption font-semibold shrink-0 bg-neutral-800 text-neutral-400">
                  {follower.username.slice(0, 2).toUpperCase()}
                </div>
                <Link
                  to={`/user/${follower.username}`}
                  className="flex-1 min-w-0 hover:text-primary-300 transition-colors"
                >
                  <div className="text-label font-medium text-neutral-200 truncate">
                    {follower.display_name || `@${follower.username}`}
                  </div>
                  {follower.display_name && (
                    <div className="text-caption text-neutral-500 truncate">@{follower.username}</div>
                  )}
                </Link>
                <Button
                  size="sm"
                  onClick={() => addBack(follower)}
                  disabled={addingBackUsername === follower.username}
                >
                  {addingBackUsername === follower.username ? "…" : "Add back"}
                </Button>
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
                ? [
                    ...old.friends,
                    {
                      friendship_id: friendshipId,
                      friend: {
                        id: req.from_user.id,
                        username: req.from_user.username,
                        display_name: req.from_user.display_name ?? null,
                      },
                    },
                  ]
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

      <Button
        icon={<PlusIcon className="w-4 h-4" />}
        onClick={() => setFriendsTab("add")}
        className="mt-4 w-full"
      >
        Find friends
      </Button>
    </section>
  );
}

export default function ProfilePage() {
  usePageTitle("My Profile");
  const user = useAuthUser();
  const [shareCopied, setShareCopied] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useProfileSummary();
  const { data: shelves = [] } = useShelves();

  const typedDbUser = summary?.user;
  const favorites = summary?.favorites ?? { movies: [], shows: [], collections: [] };
  const watchlistPreview = summary?.watchlist ?? { movies: [], shows: [], total_movies: 0, total_shows: 0 };
  const watchedPreview = summary?.watched ?? { movies: [], shows: [], total_movies: 0, total_shows: 0 };
  const friends = summary?.friends ?? [];

  const totalWatched = watchedPreview.total_movies + watchedPreview.total_shows;
  const totalWatchlist = watchlistPreview.total_movies + watchlistPreview.total_shows;
  const totalFavorites =
    favorites.movies.length + favorites.shows.length + favorites.collections.length;
  const hue = avatarKeyToHue(typedDbUser?.avatar_key);
  const avatarColor = getAvatarColor(typedDbUser?.avatar_key);

  async function handleShareProfile() {
    const username = typedDbUser?.username;
    if (!username) return;
    const url = `${window.location.origin}/user/${username}`;
    const shareName = typedDbUser?.display_name ?? username;
    if (navigator.share) {
      await navigator.share({ title: `${shareName} on ReleaseRadar`, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url).catch(() => {});
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }

  if (!user) {
    return (
      <div className="p-8 text-center text-neutral-400">
        You must be signed in to view your profile.
      </div>
    );
  }

  const displayName = typedDbUser?.display_name ?? user.displayName ?? typedDbUser?.username ?? "User";
  const initials = (typedDbUser?.display_name ?? user.displayName ?? typedDbUser?.username ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const memberSince = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "—";

  const countsLine = summaryLoading
    ? null
    : `${totalWatched} watched · ${totalWatchlist} on your watchlist · ${totalFavorites} favorites · ${shelves.length} ${shelves.length === 1 ? "shelf" : "shelves"} · ${friends.length} ${friends.length === 1 ? "friend" : "friends"}`;

  return (
    <div className="w-full">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-8 px-6 sm:px-10 pt-10 pb-8 border-b border-neutral-800">
        {/* Avatar */}
        <div className="relative shrink-0">
          {!avatarColor && user.photoURL ? (
            <img
              src={user.photoURL}
              alt="Profile"
              style={{ width: 116, height: 116 }}
              className="rounded-full object-cover border-4 border-white/10"
            />
          ) : (
            <div
              style={{
                width: 116, height: 116, borderRadius: "50%",
                background: avatarColor
                  ? `linear-gradient(135deg, ${avatarColor}cc, ${avatarColor}88)`
                  : `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.38 0.14 ${(hue + 40) % 360}))`,
                boxShadow: "0 0 0 4px rgba(255,255,255,0.07)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 40, fontWeight: 700, color: "rgba(255,255,255,0.92)",
                letterSpacing: "-0.02em",
              }}
            >
              {initials}
            </div>
          )}
          {typedDbUser?.subscription_tier === "premium" && (
            <span className="absolute bottom-0 right-0 inline-flex items-center gap-1 text-caption font-semibold bg-warning-400 text-warning-900 rounded-full px-2 py-0.5">
              <StarIcon className="w-3 h-3" />
              Pro
            </span>
          )}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <PageHeader
            title={
              <>
                {displayName}
                {typedDbUser?.subscription_tier === "admin" && (
                  <span className="ml-3 align-middle text-caption font-semibold bg-highlight-500/20 text-highlight-400 border border-highlight-500/30 rounded-full px-2 py-0.5">
                    Admin
                  </span>
                )}
              </>
            }
            description={
              <>
                {typedDbUser?.username && <>@{typedDbUser.username} · </>}
                {user.email && <>{user.email} · </>}
                Member since {memberSince}
              </>
            }
            actions={
              <>
                {typedDbUser?.username && (
                  <Button
                    onClick={handleShareProfile}
                    icon={
                      shareCopied ? (
                        <CheckIcon className="w-4 h-4" />
                      ) : (
                        <ShareIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                      )
                    }
                  >
                    {shareCopied ? "Copied!" : "Share profile"}
                  </Button>
                )}
                <ButtonLink to="/settings" variant="primary">
                  Edit profile
                </ButtonLink>
              </>
            }
          />
          {typedDbUser?.bio && (
            <p className="text-body text-neutral-300 mt-3 max-w-xl">
              {typedDbUser.bio}
            </p>
          )}
          {countsLine && <p className="text-body text-neutral-400 mt-3">{countsLine}</p>}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 px-6 sm:px-10 py-8 items-start">
        {/* Main column */}
        <div className="flex flex-col gap-10">

          {/* Favorites */}
          {totalFavorites > 0 && (
            <section>
              <SectionHeader title="Favorites" note={`${totalFavorites} pinned`} className="mb-4" />
              <div className="flex flex-col gap-6">
                {favorites.shows.length > 0 && (
                  <div>
                    <SubLabel>TV shows · {favorites.shows.length}</SubLabel>
                    <PosterGrid items={favorites.shows} type="tv" cols={8} />
                  </div>
                )}
                {favorites.movies.length > 0 && (
                  <div>
                    <SubLabel>Movies · {favorites.movies.length}</SubLabel>
                    <PosterGrid items={favorites.movies} type="movie" cols={8} />
                  </div>
                )}
                {favorites.collections.length > 0 && (
                  <div>
                    <SubLabel>Collections · {favorites.collections.length}</SubLabel>
                    <CollectionPosterGrid items={favorites.collections} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Watchlist + Watched side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <section>
              <SectionHeader
                title="Watchlist"
                note={String(totalWatchlist)}
                action={<SectionLink to="/watchlist">View all</SectionLink>}
                className="mb-4"
              />
              <div>
                {watchlistPreview.shows.length > 0 && (
                  <div className="mb-4">
                    <SubLabel>TV</SubLabel>
                    <PosterGrid items={watchlistPreview.shows} type="tv" cols={5} />
                  </div>
                )}
                {watchlistPreview.movies.length > 0 && (
                  <div>
                    <SubLabel>Movies</SubLabel>
                    <PosterGrid items={watchlistPreview.movies} type="movie" cols={5} />
                  </div>
                )}
                {totalWatchlist === 0 && !summaryLoading && (
                  <p className="text-neutral-500 text-label">Your watchlist is empty.</p>
                )}
              </div>
            </section>

            <section>
              <SectionHeader
                title="Watched"
                note={String(totalWatched)}
                action={<SectionLink to="/watched">View all</SectionLink>}
                className="mb-4"
              />
              <div>
                {watchedPreview.shows.length > 0 && (
                  <div className="mb-4">
                    <SubLabel>TV</SubLabel>
                    <PosterGrid items={watchedPreview.shows} type="tv" cols={5} />
                  </div>
                )}
                {watchedPreview.movies.length > 0 && (
                  <div>
                    <SubLabel>Movies</SubLabel>
                    <PosterGrid items={watchedPreview.movies} type="movie" cols={5} />
                  </div>
                )}
                {totalWatched === 0 && !summaryLoading && (
                  <p className="text-neutral-500 text-label">Nothing watched yet.</p>
                )}
              </div>
            </section>
          </div>

          {/* Shelves */}
          {shelves.length > 0 && (
            <section>
              <SectionHeader
                title="Shelves"
                note={`${shelves.length} curated`}
                action={<SectionLink to="/shelves">Manage</SectionLink>}
                className="mb-4"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {shelves.map((shelf) => (
                  <Link
                    key={shelf.id}
                    to={`/shelves/${shelf.id}`}
                    className={cx(
                      "group block bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-surface p-4 transition-colors",
                      focusRing,
                    )}
                  >
                    <h3 className="font-semibold text-body text-neutral-100 group-hover:text-primary-300 transition-colors truncate">
                      {shelf.name}
                    </h3>
                    <div className="text-caption text-neutral-500 mt-1 tabular">
                      {shelf.item_count} {shelf.item_count === 1 ? "title" : "titles"}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Stats */}
          <section>
            <SectionHeader
              title="Your stats"
              action={<SectionLink to="/stats">Full stats</SectionLink>}
              className="mb-4"
            />
            <Suspense fallback={<div className="h-40" />}>
              <StatsSection />
            </Suspense>
          </section>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-8 lg:sticky lg:top-24 lg:self-start">

          {/* About */}
          <section>
            <SectionHeader title="About" className="mb-4" />
            <div className="grid gap-x-4 gap-y-2.5 text-label" style={{ gridTemplateColumns: "72px 1fr" }}>
              <span className="text-caption text-neutral-400">Joined</span>
              <span className="font-medium text-neutral-200">{memberSince}</span>
              <span className="text-caption text-neutral-400">Plan</span>
              <span className="font-medium text-neutral-200 flex items-center gap-1.5">
                {typedDbUser?.subscription_tier === "premium" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-warning-400 inline-block" />
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
              <span className="text-caption text-neutral-400">Visibility</span>
              <span className="font-medium text-neutral-200 capitalize">
                {typedDbUser?.profile_visibility?.replace("_", " ") ?? "—"}
              </span>
              {user.email && (
                <>
                  <span className="text-caption text-neutral-400">Email</span>
                  <span className="font-medium text-neutral-200 text-caption truncate">{user.email}</span>
                </>
              )}
            </div>
            {/* Avatar color picker hint */}
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <div className="text-caption text-neutral-400 mb-2.5">Avatar color</div>
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
                className="mt-2 inline-block text-caption text-neutral-300 hover:text-primary-300 transition-colors"
              >
                Change in settings
              </Link>
            </div>
          </section>

          {/* Friends — isolated component, tab state doesn't re-render the hero */}
          <FriendsWidget />
        </div>
      </div>
    </div>
  );
}
