import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryFetch } from "./queryFetch";

export interface FantasyWaiverBid {
  id: number;
  league_id: number;
  season_id: number;
  user_id: string;
  content_type: "movie" | "tv";
  content_id: number;
  bid_amount: number;
  drop_asset_id: number | null;
  status: "pending" | "won" | "lost" | "cancelled";
  submitted_at: string;
  resolved_at: string | null;
}

const waiverKeys = {
  myBids: (lid: number, sid: number, status?: string) =>
    ["fantasy", "waivers", lid, sid, "mine", status ?? "all"] as const,
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

export function useMyWaiverBids(
  leagueId: number | undefined,
  seasonId: number | undefined,
  status?: "pending" | "won" | "lost" | "cancelled",
) {
  return useQuery({
    queryKey: waiverKeys.myBids(leagueId ?? 0, seasonId ?? 0, status),
    queryFn: ({ signal }) => {
      const qs = status ? `?status=${status}` : "";
      return queryFetch<FantasyWaiverBid[]>(
        `/fantasy/waivers/${leagueId}/seasons/${seasonId}/bids/mine${qs}`,
        { signal },
      );
    },
    enabled: !!leagueId && !!seasonId,
  });
}

export function useSubmitWaiverBid(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      content_type: "movie" | "tv";
      content_id: number;
      bid_amount: number;
      drop_asset_id?: number | null;
    }) =>
      jsonFetch<FantasyWaiverBid>(
        `/fantasy/waivers/${leagueId}/seasons/${seasonId}/bids`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "waivers", leagueId, seasonId],
      });
      qc.invalidateQueries({ queryKey: ["fantasy", "leagues", leagueId, "members"] });
    },
  });
}

export function useCancelWaiverBid(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bidId: number) => {
      const res = await apiFetch(`/fantasy/waivers/${leagueId}/bids/${bidId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fantasy", "waivers", leagueId] });
    },
  });
}

export function useResolveWaivers(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      jsonFetch<{ resolved: number; winners: unknown[]; losers: number }>(
        `/fantasy/waivers/${leagueId}/seasons/${seasonId}/resolve`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "waivers", leagueId, seasonId],
      });
      qc.invalidateQueries({
        queryKey: [
          "fantasy",
          "leagues",
          leagueId,
          "seasons",
          seasonId,
          "assets",
        ],
      });
      qc.invalidateQueries({ queryKey: ["fantasy", "leagues", leagueId, "members"] });
    },
  });
}

export function useGrantAllowance(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      jsonFetch<{ league_id: number; members_updated: number }>(
        `/fantasy/waivers/${leagueId}/grant-allowance`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fantasy", "leagues", leagueId, "members"] });
    },
  });
}
