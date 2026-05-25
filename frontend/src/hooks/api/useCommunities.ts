import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export interface CommunityUser {
  id: string;
  username: string;
  display_name: string | null;
}

export interface Community {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  banner_color: string | null;
  visibility: "public" | "private";
  is_featured: boolean;
  member_count: number;
  created_at: string;
  created_by: string | null;
  viewer_role: "owner" | "admin" | "member" | null;
  members_can_edit_media: boolean;
  viewer_can_edit_media: boolean;
}

export interface CommunityMember {
  user: CommunityUser;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface CommunityMediaItem {
  id: number;
  content_id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  added_by: string | null;
  added_at: string;
}

export interface CommunityMedia {
  movies: CommunityMediaItem[];
  shows: CommunityMediaItem[];
}

export interface CommunityPost {
  id: number;
  community_id: number;
  title: string | null;
  body: string;
  reply_count: number;
  like_count: number;
  viewer_liked: boolean;
  edited_at: string | null;
  created_at: string;
  user: CommunityUser | null;
}

export interface CommunityReply {
  id: number;
  post_id: number;
  body: string;
  like_count: number;
  viewer_liked: boolean;
  edited_at: string | null;
  created_at: string;
  user: CommunityUser | null;
}

// ─── Reads ────────────────────────────────────────────────────────────────

export function useBrowseCommunities(query: string, offset = 0) {
  return useQuery({
    queryKey: queryKeys.communities(query, offset),
    queryFn: ({ signal }) =>
      queryFetch<Community[]>(
        `/communities?offset=${offset}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
        { signal },
      ),
  });
}

export function useMyCommunities() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.myCommunities(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch<Community[]>("/communities/mine", { signal }),
    enabled: !!user,
  });
}

export function useCommunity(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.community(slug ?? ""),
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/communities/${encodeURIComponent(slug!)}`, { signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()) as Community;
    },
    enabled: !!slug,
    retry: false,
  });
}

export function useCommunityMembers(communityId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.communityMembers(communityId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<CommunityMember[]>(`/communities/${communityId}/members`, { signal }),
    enabled: !!communityId,
  });
}

export function useCommunityMedia(communityId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.communityMedia(communityId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<CommunityMedia>(`/communities/${communityId}/media`, { signal }),
    enabled: !!communityId,
  });
}

export function useCommunityPosts(communityId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.communityPosts(communityId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<CommunityPost[]>(`/communities/${communityId}/posts`, { signal }),
    enabled: !!communityId,
  });
}

export function useCommunityPost(postId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.communityPost(postId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<{ post: CommunityPost; replies: CommunityReply[] }>(
        `/communities/posts/${postId}`,
        { signal },
      ),
    enabled: !!postId,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────

async function jsonFetch<T>(path: string, options: RequestInit): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.detail ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function useCreateCommunity() {
  const user = useAuthUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      visibility: "public" | "private";
      banner_color?: string | null;
    }) =>
      jsonFetch<Community>("/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      if (user) qc.invalidateQueries({ queryKey: queryKeys.myCommunities(user.uid) });
    },
  });
}

export function useUpdateCommunity(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<{ name: string; description: string; visibility: string; banner_color: string; members_can_edit_media: boolean }>) =>
      jsonFetch<Community>(`/communities/${communityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: queryKeys.community(c.slug) });
    },
  });
}

export function useDeleteCommunity() {
  const user = useAuthUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: number) =>
      jsonFetch<{ deleted: boolean }>(`/communities/${communityId}`, { method: "DELETE" }),
    onSuccess: () => {
      if (user) qc.invalidateQueries({ queryKey: queryKeys.myCommunities(user.uid) });
    },
  });
}

export function useJoinCommunity() {
  const user = useAuthUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: number) =>
      jsonFetch<{ role: string }>(`/communities/${communityId}/join`, { method: "POST" }),
    onSuccess: (_d, communityId) => {
      qc.invalidateQueries({ queryKey: queryKeys.communityMembers(communityId) });
      if (user) qc.invalidateQueries({ queryKey: queryKeys.myCommunities(user.uid) });
      qc.invalidateQueries({ queryKey: ["communities"] });
    },
  });
}

export function useLeaveCommunity() {
  const user = useAuthUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: number) =>
      jsonFetch<{ left: boolean }>(`/communities/${communityId}/leave`, { method: "POST" }),
    onSuccess: (_d, communityId) => {
      qc.invalidateQueries({ queryKey: queryKeys.communityMembers(communityId) });
      if (user) qc.invalidateQueries({ queryKey: queryKeys.myCommunities(user.uid) });
      qc.invalidateQueries({ queryKey: ["communities"] });
    },
  });
}

export function useInviteMember(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      jsonFetch(`/communities/${communityId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityMembers(communityId) }),
  });
}

