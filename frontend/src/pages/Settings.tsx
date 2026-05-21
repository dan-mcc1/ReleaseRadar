import { useState, useEffect, useMemo, useRef } from "react";
import { useMyBlocks, useUnblockUser } from "../hooks/api/useModeration";
import { isPremiumFeature } from "../config/features";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuthUser } from "../hooks/useAuthUser";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { AVATAR_PRESETS, getAvatarColor, BASE_IMAGE_URL, API_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { useQuery } from "@tanstack/react-query";
import { queryFetch } from "../hooks/api/queryFetch";
import { queryKeys } from "../hooks/api/queryKeys";
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
import StreamingOptimizer from "../components/StreamingOptimizer";
import {
  useAllProviders,
  useMyStreamingServices,
  useAddStreamingService,
  useRemoveStreamingService,
} from "../hooks/api/useStreamingServices";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

const TIMEZONE_OPTIONS: [string, string][] = [
  ["UTC", "UTC"],
  ["America/New_York", "Eastern (ET)"],
  ["America/Chicago", "Central (CT)"],
  ["America/Denver", "Mountain (MT)"],
  ["America/Los_Angeles", "Pacific (PT)"],
  ["America/Phoenix", "Arizona (MT)"],
  ["America/Anchorage", "Alaska (AKT)"],
  ["Pacific/Honolulu", "Hawaii (HT)"],
  ["America/Toronto", "Toronto (ET)"],
  ["America/Vancouver", "Vancouver (PT)"],
  ["America/Sao_Paulo", "São Paulo (BRT)"],
  ["Europe/London", "London (GMT)"],
  ["Europe/Paris", "Paris (CET)"],
  ["Europe/Berlin", "Berlin (CET)"],
  ["Europe/Rome", "Rome (CET)"],
  ["Europe/Madrid", "Madrid (CET)"],
  ["Europe/Amsterdam", "Amsterdam (CET)"],
  ["Africa/Johannesburg", "Johannesburg (SAST)"],
  ["Asia/Kolkata", "India (IST)"],
  ["Asia/Singapore", "Singapore (SGT)"],
  ["Asia/Shanghai", "China (CST)"],
  ["Asia/Tokyo", "Tokyo (JST)"],
  ["Asia/Seoul", "Seoul (KST)"],
  ["Australia/Sydney", "Sydney (AEST)"],
  ["Australia/Melbourne", "Melbourne (AEST)"],
  ["Pacific/Auckland", "Auckland (NZST)"],
];

const SECTION_IDS = [
  "profile",
  "notifications",
  "streaming",
  "calendar",
  "privacy",
  "subscription",
  "account",
] as const;
type SectionId = (typeof SECTION_IDS)[number];

// ─── Primitives ────────────────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-primary-600" : "bg-neutral-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function SectionCard({
  id,
  title,
  subtitle,
  children,
}: {
  id: SectionId;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`settings-${id}`}
      className="bg-neutral-800/50 border border-neutral-700/40 rounded-2xl p-7"
    >
      <h2 className="text-xl font-semibold tracking-tight text-white mb-1">
        {title}
      </h2>
      {subtitle && (
        <p className="text-[13px] text-neutral-400 mb-6">{subtitle}</p>
      )}
      {children}
    </section>
  );
}

function FieldWrap({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-neutral-400 font-medium">{label}</span>
      {children}
    </label>
  );
}

function FieldInput({
  value,
  onChange,
  readOnly,
  prefix,
  multiline,
  placeholder,
  maxLength,
  suffix,
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  prefix?: string;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="flex items-center bg-neutral-900/70 border border-neutral-700/50 rounded-xl px-3 gap-1">
      {prefix && (
        <span className="text-neutral-500 text-[14px] shrink-0">{prefix}</span>
      )}
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={2}
          className="flex-1 bg-transparent text-neutral-100 placeholder-neutral-600 text-[14px] py-2.5 outline-none resize-none"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          maxLength={maxLength}
          className="flex-1 bg-transparent text-neutral-100 placeholder-neutral-600 text-[14px] py-2.5 outline-none min-w-0"
        />
      )}
      {suffix}
    </div>
  );
}

