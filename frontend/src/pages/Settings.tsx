import { useState, useEffect, useCallback } from "react";
import {
  getAuth,
  onAuthStateChanged,
  deleteUser,
  signOut,
} from "firebase/auth";
import { firebaseApp } from "../firebase";
import { useNavigate } from "react-router-dom";
import { API_URL, AVATAR_PRESETS, getAvatarColor } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

interface DBUser {
  id: string;
  email: string | null;
  username: string | null;
  avatar_key: string | null;
  bio: string | null;
}

/** Renders the current avatar: color preset, Google photo, or grey fallback. */
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
  const auth = getAuth(firebaseApp);
  const [user, setUser] = useState(auth.currentUser);
  const [dbUser, setDbUser] = useState<DBUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Notifications / privacy preferences
  const [emailNotifications, setEmailNotifications] = useState<boolean | null>(
    null,
  );
  const [notificationFrequency, setNotificationFrequency] =
    useState<string>("daily");
  const [profileVisibility, setProfileVisibility] =
    useState<string>("friends_only");
  const [prefSaving, setPrefSaving] = useState(false);

  // Username editing
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaving, setUsernameSaving] = useState(false);

  // Bio
  const [bio, setBio] = useState("");
  const [bioSaving, setBioSaving] = useState(false);
  const [bioSaved, setBioSaved] = useState(false);

  // Avatar
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarSaved, setAvatarSaved] = useState(false);

  const fetchUserData = useCallback(async (tok: string) => {
    try {
      const [meRes, notifRes] = await Promise.all([
        fetch(`${API_URL}/user/me`, {
          headers: { Authorization: `Bearer ${tok}` },
        }),
        fetch(`${API_URL}/notifications/preferences`, {
          headers: { Authorization: `Bearer ${tok}` },
        }),
      ]);
      if (meRes.ok) {
        const data: DBUser = await meRes.json();
        setDbUser(data);
        setSelectedAvatar(data.avatar_key);
        setBio(data.bio ?? "");
      }
      if (notifRes.ok) {
        const data = await notifRes.json();
        setEmailNotifications(data.email_notifications);
        setNotificationFrequency(data.notification_frequency ?? "daily");
        setProfileVisibility(data.profile_visibility ?? "friends_only");
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const tok = await u.getIdToken();
        setToken(tok);
        fetchUserData(tok);
      }
    });
    return () => unsub();
  }, [fetchUserData]);

  // ── Preferences (email toggle, frequency, visibility) ───────────────────
  const patchPreferences = async (patch: Record<string, unknown>) => {
    if (!token || prefSaving) return;
    setPrefSaving(true);
    try {
      const res = await fetch(`${API_URL}/notifications/preferences`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setEmailNotifications(data.email_notifications);
        setNotificationFrequency(data.notification_frequency ?? "daily");
        setProfileVisibility(data.profile_visibility ?? "friends_only");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPrefSaving(false);
    }
  };

  const toggleEmailNotifications = () => {
    if (emailNotifications === null) return;
    patchPreferences({ email_notifications: !emailNotifications });
  };

  // ── Username ─────────────────────────────────────────────────────────────
  async function checkUsername(value: string) {
    if (!USERNAME_RE.test(value)) {
      setUsernameAvailable(null);
      return;
    }
    setUsernameChecking(true);
    try {
      const res = await fetch(
        `${API_URL}/user/check-username?username=${encodeURIComponent(value)}`,
      );
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
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
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

  // ── Bio ──────────────────────────────────────────────────────────────────
  async function saveBio() {
    if (!token || bioSaving) return;
    setBioSaving(true);
    setBioSaved(false);
    try {
      const res = await fetch(`${API_URL}/user/update-bio`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bio: bio.trim() || null }),
      });
      if (res.ok) {
        const updated: DBUser = await res.json();
        setDbUser(updated);
        setBio(updated.bio ?? "");
        setBioSaved(true);
        setTimeout(() => setBioSaved(false), 2000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBioSaving(false);
    }
  }

  // ── Avatar ───────────────────────────────────────────────────────────────
  async function saveAvatar() {
    if (!token || selectedAvatar === dbUser?.avatar_key) return;
    setAvatarSaving(true);
    setAvatarSaved(false);
    try {
      const res = await fetch(`${API_URL}/user/update-avatar`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar_key: selectedAvatar }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDbUser(updated);
        setAvatarSaved(true);
        setTimeout(() => setAvatarSaved(false), 2000);
        window.dispatchEvent(new CustomEvent("avatar-updated"));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAvatarSaving(false);
    }
  }

  // ── Account actions ──────────────────────────────────────────────────────
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
      const tok = await user.getIdToken();
      const res = await fetch(`${API_URL}/user/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) throw new Error("Failed to delete account data");
      await deleteUser(user);
      navigate("/signIn");
    } catch (err: any) {
      console.error("Error deleting account:", err);
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
      <div className="p-6 text-center text-gray-600">
        You must be signed in to view this page.
      </div>
    );
  }

  const avatarChanged = selectedAvatar !== dbUser?.avatar_key;

  return (
    <div className="p-6 max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      {error && (
        <div className="bg-red-100 text-red-700 p-3 rounded">{error}</div>
      )}

      {/* ── Profile ── */}
      <div className="bg-slate-800 shadow-md rounded-lg p-4 space-y-5">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Profile
        </h2>

        <div>
          <p className="text-gray-400 text-sm font-medium mb-1">Logged in as</p>
          <p className="text-white font-semibold">{user.email}</p>
        </div>

        {/* Username */}
        <div>
          <p className="text-gray-400 text-sm font-medium mb-2">Username</p>
          {editingUsername ? (
            <div className="flex flex-col gap-1">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={newUsername}
                  onChange={handleUsernameInput}
                  placeholder="new_username"
                  className="bg-slate-700 text-slate-100 px-3 py-1.5 rounded text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-slate-500"
                />
                <button
                  onClick={saveUsername}
                  disabled={usernameSaving || usernameAvailable === false}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
                >
                  {usernameSaving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingUsername(false);
                    setNewUsername("");
                    setUsernameError(null);
                  }}
                  className="text-slate-400 hover:text-slate-200 text-sm"
                >
                  Cancel
                </button>
              </div>
              {newUsername.length >= 3 && (
                <p
                  className={`text-xs pl-1 ${usernameChecking ? "text-slate-400" : usernameAvailable === true ? "text-green-400" : usernameAvailable === false ? "text-red-400" : "text-slate-400"}`}
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
                <p className="text-red-400 text-xs pl-1">{usernameError}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {dbUser?.username ? (
                <span className="text-white font-medium">
                  @{dbUser.username}
                </span>
              ) : (
                <span className="text-amber-400 text-sm">No username set</span>
              )}
              <button
                onClick={() => {
                  setEditingUsername(true);
                  setNewUsername(dbUser?.username ?? "");
                }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {dbUser?.username ? "Change" : "Set username"}
              </button>
            </div>
          )}
        </div>

        {/* Avatar picker */}
        <div>
          <p className="text-gray-400 text-sm font-medium mb-3">Avatar</p>
          <div className="flex items-center gap-4 mb-3">
            <AvatarPreview
              avatarKey={selectedAvatar}
              photoURL={user.photoURL}
              size={64}
            />
            <span className="text-slate-400 text-sm">
              {selectedAvatar
                ? AVATAR_PRESETS.find((p) => p.key === selectedAvatar)?.label
                : user.photoURL
                  ? "Google photo"
                  : "None"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {/* Google photo option — only shown for Google sign-in users */}
            {user.photoURL && (
              <button
                onClick={() => setSelectedAvatar(null)}
                title="Use Google photo"
                className={`w-9 h-9 rounded-full overflow-hidden transition-all ${
                  selectedAvatar === null
                    ? "ring-2 ring-white ring-offset-2 ring-offset-slate-800 scale-110"
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
                    ? "ring-2 ring-white ring-offset-2 ring-offset-slate-800 scale-110"
                    : "opacity-70 hover:opacity-100 hover:scale-105"
                }`}
              />
            ))}
          </div>
          <button
            onClick={saveAvatar}
            disabled={avatarSaving || !avatarChanged}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm px-4 py-1.5 rounded"
          >
            {avatarSaving ? "Saving…" : avatarSaved ? "Saved!" : "Save Avatar"}
          </button>
        </div>

        {/* Bio */}
        <div>
          <p className="text-gray-400 text-sm font-medium mb-2">Bio</p>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Tell people a little about yourself…"
            className="w-full bg-slate-700 text-slate-100 placeholder-slate-500 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-slate-500">{bio.length}/300</span>
            <button
              onClick={saveBio}
              disabled={bioSaving || bio === (dbUser?.bio ?? "")}
              className="bg-blue-600 enabled:hover:bg-blue-500 disabled:opacity-40 text-white text-sm px-4 py-1.5 rounded"
            >
              {bioSaving ? "Saving…" : bioSaved ? "Saved!" : "Save Bio"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Notifications ── */}
      <div id="notifications" className="bg-slate-800 shadow-md rounded-lg p-4 space-y-5">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Notifications
        </h2>

        {/* Email toggle */}
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-white font-medium">Email Notifications</p>
            <p className="text-gray-400 text-sm">
              Digest of upcoming releases and emails when a friend sends a
              recommendation.
            </p>
          </div>
          <button
            onClick={toggleEmailNotifications}
            disabled={prefSaving || emailNotifications === null}
            className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              emailNotifications ? "bg-blue-600" : "bg-slate-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                emailNotifications ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Frequency — only shown when emails are on */}
        {emailNotifications && (
          <div>
            <p className="text-white font-medium mb-1">Digest Frequency</p>
            <p className="text-gray-400 text-sm mb-3">
              How often to receive your release digest. Weekly emails cover the
              full upcoming week; monthly cover the whole month.
            </p>
            <div className="flex gap-2">
              {(["daily", "weekly", "monthly"] as const).map((freq) => (
                <button
                  key={freq}
                  onClick={() =>
                    patchPreferences({ notification_frequency: freq })
                  }
                  disabled={prefSaving}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
                    notificationFrequency === freq
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {freq.charAt(0).toUpperCase() + freq.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Privacy ── */}
      <div className="bg-slate-800 shadow-md rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Privacy
        </h2>
        <div>
          <p className="text-white font-medium mb-1">Profile Visibility</p>
          <p className="text-gray-400 text-sm mb-3">
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
                    ? "border-blue-500 bg-blue-600/10"
                    : "border-slate-600 hover:border-slate-500"
                }`}
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    profileVisibility === value
                      ? "border-blue-400"
                      : "border-slate-500"
                  }`}
                >
                  {profileVisibility === value && (
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                  )}
                </span>
                <span>
                  <span className="block text-white text-sm font-medium">
                    {label}
                  </span>
                  <span className="block text-slate-400 text-xs mt-0.5">
                    {desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Account ── */}
      <div className="bg-slate-800 shadow-md rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Account
        </h2>
        <button
          onClick={handleSignOut}
          className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded-lg"
        >
          Sign Out
        </button>
        <button
          onClick={handleDelete}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg"
        >
          Delete Account
        </button>
      </div>
    </div>
  );
}
