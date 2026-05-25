import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch, checkedFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export interface NotificationPrefs {
  email_notifications: boolean;
  notification_frequency: string;
  profile_visibility: string;
  notify_new_seasons: boolean;
  notify_streaming_changes: boolean;
  notify_trailers: boolean;
  digest_hour: number;
  digest_timezone: string;
  hide_spoilers: boolean;
}

export function useNotificationPrefs() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.notificationPrefs(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch<NotificationPrefs>("/notifications/preferences", { signal }),
    enabled: !!user,
  });
}

export function useUpdateNotificationPrefs() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Partial<NotificationPrefs>) =>
      checkedFetch("/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      }),
    onSuccess: () => {
      if (user)
        queryClient.invalidateQueries({
          queryKey: queryKeys.notificationPrefs(user.uid),
        });
    },
  });
}
