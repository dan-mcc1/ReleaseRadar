import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

interface DBUser {
  id: string;
  email: string;
  username: string;
  avatar_key: string | null;
  bio: string | null;
  profile_visibility: string;
  created_at: string;
}

export function useUserMe() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.userMe(user?.uid ?? ""),
    queryFn: () => queryFetch<DBUser>("/user/me"),
    enabled: !!user,
  });
}

export function useUserStats() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.userStats(user?.uid ?? ""),
    queryFn: () => queryFetch("/user/stats"),
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
  friend: { id: string; username: string };
}

interface IncomingRequest {
  friendship_id: number;
  from_user: { id: string; username: string };
  created_at: string;
}

interface OutgoingRequest {
  friendship_id: number;
  to_user: { id: string; username: string };
  created_at: string;
}

interface FollowerEntry {
  friendship_id: number;
  follower: { id: string; username: string };
}

export interface ProfileSummary {
  user: DBUser;
  favorites: { movies: ListPreviewItem[]; shows: ListPreviewItem[] };
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
    queryFn: () => queryFetch<ProfileSummary>("/user/profile-summary"),
    enabled: !!user,
  });
}

export function useFriendProfile(username: string | undefined) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendProfile(username ?? ""),
    queryFn: async () => {
      const res = await apiFetch(
        `/user/profile/${encodeURIComponent(username!)}`,
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
    queryFn: () =>
      queryFetch<{ available: boolean }>(
        `/user/check-username?username=${encodeURIComponent(username)}`,
      ),
    enabled: username.length >= 3,
  });
}

export function useUpdateUsername() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newUsername: string) =>
      apiFetch("/user/update-username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_username: newUsername }),
      }),
    onSuccess: () => {
      if (user) queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
    },
  });
}

export function useUpdateBio() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bio: string | null) =>
      apiFetch("/user/update-bio", {
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
      apiFetch("/user/update-avatar", {
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
    mutationFn: () => apiFetch("/user/account", { method: "DELETE" }),
  });
}
