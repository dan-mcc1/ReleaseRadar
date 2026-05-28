import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FantasyLeague {
  id: number;
  name: string;
  owner_id: string | null;
  current_season_id: number | null;
  starting_budget: number;
  weekly_allowance: number;
  roster_movie_slots: number;
  roster_tv_slots: number;
  roster_flex_slots: number;
  bench_slots: number;
  boost_slots: number;
  max_members: number;
  created_at: string;
  viewer_role: "owner" | "admin" | "member" | null;
  members?: FantasyMember[];
}

export interface FantasyMember {
  user_id: string;
  username: string | null;
  user_display_name: string | null;
  display_name: string | null;
  role: "owner" | "admin" | "member";
  budget_remaining: number;
  joined_at: string;
}

export interface FantasySeason {
  id: number;
  league_id: number;
  name: string;
  code: "summer" | "fall" | "holiday" | "spring";
  year: number;
  starts_at: string;
  ends_at: string;
  status: "upcoming" | "draft" | "active" | "complete";
  created_at: string;
}

export interface FantasyStandingsRow {
  user_id: string;
  username: string | null;
  user_display_name: string | null;
  league_display_name: string | null;
  role: "owner" | "admin" | "member";
  total_points: number;
  asset_count: number;
  rank: number;
}

export interface FantasyAssetBreakdown {
  asset_id: number;
  content_type: "movie" | "tv";
  content_id: number;
  title: string | null;
  poster_path: string | null;
  auction_price: number;
  slot_type: "movie" | "tv" | "flex" | "bench";
  drafted_at: string;
  dropped_at: string | null;
  total_points: number;
}

export interface FantasyUserBreakdown {
  user_id: string;
  assets: FantasyAssetBreakdown[];
  total_points: number;
}

export interface FantasyActiveAsset {
  id: number;
  content_type: "movie" | "tv";
  content_id: number;
  owner_user_id: string;
  auction_price: number;
  slot_type: "movie" | "tv" | "flex" | "bench";
  drafted_at: string;
}

export interface FantasyAssetWeeklyScore {
  week_number: number;
  points: number;
  breakdown: Record<string, unknown>;
  computed_at: string;
}

export interface FantasyWeeklyChartPoint {
  week: number;
  weekly: number;
  cumulative: number;
}

export interface FantasyWeeklyChart {
  weeks: number[];
  series: { user_id: string; points: FantasyWeeklyChartPoint[] }[];
}

export interface FantasyInvitation {
  id: number;
  league_id: number;
  user_id: string;
  invited_by: string | null;
  created_at: string;
  league?: {
    id: number;
    name: string;
    owner_id: string | null;
    starting_budget: number;
    max_members: number;
  };
  inviter?: {
    id: string;
    username: string | null;
    display_name: string | null;
  };
  invitee?: {
    id: string;
    username: string | null;
    display_name: string | null;
  };
}

// ─── Query keys ─────────────────────────────────────────────────────────────

const fantasyKeys = {
  myLeagues: () => ["fantasy", "leagues", "mine"] as const,
  league: (id: number) => ["fantasy", "leagues", id] as const,
  members: (id: number) => ["fantasy", "leagues", id, "members"] as const,
  seasons: (id: number) => ["fantasy", "leagues", id, "seasons"] as const,
  leagueInvitations: (id: number) =>
    ["fantasy", "leagues", id, "invitations"] as const,
  myInvitations: () => ["fantasy", "invitations", "mine"] as const,
  standings: (lid: number, sid: number, throughWeek?: number) =>
    ["fantasy", "leagues", lid, "seasons", sid, "standings", throughWeek ?? "all"] as const,
  userBreakdown: (lid: number, sid: number, uid: string) =>
    ["fantasy", "leagues", lid, "seasons", sid, "users", uid, "breakdown"] as const,
  activeAssets: (lid: number, sid: number) =>
    ["fantasy", "leagues", lid, "seasons", sid, "assets"] as const,
  weeklyChart: (lid: number, sid: number) =>
    ["fantasy", "leagues", lid, "seasons", sid, "chart"] as const,
  assetWeeklyScores: (lid: number, aid: number) =>
    ["fantasy", "leagues", lid, "assets", aid, "weekly-scores"] as const,
};

// ─── Reads ──────────────────────────────────────────────────────────────────

export function useMyLeagues() {
  return useQuery({
    queryKey: fantasyKeys.myLeagues(),
    queryFn: ({ signal }) =>
      queryFetch<FantasyLeague[]>("/fantasy/leagues", { signal }),
  });
}

export function useLeague(leagueId: number | undefined) {
  return useQuery({
    queryKey: fantasyKeys.league(leagueId ?? 0),
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/fantasy/leagues/${leagueId}`, { signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()) as FantasyLeague;
    },
    enabled: !!leagueId,
    retry: false,
  });
}

export function useLeagueMembers(leagueId: number | undefined) {
  return useQuery({
    queryKey: fantasyKeys.members(leagueId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<FantasyMember[]>(`/fantasy/leagues/${leagueId}/members`, {
        signal,
      }),
    enabled: !!leagueId,
  });
}

export function useLeagueSeasons(leagueId: number | undefined) {
  return useQuery({
    queryKey: fantasyKeys.seasons(leagueId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<FantasySeason[]>(`/fantasy/leagues/${leagueId}/seasons`, {
        signal,
      }),
    enabled: !!leagueId,
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

export interface CreateLeagueBody {
  name: string;
  starting_budget?: number;
  weekly_allowance?: number;
  roster_movie_slots?: number;
  roster_tv_slots?: number;
  roster_flex_slots?: number;
  bench_slots?: number;
  boost_slots?: number;
  max_members?: number;
}

export function useCreateLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeagueBody) =>
      jsonFetch<FantasyLeague>("/fantasy/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fantasyKeys.myLeagues() });
    },
  });
}

export function useDeleteLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leagueId: number) => {
      const res = await apiFetch(`/fantasy/leagues/${leagueId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fantasy", "leagues"] });
    },
  });
}

