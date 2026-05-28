import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryFetch } from "./queryFetch";

export interface FantasyTradeLeg {
  id: number;
  direction: "proposer_sends" | "recipient_sends";
  asset_id: number | null;
  budget_amount: number | null;
}

export interface FantasyTrade {
  id: number;
  league_id: number;
  season_id: number;
  proposer_id: string;
  recipient_id: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "vetoed";
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  legs: FantasyTradeLeg[];
}

const tradeKeys = {
  myTrades: (lid: number, sid: number, status?: string) =>
    ["fantasy", "trades", lid, sid, "mine", status ?? "all"] as const,
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

export function useAllTrades(
  leagueId: number | undefined,
  seasonId: number | undefined,
  status?: "pending" | "accepted" | "declined" | "cancelled" | "vetoed",
  enabled = true,
) {
  return useQuery({
    queryKey: ["fantasy", "trades", leagueId ?? 0, seasonId ?? 0, "all", status ?? "all"],
    queryFn: ({ signal }) => {
      const qs = status ? `?status=${status}` : "";
      return queryFetch<FantasyTrade[]>(
        `/fantasy/trades/${leagueId}/seasons/${seasonId}/trades/all${qs}`,
        { signal },
      );
    },
    enabled: !!leagueId && !!seasonId && enabled,
  });
}

export function useMyTrades(
  leagueId: number | undefined,
  seasonId: number | undefined,
  status?: "pending" | "accepted" | "declined" | "cancelled" | "vetoed",
) {
  return useQuery({
    queryKey: tradeKeys.myTrades(leagueId ?? 0, seasonId ?? 0, status),
    queryFn: ({ signal }) => {
      const qs = status ? `?status=${status}` : "";
      return queryFetch<FantasyTrade[]>(
        `/fantasy/trades/${leagueId}/seasons/${seasonId}/trades/mine${qs}`,
        { signal },
      );
    },
    enabled: !!leagueId && !!seasonId,
  });
}

export function useProposeTrade(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      recipient_id: string;
      proposer_assets: number[];
      recipient_assets: number[];
      proposer_cash?: number;
      recipient_cash?: number;
      message?: string;
    }) =>
      jsonFetch<FantasyTrade>(
        `/fantasy/trades/${leagueId}/seasons/${seasonId}/trades`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "trades", leagueId, seasonId],
      });
    },
  });
}

export function useRespondToTrade(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tradeId,
      action,
    }: {
      tradeId: number;
      action: "accept" | "decline" | "veto";
    }) =>
      jsonFetch<FantasyTrade>(
        `/fantasy/trades/${leagueId}/trades/${tradeId}/${action}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["fantasy", "trades", leagueId, seasonId],
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
      qc.invalidateQueries({
        queryKey: ["fantasy", "leagues", leagueId, "members"],
      });
    },
  });
}
