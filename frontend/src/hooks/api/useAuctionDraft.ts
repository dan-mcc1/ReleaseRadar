import { useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "../../utils/apiFetch";
import { queryFetch } from "./queryFetch";
import { API_URL } from "../../constants";
import { auth } from "../../firebase";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuctionMemberState {
  user_id: string;
  budget_remaining: number;
  open_slots: { movie: number; tv: number; flex: number };
  filled_slots: Partial<Record<"movie" | "tv" | "flex", number>>;
}

export interface AuctionBid {
  id: number;
  user_id: string;
  amount: number;
  placed_at: string;
}

export interface AuctionNomination {
  id: number;
  league_id: number;
  season_id: number;
  nominator_user_id: string;
  content_type: "movie" | "tv";
  content_id: number;
  slot_type: "movie" | "tv" | "flex";
  current_high_bid: number;
  current_high_bidder_id: string;
  starts_at: string;
  expires_at: string;
  closed_at: string | null;
  status: "open" | "closed" | "cancelled";
  resulting_asset_id: number | null;
  bids?: AuctionBid[];
  passed_user_ids?: string[];
}

export interface DraftState {
  season_id: number;
  status: "upcoming" | "draft" | "active" | "complete";
  nomination_order: string[];
  next_nominator_index: number;
  current_nominator_user_id: string | null;
  nomination_deadline: string | null;
  current_nomination: AuctionNomination | null;
  members: AuctionMemberState[];
}

// ─── Query keys ─────────────────────────────────────────────────────────────

const draftKeys = {
  state: (lid: number, sid: number) =>
    ["fantasy", "auction", lid, sid, "state"] as const,
  nominations: (lid: number, sid: number) =>
    ["fantasy", "auction", lid, sid, "nominations"] as const,
};

// ─── Eligible-asset search ──────────────────────────────────────────────────

export interface EligibleSearchMovie {
  id: number;
  title: string | null;
  poster_path: string | null;
  release_date: string; // ISO YYYY-MM-DD
  overview: string | null;
}

export interface EligibleSearchShow {
  id: number;
  name: string | null;
  poster_path: string | null;
  first_air_date: string | null;
  eligible_air_date: string; // ISO date of the in-window season
  season_number?: number;
  season_end_date?: string | null; // ISO of the season's last episode air_date
  episode_count?: number;
  episodes_remaining?: number;
  overview: string | null;
}

export function useAssetSuggestions(
  leagueId: number | undefined,
  seasonId: number | undefined,
) {
  return useQuery({
    queryKey: ["fantasy", "asset-suggestions", leagueId, seasonId],
    queryFn: ({ signal }) =>
      queryFetch<{ movies: EligibleSearchMovie[]; shows: EligibleSearchShow[] }>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/asset-suggestions`,
        { signal },
      ),
    enabled: !!leagueId && !!seasonId,
    staleTime: 60_000,
  });
}

export function useEligibleAssetSearch(
  leagueId: number | undefined,
  seasonId: number | undefined,
  query: string,
) {
  return useQuery({
    queryKey: ["fantasy", "asset-search", leagueId, seasonId, query],
    queryFn: ({ signal }) =>
      queryFetch<{ movies: EligibleSearchMovie[]; shows: EligibleSearchShow[] }>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/asset-search?q=${encodeURIComponent(query)}`,
        { signal },
      ),
    enabled: !!leagueId && !!seasonId && query.trim().length >= 1,
    staleTime: 30_000,
  });
}

// ─── Media summary (poster + title resolver) ────────────────────────────────

export interface MediaSummary {
  id: number;
  title: string;
  poster_path: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
}

/** Resolves title + poster for a (content_type, content_id) pair. Hits the
 * existing media-detail endpoints which serve from the local cache when
 * available, falling back to TMDb. Cached aggressively since this data
 * changes rarely during a draft. */