// ─── Avatar ────────────────────────────────────────────────────────────────────

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

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  usePageTitle("Settings");
  const user = useAuthUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("profile");
  const manualSection = useRef<SectionId | null>(null);

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

  const [bio, setBio] = useState("");
  const [bioSaved, setBioSaved] = useState(false);
  useEffect(() => {
    if (userMe) setBio(userMe.bio ?? "");
  }, [userMe?.bio]);

  const [selectedAvatar, setSelectedAvatar] = useState<
    string | null | undefined
  >(undefined);
  const [avatarSaved, setAvatarSaved] = useState(false);
  useEffect(() => {
    if (userMe && selectedAvatar === undefined)
      setSelectedAvatar(userMe.avatar_key);
  }, [userMe]);

  const emailNotifications = prefs?.email_notifications ?? null;
  const notificationFrequency = prefs?.notification_frequency ?? "daily";
  const profileVisibility = prefs?.profile_visibility ?? "friends_only";
  const notifyNewSeasons = prefs?.notify_new_seasons ?? true;
  const notifyStreamingChanges = prefs?.notify_streaming_changes ?? true;
  const notifyTrailers = prefs?.notify_trailers ?? true;
  const digestHour = prefs?.digest_hour ?? 9;
  const digestTimezone = prefs?.digest_timezone ?? "America/New_York";
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const timezoneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        timezoneRef.current &&
        !timezoneRef.current.contains(e.target as Node)
      )
        setTimezoneOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
  const { data: allProviders } = useAllProviders();
  const { data: myServices } = useMyStreamingServices();
  const addService = useAddStreamingService();
  const removeService = useRemoveStreamingService();
  const myServiceIds = new Set((myServices ?? []).map((p) => p.id));
  const [providerSearch, setProviderSearch] = useState("");

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

  const allNotifyOn =
    Array.isArray(watchlistNotifyItems) &&
    watchlistNotifyItems.every((i) => i.notify);

  // Calendar sync
  const [calCopied, setCalCopied] = useState(false);
  const [openInstructions, setOpenInstructions] = useState<string | null>(null);
  const { data: calTokenData, isLoading: calLoading } = useQuery({
    queryKey: queryKeys.icalToken(user?.uid ?? ""),
    queryFn: () => queryFetch<{ token: string }>("/ical/token"),
    enabled: !!user,
    staleTime: Infinity,
  });
  const feedUrl = calTokenData?.token
    ? `${API_URL}/ical/feed/${calTokenData.token}`
    : null;

  const [exporting, setExporting] = useState(false);

  // Scroll to section from URL hash
  useEffect(() => {
    const hashMap: Record<string, SectionId> = {
      "#notifications": "notifications",
      "#streaming": "streaming",
      "#privacy": "privacy",
      "#account": "account",
    };
    const target = hashMap[location.hash];
    if (target) {
      setTimeout(() => {
        scrollToSection(target);
      }, 150);
    }
  }, [location.hash]);

  // Scroll listener: find the last section whose top is at or above the navbar
  useEffect(() => {
    function onScroll() {
      if (manualSection.current) return;
      let current: SectionId = SECTION_IDS[0];
      for (const id of SECTION_IDS) {
        const el = document.getElementById(`settings-${id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 96) current = id;
      }
      setActiveSection(current);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToSection(id: SectionId) {
    const el = document.getElementById(`settings-${id}`);
    if (!el) return;
    manualSection.current = id;
    setActiveSection(id);
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: "smooth" });
    // Release manual lock once scroll settles
    setTimeout(() => { manualSection.current = null; }, 1000);
  }

  function patchPreferences(patch: Record<string, unknown>) {
    if (prefSaving) return;
    updatePrefsMutation.mutate(patch as any);
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
        "Are you sure you want to permanently delete your account? This cannot be undone."
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
          "Please sign out and sign back in before deleting your account."
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

  async function handleExport() {
    setExporting(true);
    try {
      const { apiFetch } = await import("../utils/apiFetch");
      const res = await apiFetch("/export/zip");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `releaseradar-${userMe?.username ?? "export"}-${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail — user will notice no download
    } finally {
      setExporting(false);
    }
  }

  function copyCalUrl() {
    if (!feedUrl) return;
    navigator.clipboard.writeText(feedUrl);
    setCalCopied(true);
    setTimeout(() => setCalCopied(false), 2000);
  }

  if (!user) {
    return (
      <div className="p-6 text-center text-neutral-600">
        You must be signed in to view this page.
      </div>
    );
  }

  const avatarChanged = selectedAvatar !== userMe?.avatar_key;

  const navItems: { id: SectionId; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "notifications", label: "Notifications" },
    { id: "streaming", label: "Streaming services" },
    { id: "calendar", label: "Calendar sync" },
    { id: "privacy", label: "Privacy" },
    { id: "subscription", label: "Subscription" },
    { id: "account", label: "Account" },
  ];

  return (
    <div className="pb-24">
      {/* Page header */}
      <div className="px-6 lg:px-10 pt-8 pb-2">
        <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
          Account
        </p>
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
          Settings
        </h1>
      </div>

      <div className="px-6 lg:px-10 pt-6 pb-10 flex gap-10">
        {/* ── Left nav ── */}
        <nav className="hidden lg:flex flex-col gap-0.5 w-[210px] shrink-0 sticky top-24 self-start">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                scrollToSection(item.id);
              }}
              className={`px-3.5 py-2.5 text-[13.5px] font-medium rounded-xl text-left transition-colors ${
                activeSection === item.id
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* ── Sections ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          {/* ── Profile ── */}
          <SectionCard
            id="profile"
            title="Profile"
            subtitle="How others see you on Release Radar."
          >
            {/* Avatar header row */}
            <div className="flex items-center gap-5 pb-6 mb-6 border-b border-neutral-700/40">
              <AvatarPreview
                avatarKey={selectedAvatar}
                photoURL={user.photoURL}
                size={68}
              />
              <div>
                <p className="text-[16px] font-semibold tracking-tight text-white">
                  {userMe?.username ? `@${userMe.username}` : user.email}
                </p>
                <p className="text-[13px] text-neutral-400 mt-0.5">
                  {user.email}
                </p>
              </div>
            </div>

            {/* Avatar color picker */}
            <div className="mb-6">
              <p className="text-[12px] text-neutral-400 font-medium mb-2.5">
                Avatar color
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {user.photoURL && (
                  <button
                    onClick={() => setSelectedAvatar(null)}
                    title="Use Google photo"
                    className={`w-8 h-8 rounded-full overflow-hidden transition-all ${
                      selectedAvatar === null
                        ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-900 scale-110"
                        : "opacity-60 hover:opacity-100"
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
                    className={`w-8 h-8 rounded-full transition-all ${
                      selectedAvatar === preset.key
                        ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-900 scale-110"
                        : "opacity-60 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
              {avatarChanged && (
                <button
                  onClick={saveAvatar}
                  disabled={updateAvatarMutation.isPending}
                  className="text-sm bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                >
                  {updateAvatarMutation.isPending
                    ? "Saving…"
                    : avatarSaved
                      ? "Saved!"
                      : "Save avatar"}
                </button>
              )}
            </div>

            {/* Fields grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrap label="Email">
                <FieldInput value={user.email ?? ""} readOnly />
              </FieldWrap>

              <FieldWrap label="Username">
                {editingUsername ? (
                  <div>
                    <FieldInput
                      value={newUsername}
                      onChange={(v) => {
                        setNewUsername(v);
                        setUsernameError(null);
                      }}
                      prefix="@"
                      placeholder="username"
                      suffix={
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={saveUsername}
                            disabled={
                              updateUsernameMutation.isPending ||
                              usernameAvailable === false
                            }
                            className="text-xs bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingUsername(false);
                              setNewUsername("");
                              setUsernameError(null);
                            }}
                            className="text-neutral-400 hover:text-neutral-200 text-xs px-1.5 py-1"
                          >
                            ✕
                          </button>
                        </div>
                      }
                    />
                    {newUsername.length >= 3 && (
                      <p
                        className={`text-xs mt-1 ${
                          usernameChecking
                            ? "text-neutral-400"
                            : usernameAvailable === true
                              ? "text-success-400"
                              : usernameAvailable === false
                                ? "text-error-400"
                                : "text-neutral-400"
                        }`}
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
                      <p className="text-error-400 text-xs mt-1">
                        {usernameError}
                      </p>
                    )}
                  </div>
                ) : (
                  <FieldInput
                    value={
                      userMe?.username ? `@${userMe.username}` : "Not set"
                    }
                    readOnly
                    suffix={
                      <button
                        onClick={() => {
                          setEditingUsername(true);
                          setNewUsername(userMe?.username ?? "");
                        }}
                        className="text-xs text-primary-400 hover:text-primary-300 shrink-0 py-2.5"
                      >
                        {userMe?.username ? "Change" : "Set"}
                      </button>
                    }
                  />
                )}
              </FieldWrap>

              <div className="sm:col-span-2">
                <FieldWrap label="Bio">
                  <FieldInput
                    value={bio}
                    onChange={setBio}
                    multiline
                    placeholder="Tell people a little about yourself…"
                    maxLength={300}
                  />
                </FieldWrap>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-neutral-600">
                    {bio.length}/300
                  </span>
                  <button
                    onClick={saveBio}
                    disabled={
                      updateBioMutation.isPending ||
                      bio === (userMe?.bio ?? "")
                    }
                    className="text-sm bg-primary-600 enabled:hover:bg-primary-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {updateBioMutation.isPending
                      ? "Saving…"
                      : bioSaved
                        ? "Saved!"
                        : "Save bio"}
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* ── Notifications ── */}
          <SectionCard
            id="notifications"
            title="Notifications"
            subtitle="Control what you hear about — and when."
          >
            {/* Email master toggle */}
            <div data-tour="notifications-toggle" className="flex items-center justify-between py-3.5 border-b border-neutral-700/40">
              <div>
                <p className="text-[14px] font-semibold text-white">
                  Email notifications
                </p>
                <p className="text-[12.5px] text-neutral-400 mt-0.5">
                  Digest of upcoming releases and friend recommendations.
                </p>
              </div>
              <Toggle
                on={emailNotifications ?? false}
                onChange={() =>
                  emailNotifications !== null &&
                  patchPreferences({
                    email_notifications: !emailNotifications,
                  })
                }
                disabled={prefSaving || emailNotifications === null}
              />
            </div>

            {emailNotifications && (
              <div className="py-4 border-b border-neutral-700/40 space-y-4">
                <div>
                  <p className="text-[13px] font-medium text-white mb-2">
                    Digest frequency
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

                <div>
                  <p className="text-[13px] font-medium text-white mb-2">
                    Digest time
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <select
                      value={digestHour}
                      onChange={(e) =>
                        patchPreferences({ digest_hour: Number(e.target.value) })
                      }
                      disabled={prefSaving}
                      className="bg-neutral-900/70 text-neutral-100 text-sm px-3 py-2 rounded-xl border border-neutral-700/50 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50"
                    >
                      {Array.from({ length: 24 }, (_, h) => {
                        const period = h < 12 ? "AM" : "PM";
                        const h12 = h % 12 === 0 ? 12 : h % 12;
                        return (
                          <option key={h} value={h}>
                            {h12}:00 {period}
                          </option>
                        );
                      })}
                    </select>
                    <div ref={timezoneRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setTimezoneOpen((o) => !o)}
                        disabled={prefSaving}
                        className="bg-neutral-900/70 text-neutral-100 text-sm px-3 py-2 rounded-xl border border-neutral-700/50 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50 flex items-center gap-2 min-w-44"
                      >
                        <span className="flex-1 text-left">
                          {TIMEZONE_OPTIONS.find(
                            ([v]) => v === digestTimezone
                          )?.[1] ?? digestTimezone}
                        </span>
                        <svg
                          className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${timezoneOpen ? "rotate-180" : ""}`}
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
                      {timezoneOpen && (
                        <ul className="absolute left-0 top-full mt-1 z-50 bg-neutral-800 border border-neutral-700 rounded-xl shadow-xl overflow-y-auto max-h-[170px] min-w-full">
                          {TIMEZONE_OPTIONS.map(([value, label]) => (
                            <li key={value}>
                              <button
                                type="button"
                                onClick={() => {
                                  patchPreferences({ digest_timezone: value });
                                  setTimezoneOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                  digestTimezone === value
                                    ? "bg-primary-600 text-white"
                                    : "text-neutral-100 hover:bg-neutral-700"
                                }`}
                              >
                                {label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Premium notification toggles */}
            {[
              {
                key: "notify_new_seasons" as const,
                value: notifyNewSeasons,
                label: "Season premiere alerts",
                desc: "Email me 30 and 7 days before a new season of a tracked show premieres.",
              },
              {
                key: "notify_streaming_changes" as const,
                value: notifyStreamingChanges,
                label: "Streaming availability alerts",
                desc: "Email me when a tracked title arrives on or leaves a streaming service.",
              },
              {
                key: "notify_trailers" as const,
                value: notifyTrailers,
                label: "Trailer alerts",
                desc: "Email me when a new official trailer drops for a tracked title.",
              },
            ].map((item, i, arr) => (
              <div
                key={item.key}
                className={`flex items-center justify-between gap-6 py-3.5 ${
                  i < arr.length - 1 ? "border-b border-neutral-700/40" : ""
                }`}
              >
                <div>
                  <p className="text-[14px] font-semibold text-white flex items-center gap-2">
                    {item.label}
                    {!isPremium && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-2 py-0.5">
                        Premium
                      </span>
                    )}
                  </p>
                  <p className="text-[12.5px] text-neutral-400 mt-0.5">
                    {item.desc}
                  </p>
                </div>
                <Toggle
                  on={isPremium && item.value}
                  onChange={() =>
                    isPremium
                      ? patchPreferences({ [item.key]: !item.value })
                      : setShowUpgradeModal(true)
                  }
                  disabled={prefSaving && isPremium}
                />
              </div>
            ))}

            {/* Per-title subscriptions */}
            <div className="mt-5 pt-5 border-t border-neutral-700/40">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-[13.5px] font-semibold text-white">
                    Notification subscriptions
                  </p>
                  <p className="text-[12px] text-neutral-500 mt-0.5">
                    Control which watchlisted titles appear in your digest.
                  </p>
                </div>
                {!isPremium && (
                  <span className="flex-shrink-0 text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5">
                    Premium
                  </span>
                )}
              </div>

              {isPremium ? (
                watchlistNotifyItems && watchlistNotifyItems.length > 0 ? (
                  <div className="space-y-2">
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
                          className="w-full bg-neutral-900/70 border border-neutral-700/50 rounded-xl pl-8 pr-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-primary-500"
                        />
                      </div>
                      <div className="inline-flex rounded-xl border border-neutral-700/50 overflow-hidden shrink-0">
                        {(["all", "tv", "movie"] as const).map((t, i, arr) => (
                          <button
                            key={t}
                            onClick={() => setNotifyTypeFilter(t)}
                            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              notifyTypeFilter === t
                                ? "bg-primary-600 text-white"
                                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                            } ${i < arr.length - 1 ? "border-r border-neutral-700/50" : ""}`}
                          >
                            {t === "all" ? "All" : t === "tv" ? "TV" : "Film"}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() =>
                          bulkToggleWatchlistNotify.mutate({
                            notify: !allNotifyOn,
                          })
                        }
                        disabled={bulkToggleWatchlistNotify.isPending}
                        className="shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-xl border border-neutral-700/50 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors disabled:opacity-50"
                      >
                        {bulkToggleWatchlistNotify.isPending
                          ? "Saving…"
                          : allNotifyOn
                            ? "Mute all"
                            : "Unmute all"}
                      </button>
                    </div>

                    {(notifySearch || notifyTypeFilter !== "all") && (
                      <p className="text-xs text-neutral-500">
                        {filteredWatchlistItems.length} of{" "}
                        {watchlistNotifyItems.length} titles
                        {notifySearch && (
                          <>
                            {" "}
                            matching "
                            <span className="text-neutral-300">
                              {notifySearch}
                            </span>
                            "
                          </>
                        )}
                      </p>
                    )}

                    <div className="max-h-72 overflow-y-auto rounded-xl border border-neutral-700/40 divide-y divide-neutral-700/30">
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

                    {shelves && shelves.length > 0 && (
                      <div className="space-y-1 mt-2">
                        <p className="text-xs font-medium text-neutral-400 mb-2">
                          Shelves
                        </p>
                        {shelves.map((shelf) => (
                          <div
                            key={shelf.id}
                            className="flex items-center justify-between gap-3 py-2 border-b border-neutral-700/40 last:border-0"
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
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500">
                    Nothing in your watchlist yet.
                  </p>
                )
              ) : (
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-neutral-600 text-sm text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
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
          </SectionCard>

          {/* ── Streaming services ── */}
          <SectionCard
            id="streaming"
            title="Streaming services"
            subtitle="Your subscriptions, used to filter and optimize your watchlist."
          >
            <div className="space-y-6">
              {/* My services */}
              {myServices && myServices.length > 0 && (
                <div>
                  <p className="text-[12px] text-neutral-400 font-medium uppercase tracking-wider mb-3">
                    My services
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {myServices.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => removeService.mutate(p.id)}
                        title={`Remove ${p.name}`}
                        className="relative group"
                      >
                        <img
                          src={`${BASE_IMAGE_URL}/w92${p.logo_path}`}
                          alt={p.name}
                          className="w-14 h-14 rounded-xl ring-2 ring-primary-500 object-cover"
                        />
                        <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg
                            className="w-5 h-5 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-neutral-500 text-xs mt-2">
                    Tap a service to remove it.
                  </p>
                </div>
              )}

              {/* Add services */}
              <div data-tour="streaming-settings">
                <p className="text-[12px] text-neutral-400 font-medium uppercase tracking-wider mb-3">
                  Add services
                </p>
                <div className="relative mb-3">
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
                    placeholder="Search providers…"
                    value={providerSearch}
                    onChange={(e) => setProviderSearch(e.target.value)}
                    className="w-full bg-neutral-900/70 border border-neutral-700/50 rounded-xl pl-8 pr-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-primary-500"
                  />
                </div>
                <div className="flex flex-wrap gap-3 max-h-80 overflow-y-auto">
                  {(allProviders ?? [])
                    .filter(
                      (p) =>
                        !myServiceIds.has(p.id) &&
                        p.name
                          .toLowerCase()
                          .includes(providerSearch.toLowerCase())
                    )
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addService.mutate(p.id)}
                        title={`Add ${p.name}`}
                        className="relative group"
                      >
                        <img
                          src={`${BASE_IMAGE_URL}/w92${p.logo_path}`}
                          alt={p.name}
                          className="w-14 h-14 rounded-xl object-cover ring-1 ring-neutral-600"
                        />
                        <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg
                            className="w-5 h-5 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 4v16m8-8H4"
                            />
                          </svg>
                        </span>
                      </button>
                    ))}
                  {(allProviders ?? []).filter(
                    (p) =>
                      !myServiceIds.has(p.id) &&
                      p.name
                        .toLowerCase()
                        .includes(providerSearch.toLowerCase())
                  ).length === 0 && (
                    <p className="text-neutral-500 text-sm">
                      {providerSearch
                        ? "No providers match your search."
                        : "All providers already added."}
                    </p>
                  )}
                </div>
              </div>

              {/* Optimizer */}
              <div>
                <p className="text-[12px] text-neutral-400 font-medium uppercase tracking-wider mb-3">
                  Watchlist optimizer
                </p>
                <StreamingOptimizer />
              </div>
            </div>
          </SectionCard>

          {/* ── Calendar sync ── */}
          <SectionCard
            id="calendar"
            title="Calendar sync"
            subtitle="Subscribe to your personal iCal feed and see releases in any calendar app."
          >
            <div className="mb-5">
              <p className="text-[12px] text-neutral-400 font-medium uppercase tracking-wider mb-2">
                Your feed URL
              </p>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 min-w-0 bg-neutral-900/70 border border-neutral-700/50 rounded-xl px-3 py-2.5 text-xs text-neutral-300 font-mono truncate flex items-center">
                  {calLoading ? (
                    <span className="text-neutral-500">Generating URL…</span>
                  ) : feedUrl ? (
                    feedUrl
                  ) : (
                    <span className="text-error-500">
                      Failed to load — please refresh
                    </span>
                  )}
                </div>
                <button
                  onClick={copyCalUrl}
                  disabled={!feedUrl || calLoading}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                    calCopied
                      ? "bg-emerald-600/20 border-emerald-600/40 text-emerald-400"
                      : "bg-neutral-700 border-neutral-700/60 text-neutral-200 hover:bg-neutral-600 hover:text-white disabled:opacity-40"
                  }`}
                >
                  {calCopied ? (
                    <>
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
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
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
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-neutral-600">
                Keep this URL private — it gives read access to your watchlist.
              </p>
            </div>

            <p className="text-[12px] text-neutral-400 font-medium uppercase tracking-wider mb-2">
              How to subscribe
            </p>
            <div className="flex flex-col gap-1.5">
              {[
                {
                  name: "Google Calendar",
                  steps: [
                    'Open Google Calendar and click the "+" next to "Other calendars"',
                    'Select "From URL"',
                    "Paste your feed URL and click 'Add calendar'",
                  ],
                },
                {
                  name: "Outlook",
                  steps: [
                    "Go to Outlook Calendar and click 'Add calendar'",
                    'Select "Subscribe from web"',
                    "Paste your feed URL and click 'Import'",
                    "Wait a few minutes for the events to populate your calendar",
                  ],
                },
                {
                  name: "Apple Calendar",
                  steps: [
                    "In the Calendar app, go to your calendars",
                    "Click 'Add Calendar' then click 'Add Subscription Calendar'",
                    "Paste your feed URL and click 'Find'",
                    "Set your preferred auto-refresh interval",
                  ],
                },
              ].map((app) => (
                <div
                  key={app.name}
                  className="rounded-xl border border-neutral-700/40 overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setOpenInstructions(
                        openInstructions === app.name ? null : app.name
                      )
                    }
                    className="w-full flex items-center justify-between px-4 py-3 bg-neutral-900/40 hover:bg-neutral-800/60 text-left transition-colors"
                  >
                    <span className="text-sm font-medium text-neutral-200">
                      {app.name}
                    </span>
                    <svg
                      className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${
                        openInstructions === app.name ? "rotate-180" : ""
                      }`}
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
                  {openInstructions === app.name && (
                    <ol className="px-4 py-3 flex flex-col gap-2 border-t border-neutral-700/40 bg-neutral-950/20">
                      {app.steps.map((step, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 text-sm text-neutral-300"
                        >
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-600/20 text-primary-400 text-xs font-semibold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ── Privacy ── */}
          <SectionCard
            id="privacy"
            title="Privacy"
            subtitle="Control who can see your watchlist and activity."
          >
            <p className="text-[13px] font-semibold text-white mb-3">
              Profile visibility
            </p>
            <div className="space-y-2 mb-6">
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
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors disabled:opacity-50 ${
                    profileVisibility === value
                      ? "border-primary-500/50 bg-primary-600/10"
                      : "border-neutral-700/40 hover:border-neutral-600"
                  }`}
                >
                  <span
                    className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      profileVisibility === value
                        ? "border-primary-400"
                        : "border-neutral-600"
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

            <p className="text-[13px] font-semibold text-white mb-3">
              Blocked users
            </p>
            {blocks.length === 0 ? (
              <p className="text-sm text-neutral-500">
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
                      className="text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-50 border border-neutral-700/50 hover:border-neutral-500 px-3 py-1 rounded-lg transition-colors"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* ── Subscription ── */}
          <SectionCard
            id="subscription"
            title="Subscription"
            subtitle="Manage your Release Radar plan."
          >
            <div className="flex items-center justify-between py-3.5 border-b border-neutral-700/40 mb-5">
              <div>
                <p className="text-[14px] font-semibold text-white">
                  Current plan
                </p>
                <p className="text-[13px] text-neutral-400 mt-0.5 capitalize">
                  {userMe?.subscription_tier ?? "Free"}
                </p>
              </div>
              {!isPremium && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-2 py-0.5">
                  Upgrade available
                </span>
              )}
            </div>
            <Link
              to="/billing"
              className="flex items-center justify-between w-full bg-neutral-900/50 hover:bg-neutral-800/70 border border-neutral-700/40 text-neutral-200 py-3 px-4 rounded-xl transition-colors text-sm"
            >
              <span>
                {isPremium ? "Manage billing" : "Upgrade to Premium"}
              </span>
              <svg
                className="w-4 h-4 text-neutral-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </SectionCard>

          {/* ── Account ── */}
          <SectionCard
            id="account"
            title="Account"
            subtitle="Data, security, and account management."
          >
            {error && (
              <div className="bg-error-900/40 text-error-300 border border-error-700/30 p-3 rounded-xl mb-4 text-sm">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Link
                to="/import"
                className="flex items-center justify-between w-full bg-neutral-900/50 hover:bg-neutral-800/70 border border-neutral-700/40 text-neutral-200 py-3 px-4 rounded-xl transition-colors text-sm"
              >
                <span>Import watch history</span>
                <span className="text-xs text-neutral-500">
                  Letterboxd CSV →
                </span>
              </Link>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center justify-between w-full bg-neutral-900/50 hover:bg-neutral-800/70 disabled:opacity-50 border border-neutral-700/40 text-neutral-200 py-3 px-4 rounded-xl transition-colors text-sm"
              >
                <span>{exporting ? "Exporting…" : "Export my data"}</span>
                <span className="text-xs text-neutral-500">ZIP download →</span>
              </button>
              <button
                onClick={handleSignOut}
                className="w-full bg-neutral-200 hover:bg-neutral-300 text-neutral-800 py-3 rounded-xl font-medium text-sm transition-colors"
              >
                Sign out
              </button>
              <button
                onClick={handleDelete}
                className="w-full bg-error-500/10 hover:bg-error-500/20 text-error-400 border border-error-500/25 py-3 rounded-xl font-medium text-sm transition-colors"
              >
                Delete account
              </button>
            </div>
          </SectionCard>
        </div>
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
