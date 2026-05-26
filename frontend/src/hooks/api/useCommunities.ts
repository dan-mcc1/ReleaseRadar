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
  vote_average?: number | null;
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
    onSuccess: (newCommunity) => {
      if (!user) return;
      // Optimistically prepend into /my-groups cache so the new group shows
      // up instantly — without waiting for a background refetch to finish.
      // The 5min staleTime would otherwise let the stale list render first.
      qc.setQueryData<Community[]>(
        queryKeys.myCommunities(user.uid),
        (old) => {
          if (!old) return [newCommunity];
          if (old.some((c) => c.id === newCommunity.id)) return old;
          return [newCommunity, ...old];
        },
      );
      // Invalidate the whole "communities" namespace so the browse list and
      // any other cached community queries refetch on next visit (active
      // observers refetch immediately). Cheap — most users only have a
      // handful of community pages cached.
      qc.invalidateQueries({ queryKey: ["communities"] });
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

export interface CommunityInvitation {
  id: number;
  created_at: string | null;
  community: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    banner_color: string | null;
    visibility: "public" | "private";
    member_count: number;
  };
  invited_by: { id: string; username: string; display_name: string | null } | null;
}

export interface GroupPendingInvitation {
  id: number;
  created_at: string | null;
  user: { id: string; username: string; display_name: string | null };
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.communityMembers(communityId) });
      qc.invalidateQueries({ queryKey: queryKeys.communityGroupInvitations(communityId) });
    },
  });
}

export function useMyCommunityInvitations() {
  const user = useAuthUser();
  return useQuery<CommunityInvitation[]>({
    queryKey: user ? queryKeys.communityMyInvitations(user.uid) : ["communities", "invitations", "mine", "anon"],
    queryFn: () => queryFetch<CommunityInvitation[]>(`/communities/invitations/mine`),
    enabled: !!user,
  });
}

export function useRespondToCommunityInvitation() {
  const qc = useQueryClient();
  const user = useAuthUser();
  return useMutation({
    mutationFn: ({ invitationId, accept }: { invitationId: number; accept: boolean }) =>
      jsonFetch(`/communities/invitations/${invitationId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      }),
    onSuccess: () => {
      if (user) {
        qc.invalidateQueries({ queryKey: queryKeys.communityMyInvitations(user.uid) });
        qc.invalidateQueries({ queryKey: queryKeys.myCommunities(user.uid) });
      }
    },
  });
}

export function useGroupPendingInvitations(communityId: number | undefined) {
  return useQuery<GroupPendingInvitation[]>({
    queryKey: communityId
      ? queryKeys.communityGroupInvitations(communityId)
      : ["communities", "invitations", "group", "noop"],
    queryFn: () =>
      queryFetch<GroupPendingInvitation[]>(`/communities/${communityId}/invitations`),
    enabled: communityId !== undefined,
  });
}

export function useRevokeGroupInvitation(communityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: number) =>
      jsonFetch(`/communities/${communityId}/invitations/${invitationId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.communityGroupInvitations(communityId) });
    },
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

export interface ItemGroupMembershipEntry {
  community_id: number;
  media_id: number;
}

export function useItemGroupMembership(
  contentType: "movie" | "tv",
  contentId: number,
) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.itemGroupMembership(user?.uid ?? "", contentType, contentId),
    queryFn: ({ signal }) =>
      queryFetch<ItemGroupMembershipEntry[]>(
        `/communities/media/membership?content_type=${contentType}&content_id=${contentId}`,
        { signal },
      ),
    enabled: !!user && contentId > 0,
  });
}

export interface AddMediaVars {
  content_type: "movie" | "tv";
  content_id: number;
  // Optional display fields used for an optimistic insert into the group's
  // media grid so the tile pops in immediately. When omitted, the grid waits
  // for the success-triggered refetch instead.
  title?: string;
  poster_path?: string | null;
}

