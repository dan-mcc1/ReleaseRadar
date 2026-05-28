import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";

async function jsonFetch<T>(path: string, options: RequestInit): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function useSetAssetSlot(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assetId,
      slotType,
    }: {
      assetId: number;
      slotType: "movie" | "tv" | "flex" | "bench";
    }) =>
      jsonFetch(
        `/fantasy/roster/${leagueId}/assets/${assetId}/set-slot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot_type: slotType }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "leagues", leagueId, "seasons", seasonId],
      });
    },
  });
}

export function useSwapSlots(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assetAId, assetBId }: { assetAId: number; assetBId: number }) =>
      jsonFetch(`/fantasy/roster/${leagueId}/swap-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_a_id: assetAId, asset_b_id: assetBId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "leagues", leagueId, "seasons", seasonId],
      });
    },
  });
}
