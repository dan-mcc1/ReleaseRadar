import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export interface RewatchEntry {
  id: number;
  content_type: string;
  content_id: number;
  watched_at: string;
  rating: number | null;
  notes: string | null;
  would_rewatch: boolean | null;
}

function rewatchKey(uid: string, contentType: string, contentId: number) {
  return ["rewatch", uid, contentType, contentId] as const;
}

export function useRewatches(contentType: string, contentId: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: rewatchKey(user?.uid ?? "", contentType, contentId),
    queryFn: () =>
      queryFetch<{ rewatches: RewatchEntry[]; count: number }>(
        `/rewatch/${contentType}/${contentId}`,
      ),
    enabled: !!user,
  });
}

export function useAddRewatch() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      rating,
      notes,
      wouldRewatch,
    }: {
      contentType: string;
      contentId: number;
      rating?: number | null;
      notes?: string | null;
      wouldRewatch?: boolean | null;
    }) => {
      const res = await apiFetch("/rewatch/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          rating,
          notes,
          would_rewatch: wouldRewatch,
        }),
      });
      if (!res.ok) throw new Error("Failed to add rewatch.");
      return res.json() as Promise<RewatchEntry>;
    },
    onSuccess: (_, { contentType, contentId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: rewatchKey(user.uid, contentType, contentId),
      });
    },
  });
}

export function useDeleteRewatch() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rewatchId,
      contentType,
      contentId,
    }: {
      rewatchId: number;
      contentType: string;
      contentId: number;
    }) => {
      const res = await apiFetch(`/rewatch/${rewatchId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete rewatch.");
      return { contentType, contentId };
    },
    onSuccess: (_, { contentType, contentId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: rewatchKey(user.uid, contentType, contentId),
      });
    },
  });
}
