import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryKeys } from "./queryKeys";
import { useAuthUser } from "../useAuthUser";

export interface Shelf {
  id: number;
  name: string;
  description: string | null;
  created_at: string | null;
  item_count: number;
  notify: boolean;
  preview_posters: string[];
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useShelves() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.shelves(user?.uid ?? ""),
    queryFn: ({ signal }) => apiFetch("/shelf", { signal }).then((r) => r.json() as Promise<Shelf[]>),
    enabled: !!user,
    staleTime: 60_000,
  });
}

export function useShelfItems(shelfId: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.shelfItems(user?.uid ?? "", shelfId),
    queryFn: ({ signal }) =>
      apiFetch(`/shelf/${shelfId}/items`, { signal }).then((r) => r.json()),
    enabled: !!user,
  });
}

export function useShelfCalendar(
  shelfId: number,
  fromDate: string,
  toDate: string
) {
  const user = useAuthUser();
  return useQuery({
    queryKey: [...queryKeys.shelfCalendar(user?.uid ?? "", shelfId), fromDate, toDate],
    queryFn: ({ signal }) =>
      apiFetch(
        `/shelf/${shelfId}/calendar?from_date=${fromDate}&to_date=${toDate}`,
        { signal },
      ).then((r) => r.json()),
    enabled: !!user,
  });
}

export function useItemShelves(contentType: "movie" | "tv", contentId: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.itemShelves(user?.uid ?? "", contentType, contentId),
    queryFn: ({ signal }) =>
      apiFetch(
        `/shelf/item-shelves?content_type=${contentType}&content_id=${contentId}`,
        { signal },
      ).then((r) => r.json() as Promise<number[]>),
    enabled: !!user,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateShelf() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      description,
    }: {
      name: string;
      description?: string;
    }) => {
      const res = await apiFetch("/shelf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (res.status === 403) {
        throw Object.assign(new Error("upgrade_required"), { status: 403 });
      }
      if (!res.ok) throw new Error("Failed to create shelf");
      return res.json() as Promise<Shelf>;
    },
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves(user.uid) });
    },
  });
}

export function useUpdateShelf() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      shelfId,
      name,
      description,
    }: {
      shelfId: number;
      name?: string;
      description?: string;
    }) => {
      const res = await apiFetch(`/shelf/${shelfId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error("Failed to update shelf");
      return res.json() as Promise<Shelf>;
    },
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves(user.uid) });
    },
  });
}

export function useDeleteShelf() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (shelfId: number) => {
      const res = await apiFetch(`/shelf/${shelfId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete shelf");
    },
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves(user.uid) });
    },
  });
}

export function useAddToShelf() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      shelfId,
      contentType,
      contentId,
    }: {
      shelfId: number;
      contentType: "movie" | "tv";
      contentId: number;
    }) => {
      const res = await apiFetch(`/shelf/${shelfId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType, content_id: contentId }),
      });
      if (!res.ok) throw new Error("Failed to add to shelf");
      return res.json();
    },
    onSuccess: (_, { shelfId, contentType, contentId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.shelfItems(user.uid, shelfId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves(user.uid) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.itemShelves(user.uid, contentType, contentId),
      });
    },
  });
}

export function useToggleShelfNotify() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ shelfId, notify }: { shelfId: number; notify: boolean }) => {
      const res = await apiFetch(`/shelf/${shelfId}/notify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify }),
      });
      if (!res.ok) throw new Error("Failed to update shelf notification");
      return res.json();
    },
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves(user.uid) });
    },
  });
}

export function useRemoveFromShelf() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      shelfId,
      contentType,
      contentId,
    }: {
      shelfId: number;
      contentType: "movie" | "tv";
      contentId: number;
    }) => {
      const res = await apiFetch(
        `/shelf/${shelfId}/items/${contentType}/${contentId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove from shelf");
    },
    onSuccess: (_, { shelfId, contentType, contentId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.shelfItems(user.uid, shelfId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves(user.uid) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.itemShelves(user.uid, contentType, contentId),
      });
    },
  });
}