export function useRemoveMember(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      jsonFetch(`/communities/${communityId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityMembers(communityId) }),
  });
}

export function useSetMemberRole(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "member" }) =>
      jsonFetch(`/communities/${communityId}/members/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityMembers(communityId) }),
  });
}

export function useAddMedia(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { content_type: "movie" | "tv"; content_id: number }) =>
      jsonFetch(`/communities/${communityId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityMedia(communityId) }),
  });
}

export function useRemoveMedia(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: number) =>
      jsonFetch(`/communities/${communityId}/media/${mediaId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityMedia(communityId) }),
  });
}

export function useCreatePost(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string | null; body: string }) =>
      jsonFetch<CommunityPost>(`/communities/${communityId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityPosts(communityId) }),
  });
}

export function useDeletePost(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) =>
      jsonFetch(`/communities/posts/${postId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityPosts(communityId) }),
  });
}

export function useAddReply(postId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      jsonFetch<CommunityReply>(`/communities/posts/${postId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityPost(postId) }),
  });
}

export function useUpdatePost(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, title, body }: { postId: number; title: string | null; body: string }) =>
      jsonFetch<CommunityPost>(`/communities/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.communityPosts(communityId) });
      qc.invalidateQueries({ queryKey: queryKeys.communityPost(vars.postId) });
    },
  });
}

export function useUpdateReply(postId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ replyId, body }: { replyId: number; body: string }) =>
      jsonFetch<CommunityReply>(`/communities/replies/${replyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityPost(postId) }),
  });
}

export function useTogglePostLike(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) =>
      jsonFetch<{ liked: boolean; like_count: number }>(
        `/communities/posts/${postId}/like`,
        { method: "POST" },
      ),
    // Optimistic update on the posts list
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: queryKeys.communityPosts(communityId) });
      const previous = qc.getQueryData<CommunityPost[]>(queryKeys.communityPosts(communityId));
      qc.setQueryData<CommunityPost[]>(queryKeys.communityPosts(communityId), (old) =>
        (old ?? []).map((p) =>
          p.id === postId
            ? {
                ...p,
                viewer_liked: !p.viewer_liked,
                like_count: p.like_count + (p.viewer_liked ? -1 : 1),
              }
            : p,
        ),
      );
      return { previous };
    },
    onError: (_e, _postId, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.communityPosts(communityId), ctx.previous);
    },
    onSettled: (_d, _e, postId) => {
      qc.invalidateQueries({ queryKey: queryKeys.communityPost(postId) });
    },
  });
}

export function useToggleReplyLike(postId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (replyId: number) =>
      jsonFetch<{ liked: boolean; like_count: number }>(
        `/communities/replies/${replyId}/like`,
        { method: "POST" },
      ),
    onMutate: async (replyId) => {
      await qc.cancelQueries({ queryKey: queryKeys.communityPost(postId) });
      const previous = qc.getQueryData<{ post: CommunityPost; replies: CommunityReply[] }>(
        queryKeys.communityPost(postId),
      );
      qc.setQueryData<{ post: CommunityPost; replies: CommunityReply[] }>(
        queryKeys.communityPost(postId),
        (old) =>
          old
            ? {
                ...old,
                replies: old.replies.map((r) =>
                  r.id === replyId
                    ? {
                        ...r,
                        viewer_liked: !r.viewer_liked,
                        like_count: r.like_count + (r.viewer_liked ? -1 : 1),
                      }
                    : r,
                ),
              }
            : old,
      );
      return { previous };
    },
    onError: (_e, _replyId, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.communityPost(postId), ctx.previous);
    },
  });
}

export function useDeleteReply(postId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (replyId: number) =>
      jsonFetch(`/communities/replies/${replyId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.communityPost(postId) }),
  });
}