export function useMediaSummary(
  contentType: "movie" | "tv" | undefined,
  contentId: number | undefined,
) {
  return useQuery({
    queryKey: ["media-summary", contentType, contentId],
    queryFn: async ({ signal }) => {
      const path =
        contentType === "movie"
          ? `/movies/${contentId}`
          : `/tv/${contentId}`;
      const raw = await queryFetch<Record<string, unknown>>(path, { signal });
      return {
        id: contentId!,
        title:
          (raw.title as string) ??
          (raw.name as string) ??
          `${contentType === "movie" ? "Movie" : "Show"} #${contentId}`,
        poster_path: (raw.poster_path as string | null) ?? null,
        release_date: (raw.release_date as string | null) ?? null,
        first_air_date: (raw.first_air_date as string | null) ?? null,
        last_air_date: (raw.last_air_date as string | null) ?? null,
      } satisfies MediaSummary;
    },
    enabled: !!contentType && !!contentId,
    staleTime: 5 * 60_000,
  });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Polls every 10s as a fallback; WebSocket subscription forces faster
 * invalidation for instant updates when the connection is healthy. */
export function useDraftState(
  leagueId: number | undefined,
  seasonId: number | undefined,
) {
  return useQuery({
    queryKey: draftKeys.state(leagueId ?? 0, seasonId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<DraftState>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/state`,
        { signal },
      ),
    enabled: !!leagueId && !!seasonId,
    refetchInterval: 10_000,
  });
}

export function useNominationHistory(
  leagueId: number | undefined,
  seasonId: number | undefined,
  status?: "open" | "closed" | "cancelled",
) {
  return useQuery({
    queryKey: [
      ...draftKeys.nominations(leagueId ?? 0, seasonId ?? 0),
      status ?? "all",
    ],
    queryFn: ({ signal }) => {
      const qs = status ? `?status=${status}` : "";
      return queryFetch<AuctionNomination[]>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/nominations${qs}`,
        { signal },
      );
    },
    enabled: !!leagueId && !!seasonId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

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

export function useStartDraft(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { member_order?: string[] }) =>
      jsonFetch<DraftState>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: draftKeys.state(leagueId, seasonId) });
    },
  });
}

export function useNominate(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      content_type: "movie" | "tv";
      content_id: number;
      starting_bid: number;
      slot_type?: "movie" | "tv" | "flex";
    }) =>
      jsonFetch<AuctionNomination>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/nominate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: draftKeys.state(leagueId, seasonId) });
      qc.invalidateQueries({
        queryKey: draftKeys.nominations(leagueId, seasonId),
      });
    },
  });
}

export function usePlaceBid(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      nominationId,
      amount,
    }: {
      nominationId: number;
      amount: number;
    }) =>
      jsonFetch<AuctionNomination>(
        `/fantasy/auction/${leagueId}/nominations/${nominationId}/bid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: draftKeys.state(leagueId, seasonId) });
    },
  });
}

export function usePassNomination(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nominationId: number) =>
      jsonFetch<{ id: number; nomination_id: number; user_id: string }>(
        `/fantasy/auction/${leagueId}/nominations/${nominationId}/pass`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: draftKeys.state(leagueId, seasonId) });
    },
  });
}

export function useSkipTurn(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      jsonFetch<DraftState>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/skip`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: draftKeys.state(leagueId, seasonId) });
    },
  });
}

export function useCompleteDraft(leagueId: number, seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      jsonFetch<DraftState>(
        `/fantasy/auction/${leagueId}/seasons/${seasonId}/complete`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: draftKeys.state(leagueId, seasonId) });
    },
  });
}

// ─── WebSocket subscription ─────────────────────────────────────────────────

interface AuctionEvent {
  event:
    | "draft_started"
    | "nomination_opened"
    | "bid_placed"
    | "bid_passed"
    | "nomination_closed";
  league_id: number;
  season_id: number;
  [key: string]: unknown;
}

/** Subscribes to live auction events for the given league + season. Each event
 * invalidates the draft state query so connected clients re-fetch instantly. */
export function useAuctionWebSocket(
  leagueId: number | undefined,
  seasonId: number | undefined,
  onEvent?: (event: AuctionEvent) => void,
) {
  const qc = useQueryClient();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!leagueId || !seasonId) return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      const token = await auth.currentUser?.getIdToken();
      if (!token || cancelled) return;
      const wsBase = API_URL.replace(/^http/, "ws");
      const url = `${wsBase}/fantasy/auction/ws/${leagueId}/${seasonId}?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as AuctionEvent;
          qc.invalidateQueries({
            queryKey: draftKeys.state(leagueId!, seasonId!),
          });
          if (payload.event === "nomination_closed") {
            qc.invalidateQueries({
              queryKey: draftKeys.nominations(leagueId!, seasonId!),
            });
          }
          onEventRef.current?.(payload);
        } catch {
          // Malformed payload — ignore.
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        // Reconnect with a fresh token after a short delay.
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connect();
        }, 2000);
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [leagueId, seasonId, qc]);
}
