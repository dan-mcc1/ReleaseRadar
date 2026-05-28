import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryFetch } from "./queryFetch";

export interface FantasyLineupBoost {
  id: number;
  league_id: number;
  season_id: number;
  user_id: string;
  asset_id: number;
  week_number: number;
  set_at: string;
}

const boostKeys = {
  myBoosts: (lid: number, sid: number, week?: number) =>
    ["fantasy", "boosts", lid, sid, "mine", week ?? "all"] as const,
};

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

export function useMyBoosts(
  leagueId: number | undefined,
  seasonId: number | undefined,
  week?: number,
) {
  return useQuery({
    queryKey: boostKeys.myBoosts(leagueId ?? 0, seasonId ?? 0, week),
    queryFn: ({ signal }) => {
      const qs = week ? `?week=${week}` : "";
      return queryFetch<FantasyLineupBoost[]>(
        `/fantasy/lineup/${leagueId}/seasons/${seasonId}/boosts/mine${qs}`,
        { signal },
      );
    },
    enabled: !!leagueId && !!seasonId,
  });
}

export function useSetBoost(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { asset_id: number; week_number: number }) =>
      jsonFetch<FantasyLineupBoost>(`/fantasy/lineup/${leagueId}/boosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season_id: seasonId, ...body }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "boosts", leagueId, seasonId],
      });
    },
  });
}

export function useClearBoost(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (boostId: number) => {
      const res = await apiFetch(
        `/fantasy/lineup/${leagueId}/boosts/${boostId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "boosts", leagueId, seasonId],
      });
    },
  });
}
