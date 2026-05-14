import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export function useSetFinishByGoal(showId: number) {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetDate: string) => {
      const res = await apiFetch(`/watchlist/progress/${showId}/finish-by`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_date: targetDate }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["showProgress", user?.uid ?? "", showId] });
    },
  });
}

export function useClearFinishByGoal(showId: number) {
  const user = useAuthUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/watchlist/progress/${showId}/finish-by`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["showProgress", user?.uid ?? "", showId] });
    },
  });
}
