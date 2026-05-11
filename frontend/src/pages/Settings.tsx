import { useState, useEffect, useMemo } from "react";
import { useMyBlocks, useUnblockUser } from "../hooks/api/useModeration";
import { isPremiumFeature } from "../config/features";
import { deleteUser, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuthUser } from "../hooks/useAuthUser";
import { useNavigate, Link } from "react-router-dom";
import { AVATAR_PRESETS, getAvatarColor } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useUserMe,
  useCheckUsername,
  useUpdateUsername,
  useUpdateBio,
  useUpdateAvatar,
  useDeleteAccount,
} from "../hooks/api/useUser";
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from "../hooks/api/useNotifications";
import {
  useWatchlistNotifyPrefs,
  useToggleWatchlistNotify,
  useBulkToggleWatchlistNotify,
} from "../hooks/api/useWatchlistNotify";
import { useShelves, useToggleShelfNotify } from "../hooks/api/useShelves";
import ProUpgradeModal from "../components/ProUpgradeModal";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

function AvatarPreview({
  avatarKey,
  photoURL,
  size = 72,
}: {
  avatarKey: string | null | undefined;
  photoURL?: string | null;
  size?: number;
}) {
  const color = getAvatarColor(avatarKey);
  if (!color && photoURL) {
    return (
      <img
        src={photoURL}
        alt="Profile"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color ?? "#475569",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="rgba(255,255,255,0.9)"
      >
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
      </svg>
    </div>
  );
}

export default function Settings() {
  usePageTitle("Settings");
  const user = useAuthUser();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const { data: userMe } = useUserMe();
  const { data: prefs } = useNotificationPrefs();
  const updatePrefsMutation = useUpdateNotificationPrefs();
  const { data: watchlistNotifyItems } = useWatchlistNotifyPrefs();
  const toggleWatchlistNotify = useToggleWatchlistNotify();
  const { data: shelves } = useShelves();
  const toggleShelfNotify = useToggleShelfNotify();
  const updateUsernameMutation = useUpdateUsername();
  const updateBioMutation = useUpdateBio();
  const updateAvatarMutation = useUpdateAvatar();
  const deleteAccountMutation = useDeleteAccount();

  // Username editing
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);

  useEffect(() => {
    if (newUsername.length < 3) {
      setDebouncedUsername("");
      return;
    }
    const t = setTimeout(() => setDebouncedUsername(newUsername), 400);
    return () => clearTimeout(t);
  }, [newUsername]);

  const { data: usernameCheck, isFetching: usernameChecking } =
    useCheckUsername(debouncedUsername);
  const usernameAvailable =
    debouncedUsername.length >= 3 ? (usernameCheck?.available ?? null) : null;

  // Bio — local state for form editing, synced from query data on load
  const [bio, setBio] = useState("");
  const [bioSaved, setBioSaved] = useState(false);
  useEffect(() => {
    if (userMe) setBio(userMe.bio ?? "");
  }, [userMe?.bio]);

  // Avatar — local state for picker, synced from query data on load
  const [selectedAvatar, setSelectedAvatar] = useState<
    string | null | undefined
  >(undefined);
  const [avatarSaved, setAvatarSaved] = useState(false);
  useEffect(() => {
    if (userMe && selectedAvatar === undefined)
      setSelectedAvatar(userMe.avatar_key);
  }, [userMe]);

  // Derived from query data
  const emailNotifications = prefs?.email_notifications ?? null;
  const notificationFrequency = prefs?.notification_frequency ?? "daily";
  const profileVisibility = prefs?.profile_visibility ?? "friends_only";
  const notifyNewSeasons = prefs?.notify_new_seasons ?? true;
  const notifyStreamingChanges = prefs?.notify_streaming_changes ?? true;
  const prefSaving = updatePrefsMutation.isPending;
  const isPremium =
    userMe?.subscription_tier === "premium" ||
    userMe?.subscription_tier === "admin";
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [notifySearch, setNotifySearch] = useState("");
  const [notifyTypeFilter, setNotifyTypeFilter] = useState<
    "all" | "tv" | "movie"
  >("all");
  const bulkToggleWatchlistNotify = useBulkToggleWatchlistNotify();
  const { data: blocksData } = useMyBlocks();
  const unblockMutation = useUnblockUser();
  const blocks: {
    user_id: string;
    username: string | null;
    blocked_at: string;
  }[] = (blocksData as any) ?? [];

  const filteredWatchlistItems = useMemo(() => {
    if (!Array.isArray(watchlistNotifyItems)) return [];
    return watchlistNotifyItems.filter((item) => {
      const matchesType =
        notifyTypeFilter === "all" || item.content_type === notifyTypeFilter;
      const matchesSearch = item.name
        .toLowerCase()
        .includes(notifySearch.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [watchlistNotifyItems, notifySearch, notifyTypeFilter]);

  const allNotifyOn = Array.isArray(watchlistNotifyItems) && watchlistNotifyItems.every((i) => i.notify);

  function patchPreferences(patch: Record<string, unknown>) {
    if (prefSaving) return;
    updatePrefsMutation.mutate(patch as any);
  }

  function handleUsernameInput(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setNewUsername(value);
    setUsernameError(null);
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
    setUsernameError(null);
    try {
      await updateUsernameMutation.mutateAsync(newUsername);
      setEditingUsername(false);
      setNewUsername("");
    } catch (err: any) {
      setUsernameError(err?.detail ?? "Could not save username.");
    }
  }

  async function saveBio() {
    await updateBioMutation.mutateAsync(bio.trim() || null);
    setBioSaved(true);
    setTimeout(() => setBioSaved(false), 2000);
  }

  async function saveAvatar() {
    if (selectedAvatar === userMe?.avatar_key) return;
    await updateAvatarMutation.mutateAsync(selectedAvatar ?? null);
    setAvatarSaved(true);
    setTimeout(() => setAvatarSaved(false), 2000);
  }

  const handleDelete = async () => {
    if (!user) return;
    if (
      !window.confirm(
        "Are you sure you want to permanently delete your account? This cannot be undone.",
      )
    )
      return;
    setError(null);
    try {
      await deleteAccountMutation.mutateAsync();
      await signOut(auth);
      navigate("/signIn");
    } catch (err: any) {
      if (err.code === "auth/requires-recent-login") {
        setError(
          "Please sign out and sign back in before deleting your account.",
        );
      } else {
        setError(err.message);
      }
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    navigate("/");
  };

  if (!user) {
    return (
      <div className="p-6 text-center text-neutral-600">
        You must be signed in to view this page.
      </div>
    );
  }

  const avatarChanged = selectedAvatar !== userMe?.avatar_key;

  return (
    <div className="p-6 max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      {error && (
        <div className="bg-error-100 text-error-700 p-3 rounded">{error}</div>
      )}

      {/* ── Profile ── */}
      <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-5">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
          Profile
        </h2>

        <div>
          <p className="text-grneutralay-400 text-sm font-medium mb-1">
            Logged in as
          </p>
          <p className="text-white font-semibold">{user.email}</p>
        </div>

        {/* Username */}
        <div>
          <p className="text-neutral-400 text-sm font-medium mb-2">Username</p>
          {editingUsername ? (
            <div className="flex flex-col gap-1">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={newUsername}
                  onChange={handleUsernameInput}
                  placeholder="new_username"
                  className="bg-neutral-700 text-neutral-100 px-3 py-1.5 rounded text-sm w-44 focus:outline-none focus:ring-2 focus:ring-primary-400 placeholder-neutral-500"
                />
                <button
                  onClick={saveUsername}
                  disabled={
                    updateUsernameMutation.isPending ||
                    usernameAvailable === false
                  }
                  className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
                >
                  {updateUsernameMutation.isPending ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingUsername(false);
                    setNewUsername("");
                    setUsernameError(null);
                  }}
                  className="text-neutral-400 hover:text-neutral-200 text-sm"
                >
                  Cancel
                </button>
              </div>
              {newUsername.length >= 3 && (
                <p
                  className={`text-xs pl-1 ${usernameChecking ? "text-neutral-400" : usernameAvailable === true ? "text-success-400" : usernameAvailable === false ? "text-error-400" : "text-neutral-400"}`}
                >
                  {usernameChecking
                    ? "Checking…"
                    : usernameAvailable === true
                      ? "Available"
                      : usernameAvailable === false
                        ? "Already taken"
                        : ""}
                </p>
              )}
              {usernameError && (
                <p className="text-error-400 text-xs pl-1">{usernameError}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {userMe?.username ? (
                <span className="text-white font-medium">
                  @{userMe.username}
                </span>
              ) : (
                <span className="text-amber-400 text-sm">No username set</span>
              )}
              <button
                onClick={() => {
                  setEditingUsername(true);
                  setNewUsername(userMe?.username ?? "");
                }}
                className="text-xs text-primary-400 hover:text-primary-300"
              >
                {userMe?.username ? "Change" : "Set username"}
              </button>
            </div>
          )}
        </div>

        {/* Avatar picker */}
        <div>
          <p className="text-neutral-400 text-sm font-medium mb-3">Avatar</p>
          <div className="flex items-center gap-4 mb-3">
            <AvatarPreview
              avatarKey={selectedAvatar}
              photoURL={user.photoURL}
              size={64}
            />
            <span className="text-neutral-400 text-sm">
              {selectedAvatar
                ? AVATAR_PRESETS.find((p) => p.key === selectedAvatar)?.label
                : user.photoURL
                  ? "Google photo"
                  : "None"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {user.photoURL && (
              <button
                onClick={() => setSelectedAvatar(null)}
                title="Use Google photo"
                className={`w-9 h-9 rounded-full overflow-hidden transition-all ${
                  selectedAvatar === null
                    ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-800 scale-110"
                    : "opacity-70 hover:opacity-100 hover:scale-105"
                }`}
              >
                <img
                  src={user.photoURL}
                  alt="Google photo"
                  className="w-full h-full object-cover"
                />
              </button>
            )}
            {AVATAR_PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => setSelectedAvatar(preset.key)}
                title={preset.label}
                style={{ backgroundColor: preset.color }}
                className={`w-9 h-9 rounded-full transition-all ${
                  selectedAvatar === preset.key
                    ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-800 scale-110"
                    : "opacity-70 hover:opacity-100 hover:scale-105"
                }`}
              />
            ))}
          </div>
          <button
            onClick={saveAvatar}
            disabled={updateAvatarMutation.isPending || !avatarChanged}
            className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-sm px-4 py-1.5 rounded"
          >
            {updateAvatarMutation.isPending
              ? "Saving…"
              : avatarSaved
                ? "Saved!"
                : "Save Avatar"}
          </button>
        </div>

        {/* Bio */}
        <div>
          <p className="text-neutral-400 text-sm font-medium mb-2">Bio</p>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Tell people a little about yourself…"
            className="w-full bg-neutral-700 text-neutral-100 placeholder-neutral-500 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-neutral-500">{bio.length}/300</span>
            <button
              onClick={saveBio}
              disabled={
                updateBioMutation.isPending || bio === (userMe?.bio ?? "")
              }
              className="bg-primary-600 enabled:hover:bg-primary-500 disabled:opacity-40 text-white text-sm px-4 py-1.5 rounded"
            >
              {updateBioMutation.isPending
                ? "Saving…"
                : bioSaved
                  ? "Saved!"
                  : "Save Bio"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Notifications ── */}
      <div
        id="notifications"
        className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-5"
      >
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
          Notifications
        </h2>

        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-white font-medium">Email Notifications</p>
            <p className="text-neutral-400 text-sm">
              Digest of upcoming releases and emails when a friend sends a
              recommendation.
            </p>
          </div>
          <button
            onClick={() => {
              if (emailNotifications === null) return;
              patchPreferences({ email_notifications: !emailNotifications });
            }}
            disabled={prefSaving || emailNotifications === null}
            className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              emailNotifications ? "bg-primary-600" : "bg-neutral-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                emailNotifications ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {emailNotifications && (
          <div>
            <p className="text-white font-medium mb-1">Digest Frequency</p>
            <p className="text-neutral-400 text-sm mb-3">
              How often to receive your release digest. Weekly emails cover the
              full upcoming week; monthly cover the whole month.
            </p>
            <div className="flex gap-2">
              {(["daily", "weekly", "monthly"] as const).map((freq) => {
                const locked =
                  freq === "daily" &&
                  isPremiumFeature("notificationSettings") &&
                  !isPremium;
                return (
                  <button
                    key={freq}
                    onClick={() =>
                      locked
                        ? setShowUpgradeModal(true)
                        : patchPreferences({ notification_frequency: freq })
                    }
                    disabled={prefSaving && !locked}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
                      notificationFrequency === freq && !locked
                        ? "bg-primary-600 text-white"
                        : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                    }`}
                  >
                    {freq.charAt(0).toUpperCase() + freq.slice(1)}
                    {locked && (
                      <svg
                        className="w-3.5 h-3.5 text-neutral-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-white font-medium flex items-center gap-2">
              Season Premiere Alerts
              {!isPremium && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-2 py-0.5">
                  Premium
                </span>
              )}
            </p>
            <p className="text-neutral-400 text-sm">
              Email me 30 and 7 days before a new season of a tracked show
              premieres.
            </p>
          </div>
          <button
            onClick={() =>
              isPremium
                ? patchPreferences({ notify_new_seasons: !notifyNewSeasons })
                : setShowUpgradeModal(true)
            }
            disabled={prefSaving && isPremium}
            className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              isPremium && notifyNewSeasons
                ? "bg-primary-600"
                : "bg-neutral-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isPremium && notifyNewSeasons
                  ? "translate-x-7"
                  : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-white font-medium flex items-center gap-2">
              Streaming Availability Alerts
              {!isPremium && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-2 py-0.5">
                  Premium
                </span>
              )}
            </p>
            <p className="text-neutral-400 text-sm">
              Email me when a tracked title arrives on or leaves a streaming
              service.
            </p>
          </div>
          <button
            onClick={() =>
              isPremium
                ? patchPreferences({
                    notify_streaming_changes: !notifyStreamingChanges,
                  })
                : setShowUpgradeModal(true)
            }
            disabled={prefSaving && isPremium}
            className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              isPremium && notifyStreamingChanges
                ? "bg-primary-600"
                : "bg-neutral-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isPremium && notifyStreamingChanges
                  ? "translate-x-7"
                  : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Notification Subscriptions ── */}
      <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
              Notification Subscriptions
            </h2>
            <p className="text-neutral-500 text-xs mt-1">
              Control which watchlisted titles appear in your digest and
              premiere alerts.
            </p>
          </div>
          {!isPremium && (
            <span className="flex-shrink-0 text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5">
              Premium
            </span>
          )}
        </div>

        {isPremium ? (
          <>
            {/* Per-show toggles */}
            {watchlistNotifyItems && watchlistNotifyItems.length > 0 ? (
              <div className="space-y-2">
                {/* Search + filter + bulk controls */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <svg
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 pointer-events-none"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search titles…"
                      value={notifySearch}
                      onChange={(e) => setNotifySearch(e.target.value)}
                      className="w-full bg-neutral-700 border border-neutral-600 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-primary-500"
                    />
                  </div>
                  <div className="inline-flex rounded-lg border border-neutral-600 overflow-hidden shrink-0">
                    {(["all", "tv", "movie"] as const).map((t, i, arr) => (
                      <button
                        key={t}
                        onClick={() => setNotifyTypeFilter(t)}
                        className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          notifyTypeFilter === t
                            ? "bg-primary-600 text-white"
                            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                        } ${i < arr.length - 1 ? "border-r border-neutral-600" : ""}`}
                      >
                        {t === "all" ? "All" : t === "tv" ? "TV" : "Film"}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      bulkToggleWatchlistNotify.mutate({ notify: !allNotifyOn })
                    }
                    disabled={bulkToggleWatchlistNotify.isPending}
                    className="shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-neutral-600 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {bulkToggleWatchlistNotify.isPending
                      ? "Saving…"
                      : allNotifyOn
                        ? "Mute all"
                        : "Unmute all"}
                  </button>
                </div>

                {/* Results count when filtering */}
                {(notifySearch || notifyTypeFilter !== "all") && (
                  <p className="text-xs text-neutral-500">
                    {filteredWatchlistItems.length} of{" "}
                    {watchlistNotifyItems.length} titles
                    {notifySearch && (
                      <>
                        {" "}
                        matching "
                        <span className="text-neutral-300">{notifySearch}</span>
                        "
                      </>
                    )}
                  </p>
                )}

                {/* List */}
                <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-700 divide-y divide-neutral-700/50">
                  {filteredWatchlistItems.length > 0 ? (
                    filteredWatchlistItems.map((item) => (
                      <div
                        key={`${item.content_type}:${item.content_id}`}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 shrink-0 w-6">
                            {item.content_type === "tv" ? "TV" : "Film"}
                          </span>
                          <span className="text-sm text-white truncate">
                            {item.name}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            toggleWatchlistNotify.mutate({
                              contentType: item.content_type,
                              contentId: item.content_id,
                              notify: !item.notify,
                            })
                          }
                          disabled={
                            toggleWatchlistNotify.isPending ||
                            bulkToggleWatchlistNotify.isPending
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                            item.notify ? "bg-primary-600" : "bg-neutral-600"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              item.notify ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-neutral-500 px-3 py-4 text-center">
                      No titles match your search.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                Nothing in your watchlist yet.
              </p>
            )}

            {/* Per-shelf toggles */}
            {shelves && shelves.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-neutral-400 mb-2">
                  Shelves
                </p>
                {shelves.map((shelf) => (
                  <div
                    key={shelf.id}
                    className="flex items-center justify-between gap-3 py-2 border-b border-neutral-700/50 last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="text-sm text-white truncate block">
                        {shelf.name}
                      </span>
                      {shelf.description && (
                        <span className="text-xs text-neutral-500 truncate block">
                          {shelf.description}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        toggleShelfNotify.mutate({
                          shelfId: shelf.id,
                          notify: !shelf.notify,
                        })
                      }
                      disabled={toggleShelfNotify.isPending}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        shelf.notify ? "bg-primary-600" : "bg-neutral-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          shelf.notify ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <button
            onClick={() => setShowUpgradeModal(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-neutral-600 text-sm text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
          >
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
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            Upgrade to Premium to customize notifications
          </button>
        )}
      </div>

      {/* ── Privacy ── */}
      <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
          Privacy
        </h2>
        <div>
          <p className="text-white font-medium mb-1">Profile Visibility</p>
          <p className="text-neutral-400 text-sm mb-3">
            Controls who can see your watchlist, ratings, and activity.
          </p>
          <div className="space-y-2">
            {(
              [
                {
                  value: "public",
                  label: "Public",
                  desc: "Anyone on the site can see your lists and activity",
                },
                {
                  value: "friends_only",
                  label: "Friends Only",
                  desc: "Only accepted friends can see your lists and activity",
                },
                {
                  value: "private",
                  label: "Private",
                  desc: "Nobody else can see your lists or activity",
                },
              ] as const
            ).map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => patchPreferences({ profile_visibility: value })}
                disabled={prefSaving}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                  profileVisibility === value
                    ? "border-primary-500 bg-primary-600/10"
                    : "border-neutral-600 hover:border-neutral-500"
                }`}
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    profileVisibility === value
                      ? "border-primary-400"
                      : "border-neutral-500"
                  }`}
                >
                  {profileVisibility === value && (
                    <span className="w-2 h-2 rounded-full bg-primary-400" />
                  )}
                </span>
                <span>
                  <span className="block text-white text-sm font-medium">
                    {label}
                  </span>
                  <span className="block text-neutral-400 text-xs mt-0.5">
                    {desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Blocked Users ── */}
      <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
          Blocked Users
        </h2>
        {blocks.length === 0 ? (
          <p className="text-neutral-500 text-sm">
            You haven't blocked anyone.
          </p>
        ) : (
          <div className="space-y-2">
            {blocks.map((b) => (
              <div
                key={b.user_id}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-neutral-300 text-sm">
                  @{b.username ?? b.user_id}
                </span>
                <button
                  onClick={() => unblockMutation.mutate(b.user_id)}
                  disabled={unblockMutation.isPending}
                  className="text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-50 border border-neutral-600 hover:border-neutral-500 px-3 py-1 rounded-lg transition-colors"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Account ── */}
      <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
          Account
        </h2>
        <Link
          to="/import"
          className="flex items-center justify-between w-full bg-neutral-700 hover:bg-neutral-600 text-neutral-200 py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <span>Import Watch History</span>
          <span className="text-xs text-neutral-400">Letterboxd CSV →</span>
        </Link>
        <button
          onClick={handleSignOut}
          className="w-full bg-neutral-200 hover:bg-neutral-300 text-neutral-800 py-2 rounded-lg"
        >
          Sign Out
        </button>
        <button
          onClick={handleDelete}
          className="w-full bg-error-500 hover:bg-error-600 text-white py-2 rounded-lg"
        >
          Delete Account
        </button>
      </div>

      {showUpgradeModal && (
        <ProUpgradeModal
          feature="general"
          onClose={() => setShowUpgradeModal(false)}
        />
      )}
    </div>
  );
}
