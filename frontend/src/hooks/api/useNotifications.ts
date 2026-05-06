import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

interface NotificationPrefs {
  email_notifications: boolean;
  notification_frequency: string;
  profile_visibility: string;
}

export function useNotificationPrefs() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.notificationPrefs(user?.uid ?? ""),
    queryFn: () => queryFetch<NotificationPrefs>("/notifications/preferences"),
    enabled: !!user,
  });
}

export function useUpdateNotificationPrefs() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Partial<NotificationPrefs>) =>
      apiFetch("/notifications/preferences", {
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