export function useLeagueInvitations(leagueId: number | undefined) {
  return useQuery({
    queryKey: fantasyKeys.leagueInvitations(leagueId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<FantasyInvitation[]>(
        `/fantasy/leagues/${leagueId}/invitations`,
        { signal },
      ),
    enabled: !!leagueId,
  });
}

export function useMyLeagueInvitations() {
  return useQuery({
    queryKey: fantasyKeys.myInvitations(),
    queryFn: ({ signal }) =>
      queryFetch<FantasyInvitation[]>("/fantasy/invitations/mine", { signal }),
  });
}

export function useInviteToLeague(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { username: string }) =>
      jsonFetch<FantasyInvitation>(`/fantasy/leagues/${leagueId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fantasyKeys.leagueInvitations(leagueId) });
    },
  });
}

export function useCancelLeagueInvitation(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: number) => {
      const res = await apiFetch(
        `/fantasy/leagues/${leagueId}/invitations/${invitationId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fantasyKeys.leagueInvitations(leagueId) });
    },
  });
}

export function useRespondToLeagueInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { invitationId: number; accept: boolean }) =>
      jsonFetch<{ league_id: number; accepted: boolean }>(
        `/fantasy/invitations/${body.invitationId}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accept: body.accept }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fantasyKeys.myInvitations() });
      qc.invalidateQueries({ queryKey: fantasyKeys.myLeagues() });
    },
  });
}

export function useRemoveLeagueMember(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const res = await apiFetch(
        `/fantasy/leagues/${leagueId}/members/${encodeURIComponent(targetUserId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fantasyKeys.members(leagueId) });
      qc.invalidateQueries({ queryKey: fantasyKeys.league(leagueId) });
    },
  });
}

export function useLeaveLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leagueId: number) => {
      const res = await apiFetch(`/fantasy/leagues/${leagueId}/leave`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fantasy", "leagues"] });
    },
  });
}

export interface CreateSeasonBody {
  code: "summer" | "fall" | "holiday" | "spring";
  year: number;
  starts_at: string;
  ends_at: string;
  name?: string;
  make_current?: boolean;
}

export function useCreateSeason(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSeasonBody) =>
      jsonFetch<FantasySeason>(`/fantasy/leagues/${leagueId}/seasons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fantasyKeys.seasons(leagueId) });
      qc.invalidateQueries({ queryKey: fantasyKeys.league(leagueId) });
    },
  });
}

export function useSetCurrentSeason(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (seasonId: number) => {
      const res = await apiFetch(
        `/fantasy/leagues/${leagueId}/seasons/${seasonId}/set-current`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fantasyKeys.league(leagueId) });
      qc.invalidateQueries({ queryKey: fantasyKeys.seasons(leagueId) });
    },
  });
}

// ─── Season read endpoints ──────────────────────────────────────────────────

export function useSeasonStandings(
  leagueId: number | undefined,
  seasonId: number | undefined,
  throughWeek?: number,
) {
  return useQuery({
    queryKey: fantasyKeys.standings(leagueId ?? 0, seasonId ?? 0, throughWeek),
    queryFn: ({ signal }) => {
      const qs = throughWeek ? `?through_week=${throughWeek}` : "";
      return queryFetch<FantasyStandingsRow[]>(
        `/fantasy/leagues/${leagueId}/seasons/${seasonId}/standings${qs}`,
        { signal },
      );
    },
    enabled: !!leagueId && !!seasonId,
  });
}

export function useUserBreakdown(
  leagueId: number | undefined,
  seasonId: number | undefined,
  userId: string | undefined,
) {
  return useQuery({
    queryKey: fantasyKeys.userBreakdown(leagueId ?? 0, seasonId ?? 0, userId ?? ""),
    queryFn: ({ signal }) =>
      queryFetch<FantasyUserBreakdown>(
        `/fantasy/leagues/${leagueId}/seasons/${seasonId}/users/${encodeURIComponent(userId!)}/breakdown`,
        { signal },
      ),
    enabled: !!leagueId && !!seasonId && !!userId,
  });
}

export function useSeasonActiveAssets(
  leagueId: number | undefined,
  seasonId: number | undefined,
) {
  return useQuery({
    queryKey: fantasyKeys.activeAssets(leagueId ?? 0, seasonId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<FantasyActiveAsset[]>(
        `/fantasy/leagues/${leagueId}/seasons/${seasonId}/assets`,
        { signal },
      ),
    enabled: !!leagueId && !!seasonId,
  });
}

export function useWeeklyChart(
  leagueId: number | undefined,
  seasonId: number | undefined,
) {
  return useQuery({
    queryKey: fantasyKeys.weeklyChart(leagueId ?? 0, seasonId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<FantasyWeeklyChart>(
        `/fantasy/leagues/${leagueId}/seasons/${seasonId}/chart`,
        { signal },
      ),
    enabled: !!leagueId && !!seasonId,
  });
}

export function useAssetWeeklyScores(
  leagueId: number | undefined,
  assetId: number | undefined,
) {
  return useQuery({
    queryKey: fantasyKeys.assetWeeklyScores(leagueId ?? 0, assetId ?? 0),
    queryFn: ({ signal }) =>
      queryFetch<FantasyAssetWeeklyScore[]>(
        `/fantasy/leagues/${leagueId}/assets/${assetId}/weekly-scores`,
        { signal },
      ),
    enabled: !!leagueId && !!assetId,
  });
}