export function useAddMedia(communityId: number) {
  const qc = useQueryClient();
  const user = useAuthUser();
  return useMutation<
    { id: number },
    Error,
    AddMediaVars,
    {
      membership: {
        previous: ItemGroupMembershipEntry[] | undefined;
        key: readonly unknown[];
      };
      media: {
        previous: CommunityMedia | undefined;
        key: readonly unknown[];
        injected: boolean;
      };
    }
  >({
    mutationFn: ({ content_type, content_id }) =>
      jsonFetch<{ id: number }>(`/communities/${communityId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type, content_id }),
      }),
    onMutate: async ({ content_type, content_id, title, poster_path }) => {
      const membershipKey = queryKeys.itemGroupMembership(
        user?.uid ?? "",
        content_type,
        content_id,
      );
      const mediaKey = queryKeys.communityMedia(communityId);

      await Promise.all([
        qc.cancelQueries({ queryKey: membershipKey }),
        qc.cancelQueries({ queryKey: mediaKey }),
      ]);

      const previousMembership =
        qc.getQueryData<ItemGroupMembershipEntry[]>(membershipKey);
      // Use a placeholder media_id; the server response replaces it below.
      // -1 is a safe sentinel because real ids are auto-increment positive.
      qc.setQueryData<ItemGroupMembershipEntry[]>(membershipKey, (old) => {
        const next = (old ?? []).filter((e) => e.community_id !== communityId);
        next.push({ community_id: communityId, media_id: -1 });
        return next;
      });

      const previousMedia = qc.getQueryData<CommunityMedia>(mediaKey);
      const shouldInject =
        title !== undefined &&
        previousMedia !== undefined &&
        !(
          (content_type === "movie"
            ? previousMedia.movies
            : previousMedia.shows
          ).some((m) => m.content_id === content_id)
        );

      if (shouldInject) {
        const placeholder: CommunityMediaItem = {
          id: -1,
          content_id,
          poster_path: poster_path ?? null,
          added_by: user?.uid ?? null,
          added_at: new Date().toISOString(),
          ...(content_type === "movie" ? { title } : { name: title }),
        };
        qc.setQueryData<CommunityMedia>(mediaKey, (old) =>
          old
            ? content_type === "movie"
              ? { ...old, movies: [placeholder, ...old.movies] }
              : { ...old, shows: [placeholder, ...old.shows] }
            : old,
        );
      }

      return {
        membership: { previous: previousMembership, key: membershipKey },
        media: { previous: previousMedia, key: mediaKey, injected: shouldInject },
      };
    },
    onError: (_e, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData(ctx.membership.key, ctx.membership.previous);
      qc.setQueryData(ctx.media.key, ctx.media.previous);
    },
    onSuccess: (data, vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData<ItemGroupMembershipEntry[]>(ctx.membership.key, (old) =>
        (old ?? []).map((e) =>
          e.community_id === communityId && e.media_id === -1
            ? { community_id: communityId, media_id: data.id }
            : e,
        ),
      );
      // Patch the placeholder grid row with the real media_id so an immediate
      // remove click finds something to delete instead of 404ing.
      if (ctx.media.injected) {
        qc.setQueryData<CommunityMedia>(ctx.media.key, (old) => {
          if (!old) return old;
          const swap = (item: CommunityMediaItem) =>
            item.id === -1 && item.content_id === vars.content_id
              ? { ...item, id: data.id }
              : item;
          return {
            movies: old.movies.map(swap),
            shows: old.shows.map(swap),
          };
        });
      }
      qc.invalidateQueries({ queryKey: queryKeys.communityMedia(communityId) });
    },
  });
}

export function useRemoveMedia(communityId: number) {
  const qc = useQueryClient();
  const user = useAuthUser();
  return useMutation<
    unknown,
    Error,
    { mediaId: number; contentType: "movie" | "tv"; contentId: number },
    {
      membership: { previous: ItemGroupMembershipEntry[] | undefined; key: readonly unknown[] };
      media: { previous: CommunityMedia | undefined; key: readonly unknown[] };
    }
  >({
    mutationFn: ({ mediaId }) =>
      jsonFetch(`/communities/${communityId}/media/${mediaId}`, { method: "DELETE" }),
    onMutate: async ({ mediaId, contentType, contentId }) => {
      const membershipKey = queryKeys.itemGroupMembership(
        user?.uid ?? "",
        contentType,
        contentId,
      );
      const mediaKey = queryKeys.communityMedia(communityId);

      await Promise.all([
        qc.cancelQueries({ queryKey: membershipKey }),
        qc.cancelQueries({ queryKey: mediaKey }),
      ]);

      const previousMembership =
        qc.getQueryData<ItemGroupMembershipEntry[]>(membershipKey);
      qc.setQueryData<ItemGroupMembershipEntry[]>(membershipKey, (old) =>
        (old ?? []).filter((e) => e.community_id !== communityId),
      );

      const previousMedia = qc.getQueryData<CommunityMedia>(mediaKey);
      qc.setQueryData<CommunityMedia>(mediaKey, (old) =>
        old
          ? {
              movies: old.movies.filter((m) => m.id !== mediaId),
              shows: old.shows.filter((s) => s.id !== mediaId),
            }
          : old,
      );

      return {
        membership: { previous: previousMembership, key: membershipKey },
        media: { previous: previousMedia, key: mediaKey },
      };
    },
    onError: (_e, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData(ctx.membership.key, ctx.membership.previous);
      qc.setQueryData(ctx.media.key, ctx.media.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.communityMedia(communityId) });
    },
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
