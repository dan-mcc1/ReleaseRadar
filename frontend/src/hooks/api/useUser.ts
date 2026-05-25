import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch, checkedFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";
import { isAccountRestricted } from "../../utils/accountState";

interface DBUser {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  bio: string | null;
  profile_visibility: string;
  created_at: string;
  subscription_tier: string;
  onboarding_completed: boolean;
  letterboxd_prompted: boolean;
  warning_count: number;
  has_unread_warning: boolean;
  is_silenced: boolean;
  silenced_until: string | null;
}

export interface AccountStatus {
  is_banned: boolean;
  ban_reason: string | null;
  is_suspended: boolean;
  suspended_until: string | null;
  suspension_reason: string | null;
  is_silenced: boolean;
  silenced_until: string | null;
  has_pending_appeal: boolean;
  pending_appeal_requests_unsilence: boolean;
}

export function useAccountStatus() {
  const user = useAuthUser();
  return useQuery({
    queryKey: ["accountStatus", user?.uid ?? ""],
    queryFn: ({ signal }) => queryFetch<AccountStatus>("/user/account-status", { signal }),
    enabled: !!user,
    // Only poll when the account is actually restricted so we can detect when
    // a ban/suspension is lifted. Normal users get zero background polling.
    refetchInterval: isAccountRestricted() ? 5 * 60_000 : false,
    // Catch bans/suspensions applied in another tab or while this tab was
    // backgrounded — without this, a moderated user might keep using a stale
    // session until they navigate.
    refetchOnWindowFocus: true,
  });
}

export function useSubmitAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ message, requestUnsilence }: { message: string; requestUnsilence: boolean }) =>
      checkedFetch("/user/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, request_unsilence: requestUnsilence }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accountStatus"] });
    },
  });
}

export function useUserMe() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.userMe(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch<DBUser>("/user/me", { signal }),
    enabled: !!user,
  });
}

export function useAcknowledgeWarning() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => checkedFetch("/user/acknowledge-warning", { method: "POST" }),
    onSuccess: () => {
      if (user) queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
    },
  });
}

export function useUserStats() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.userStats(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch("/user/stats", { signal }),
    enabled: !!user,
  });
}

export interface WatchTimeStats {
  year: number | null;
  available_years: number[];
  total_minutes: number;
  movie_minutes: number;
  episode_minutes: number;
  movies_count: number;
  episodes_count: number;
  top_genres: { name: string; minutes: number }[];
  top_platforms: { name: string; logo_path: string | null; minutes: number }[];
  longest_binge: { date: string | null; minutes: number };
  humor_fact: string | null;
}

export function useWatchTimeStats(year: number | null) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.watchTimeStats(user?.uid ?? "", year),
    queryFn: ({ signal }) =>
      queryFetch<WatchTimeStats>(
        `/user/watch-time-stats${year ? `?year=${year}` : ""}`,
        { signal },
      ),
    enabled: !!user,
  });
}

interface ListPreviewItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  added_at?: string;
  watched_at?: string;
}

interface ListPreview {
  movies: ListPreviewItem[];
  shows: ListPreviewItem[];
  total_movies: number;
  total_shows: number;
}

interface FriendEntry {
  friendship_id: number;
  friend: { id: string; username: string; display_name: string | null };
}

interface IncomingRequest {
  friendship_id: number;
  from_user: { id: string; username: string; display_name: string | null };
  created_at: string;
}

interface OutgoingRequest {
  friendship_id: number;
  to_user: { id: string; username: string; display_name: string | null };
  created_at: string;
}

interface FollowerEntry {
  friendship_id: number;
  follower: { id: string; username: string; display_name: string | null };
}

export interface ProfileSummary {
  user: DBUser;
  favorites: {
    movies: ListPreviewItem[];
    shows: ListPreviewItem[];
    collections: { id: number; name: string; poster_path: string | null }[];
  };
  watchlist: ListPreview;
  watched: ListPreview;
  friends: FriendEntry[];
  incoming_requests: IncomingRequest[];
  outgoing_requests: OutgoingRequest[];
  followers: FollowerEntry[];
}

export function useProfileSummary() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.profileSummary(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch<ProfileSummary>("/user/profile-summary", { signal }),
    enabled: !!user,
    staleTime: 60_000,
  });
}

export function useFriendProfile(username: string | undefined) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendProfile(username ?? ""),
    queryFn: async ({ signal }) => {
      const res = await apiFetch(
        `/user/profile/${encodeURIComponent(username!)}`,
        { signal },
      );
      if (res.status === 400) return { isSelf: true } as const;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!user && !!username,
    retry: false,
  });
}

export function useCheckUsername(username: string) {
  return useQuery({
    queryKey: queryKeys.usernameAvailable(username),
    queryFn: ({ signal }) =>
      queryFetch<{ available: boolean }>(
        `/user/check-username?username=${encodeURIComponent(username)}`,
        { signal },
      ),
    enabled: username.length >= 3,
  });
}

export function useUpdateUsername() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newUsername: string) =>
      checkedFetch("/user/update-username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_username: newUsername }),
      }),
    onSuccess: () => {
      if (user) queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
    },
  });
}

export function useUpdateDisplayName() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string | null) =>
      checkedFetch("/user/update-display-name", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
      queryClient.invalidateQueries({ queryKey: queryKeys.profileSummary(user.uid) });
    },
  });
}

export function useUpdateBio() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bio: string | null) =>
      checkedFetch("/user/update-bio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio }),
      }),
    onSuccess: () => {
      if (user) queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
    },
  });
}

export function useUpdateAvatar() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (avatarKey: string | null) =>
      checkedFetch("/user/update-avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_key: avatarKey }),
      }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
      queryClient.invalidateQueries({ queryKey: queryKeys.navAvatar(user.uid) });
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => checkedFetch("/user/account", { method: "DELETE" }),
  });
}

export function useCancelSubscription() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => checkedFetch("/user/subscription/cancel", { method: "POST" }),
    onSuccess: () => {
      if (user) queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
    },
  });
}
