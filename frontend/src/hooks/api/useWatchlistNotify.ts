import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export interface WatchlistNotifyItem {
  content_type: "movie" | "tv";
  content_id: number;
  name: string;
  notify: boolean;
}

const NOTIFY_PREFS_KEY = ["watchlist", "notifyPrefs"] as const;

export function useWatchlistNotifyPrefs() {
  const user = useAuthUser();
  return useQuery({
    queryKey: [...NOTIFY_PREFS_KEY, user?.uid ?? ""],
    queryFn: () =>
      apiFetch("/watchlist/notify-prefs").then((r) => r.json() as Promise<WatchlistNotifyItem[]>),
    enabled: !!user,
  });
}

export function useBulkToggleWatchlistNotify() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ notify, contentType }: { notify: boolean; contentType?: "movie" | "tv" }) => {
      const body: Record<string, unknown> = { notify };
      if (contentType) body.content_type = contentType;
      const res = await apiFetch("/watchlist/notify-all", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to bulk update notification preferences");
      return res.json();
    },
    onMutate: async ({ notify, contentType }) => {
      if (!user) return;
      const key = [...NOTIFY_PREFS_KEY, user.uid];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WatchlistNotifyItem[]>(key);
      queryClient.setQueryData<WatchlistNotifyItem[]>(key, (old) =>
        old?.map((item) =>
          !contentType || item.content_type === contentType ? { ...item, notify } : item
        )
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (!user || !ctx?.previous) return;
      queryClient.setQueryData([...NOTIFY_PREFS_KEY, user.uid], ctx.previous);
    },
    onSettled: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: [...NOTIFY_PREFS_KEY, user.uid] });
    },
  });
}

export function useToggleWatchlistNotify() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      notify,
    }: {
      contentType: "movie" | "tv";
      contentId: number;
      notify: boolean;
    }) => {
      const res = await apiFetch("/watchlist/notify", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType, content_id: contentId, notify }),
      });
      if (!res.ok) throw new Error("Failed to update notification preference");
      return res.json();
    },
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: [...NOTIFY_PREFS_KEY, user.uid] });
    },
  });
}
