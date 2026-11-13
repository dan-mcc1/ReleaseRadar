import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";
import { SHOWN_PICKS, filterPicks } from "../../utils/households";

export type HouseholdRole = "owner" | "member";
export type MemberStatus = "Want To Watch" | "Currently Watching" | "Watched";

export interface HouseholdMember {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  role: HouseholdRole;
}

export interface HouseholdSummary {
  id: number;
  name: string;
  role: HouseholdRole;
  item_count: number;
  members: HouseholdMember[];
}

export interface HouseholdPerson {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
}

export interface HouseholdInvite {
  id: number;
  household: { id: number; name: string; member_count: number };
  invited_by: HouseholdPerson | null;
  created_at: string;
}

export interface HouseholdsResponse {
  households: HouseholdSummary[];
  invites: HouseholdInvite[];
}

export interface HouseholdItem {
  content_type: "tv" | "movie";
  id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
  added_by: HouseholdPerson | null;
  added_at: string;
  member_status: Record<string, MemberStatus>;
}

export interface PendingInvite {
  id: number;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  invited_by: string | null;
}

export interface HouseholdService {
  id: number;
  name: string;
  logo_path: string | null;
  user_ids: string[];
}

export interface HouseholdDetail {
  id: number;
  name: string;
  role: HouseholdRole;
  max_members: number;
  members: HouseholdMember[];
  invites: PendingInvite[];
  items: HouseholdItem[];
  services: HouseholdService[];
}

export interface EpisodeRef {
  season_number: number;
  episode_number: number;
}

export interface NextEpisode extends EpisodeRef {
  name: string | null;
  air_date: string | null;
}

export interface MemberProgress {
  user_id: string;
  last_watched: EpisodeRef | null;
  watched_count: number;
  next: NextEpisode | null;
  ahead_by: number;
}

export interface ShowProgress {
  id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
  total_aired: number;
  together_next: NextEpisode | null;
  members: MemberProgress[];
}

export interface HouseholdProgress {
  shows: ShowProgress[];
}

/** A friend you could invite; `invited` when an invite is already pending. */
export interface InvitableFriend extends HouseholdPerson {
  invited: boolean;
}

export type PickReason = "watched" | "lists";

export interface HouseholdPick {
  id: number;
  media_type: "tv" | "movie";
  /** Shows carry `name`, movies `title`. */
  name?: string;
  title?: string;
  first_air_date?: string | null;
  release_date?: string | null;
  poster_path: string | null;
  vote_average: number | null;
  because: { id: number; content_type: "tv" | "movie"; title: string; reason: PickReason }[];
}

export interface HouseholdRecommendations {
  movies: HouseholdPick[];
  shows: HouseholdPick[];
  /** How many titles the household shares; 0 means picks come from each person's own library. */
  shared_count: number;
}

export type PickTime = "any" | "short" | "hour" | "movie";

export type PickReasonItem =
  | { type: "next_episode"; user_ids: string[] }
  | { type: "shared_list"; user_id: string | null }
  | { type: "want"; user_ids: string[] }
  /** basis: "watched" (you watched `because` together) or "lists" (it's on your lists). */
  | { type: "recommended"; because: string | null; basis?: "watched" | "lists" | null };

export interface TonightPick {
  content_type: "tv" | "movie";
  id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
  /** Minutes: the episode's for a show, the movie's for a movie. */
  runtime: number | null;
  certification: string | null;
  episode: { season_number: number; episode_number: number; name: string | null } | null;
  /** Services tonight's people pay for that carry it. */
  services: { id: number; name: string }[];
  reasons: PickReasonItem[];
  score: number;
}

/** A title in a swipe session: a pick without its score. */
export type Candidate = Omit<TonightPick, "score">;

export interface SwipeSession {
  id: number;
  household_id: number;
  created_by: string | null;
  participants: string[];
  status: "open" | "picked" | "ended";
  expires_at: string;
  picked: { content_type: "tv" | "movie"; id: number } | null;
  candidates: Candidate[];
  /** Keyed `${content_type}:${id}`. */
  my_votes: Record<string, boolean>;
  /** Swipes so far, per participant. */
  progress: Record<string, number>;
  /** Everyone still taking part has swiped every card. */
  finished: boolean;
  /** Titles anyone said yes to, most yeses first. Null until the round is finished. */
  results: SwipeResultItem[] | null;
  /** Titles everyone said yes to. Empty until the round is finished. */
  matches: SwipeResultItem[];
}

/** A title in the results: how many of the `of` people said yes. */
export interface SwipeResultItem extends Candidate {
  yes: number;
  of: number;
}

/** A swipe's answer is the session as it now stands. */
export type SwipeResult = SwipeSession;

export const voteKey = (c: { content_type: string; id: number }) => `${c.content_type}:${c.id}`;

export interface PicksResponse {
  present: string[];
  picks: TonightPick[];
}

export interface PicksFilters {
  present: string[];
  time: PickTime;
  services: boolean;
  kids: boolean;
}

export interface LogRequest {
  householdId: number;
  userIds: string[];
  contentType: "tv" | "movie";
  contentId: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

/** An API error whose message is the server's plain `detail`, safe to show. */
export class HouseholdError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HouseholdError";
    this.status = status;
  }
}

/** The server's plain message for a household error, or a fallback. */
export function householdErrorMessage(err: unknown, fallback = "Couldn't save that. Try again."): string {
  return err instanceof HouseholdError && err.message ? err.message : fallback;
}

async function send<T = { ok: boolean }>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail = typeof data?.detail === "string" ? data.detail : "";
    throw new HouseholdError(res.status, detail);
  }
  return (await res.json().catch(() => ({}))) as T;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function useHouseholds() {
  const user = useAuthUser();
  return useQuery<HouseholdsResponse>({
    queryKey: queryKeys.households(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch<HouseholdsResponse>("/households", { signal }),
    enabled: !!user,
    staleTime: 1000 * 60,
  });
}

export function useHousehold(id: number) {
  const user = useAuthUser();
  return useQuery<HouseholdDetail>({
    queryKey: queryKeys.household(user?.uid ?? "", id),
    queryFn: ({ signal }) => queryFetch<HouseholdDetail>(`/households/${id}`, { signal }),
    enabled: !!user && id > 0,
  });
}

export function useHouseholdProgress(id: number, enabled = true) {
  const user = useAuthUser();
  return useQuery<HouseholdProgress>({
    queryKey: queryKeys.householdProgress(user?.uid ?? "", id),
    queryFn: ({ signal }) => queryFetch<HouseholdProgress>(`/households/${id}/progress`, { signal }),
    enabled: !!user && id > 0 && enabled,
  });
}

export function useHouseholdInvitable(id: number, enabled = true) {
  const user = useAuthUser();
  return useQuery<InvitableFriend[]>({
    queryKey: queryKeys.householdInvitable(user?.uid ?? "", id),
    queryFn: ({ signal }) => queryFetch<InvitableFriend[]>(`/households/${id}/invitable`, { signal }),
    enabled: !!user && id > 0 && enabled,
  });
}

export function useHouseholdRecommendations(id: number, enabled = true) {
  const user = useAuthUser();
  return useQuery<HouseholdRecommendations>({
    queryKey: queryKeys.householdRecommendations(user?.uid ?? "", id),
    queryFn: ({ signal }) =>
      queryFetch<HouseholdRecommendations>(`/households/${id}/recommendations`, { signal }),
    enabled: !!user && id > 0 && enabled,
    staleTime: 1000 * 60 * 5,
  });
}

/** Ranked picks for tonight: what the people present could watch together. */
/**
 * Tonight's picks. One request per set of people watching (cached, so going
 * back to a set you had is instant); the time, services and kid-friendly
 * filters run here, on the already-loaded list, so toggling them is instant.
 */
export function useHouseholdPicks(id: number, filters: PicksFilters) {
  const user = useAuthUser();
  const present = filters.present.join(",");
  return useQuery<PicksResponse, Error, PicksResponse>({
    queryKey: queryKeys.householdPicks(user?.uid ?? "", id, [present]),
    queryFn: ({ signal }) =>
      queryFetch<PicksResponse>(`/households/${id}/picks?present=${encodeURIComponent(present)}`, { signal }),
    select: (data) => ({ ...data, picks: filterPicks(data.picks, filters).slice(0, SHOWN_PICKS) }),
    enabled: !!user && id > 0 && filters.present.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 2,
  });
}

/** The household's current swipe session, or null. Live events keep it fresh; polling is the backup. */
// Swipes whose vote hasn't been saved yet. While any are, nothing replaces
// the session in the cache with server data: a refresh that read the server
// before the newest vote was saved would bring back the card just swiped.
// The last swipe to finish refreshes once, with every vote in.
let swipesInFlight = 0;

/** True while a swipe is still being saved (polling and live events wait). */
export function swipeInFlight(): boolean {
  return swipesInFlight > 0;
}

export function useHouseholdSession(id: number) {
  const user = useAuthUser();
  return useQuery<SwipeSession | null>({
    queryKey: queryKeys.householdSession(user?.uid ?? "", id),
    queryFn: ({ signal }) => queryFetch<SwipeSession | null>(`/households/${id}/sessions/current`, { signal }),
    enabled: !!user && id > 0,
    // A backup to the live events, paused while a swipe is being saved.
    refetchInterval: (query) => (query.state.data?.status === "open" && !swipeInFlight() ? 5000 : false),
  });
}

/** Ids of the households that already hold this title. */
export function useHouseholdsContaining(contentType: "tv" | "movie", contentId: number, enabled = true) {
  const user = useAuthUser();
  return useQuery<number[]>({
    queryKey: queryKeys.householdsContaining(user?.uid ?? "", contentType, contentId),
    queryFn: async ({ signal }) => {
      const data = await queryFetch<{ household_ids: number[] }>(
        `/households/containing?content_type=${contentType}&content_id=${contentId}`,
        { signal },
      );
      return data.household_ids;
    },
    enabled: !!user && enabled,
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

function useInvalidateHouseholds() {
  const qc = useQueryClient();
  const user = useAuthUser();
  return () => qc.invalidateQueries({ queryKey: queryKeys.households(user?.uid ?? "") });
}

export function useCreateHousehold() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: (name: string) => send<HouseholdSummary>("/households", "POST", { name }),
    onSettled: invalidate,
  });
}

export function useRenameHousehold() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      send<HouseholdSummary>(`/households/${id}`, "PATCH", { name }),
    onSettled: invalidate,
  });
}

export function useDeleteHousehold() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: (id: number) => send(`/households/${id}`, "DELETE"),
    onSettled: invalidate,
  });
}

function useRespondToInvite(action: "accept" | "decline") {
  const qc = useQueryClient();
  const user = useAuthUser();
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: (inviteId: number) =>
      send<HouseholdSummary | { ok: boolean }>(`/households/invites/${inviteId}/${action}`, "POST"),
    onSettled: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: queryKeys.navCounts(user?.uid ?? "") });
    },
  });
}

export function useAcceptHouseholdInvite() {
  return useRespondToInvite("accept");
}

export function useDeclineHouseholdInvite() {
  return useRespondToInvite("decline");
}

export function useInviteToHousehold() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ householdId, username }: { householdId: number; username: string }) =>
      send<{ id: number; user_id: string; username: string }>(
        `/households/${householdId}/invites`,
        "POST",
        { username },
      ),
    onSettled: invalidate,
  });
}

export function useCancelHouseholdInvite() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ householdId, inviteId }: { householdId: number; inviteId: number }) =>
      send(`/households/${householdId}/invites/${inviteId}`, "DELETE"),
    onSettled: invalidate,
  });
}

/** Remove a member, or leave when `userId` is your own. */
export function useRemoveHouseholdMember() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ householdId, userId }: { householdId: number; userId: string }) =>
      send(`/households/${householdId}/members/${encodeURIComponent(userId)}`, "DELETE"),
    onSettled: invalidate,
  });
}

interface ItemRef {
  householdId: number;
  contentType: "tv" | "movie";
  contentId: number;
}

export function useAddHouseholdItem() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ householdId, contentType, contentId }: ItemRef) =>
      send(`/households/${householdId}/items`, "POST", {
        content_type: contentType,
        content_id: contentId,
      }),
    onSettled: invalidate,
  });
}

export function useRemoveHouseholdItem() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ householdId, contentType, contentId }: ItemRef) =>
      send(`/households/${householdId}/items/${contentType}/${contentId}`, "DELETE"),
    onSettled: invalidate,
  });
}

/** Log a watch for the chosen members: a movie, a season or one episode. */
export function useLogForHousehold() {
  const qc = useQueryClient();
  const user = useAuthUser();
  return useMutation({
    mutationFn: ({ householdId, userIds, contentType, contentId, seasonNumber, episodeNumber }: LogRequest) =>
      send<{ logged: string[] }>(`/households/${householdId}/log`, "POST", {
        user_ids: userIds,
        content_type: contentType,
        content_id: contentId,
        ...(seasonNumber !== undefined ? { season_number: seasonNumber } : {}),
        ...(episodeNumber !== undefined ? { episode_number: episodeNumber } : {}),
      }),
    onSettled: (_data, _err, vars) => {
      const uid = user?.uid;
      if (!uid) return;
      qc.invalidateQueries({ queryKey: queryKeys.households(uid) });
      qc.invalidateQueries({ queryKey: queryKeys.watchedEpisodes(uid, vars.contentId) });
      qc.invalidateQueries({ queryKey: queryKeys.nextEpisode(uid, vars.contentId) });
      qc.invalidateQueries({ queryKey: ["watchStatus", uid] });
      qc.invalidateQueries({ queryKey: ["nextEpisodes", "bulk", uid] });
      qc.invalidateQueries({ queryKey: ["showProgress", uid, vars.contentId] });
    },
  });
}

// ── Swipe sessions ──────────────────────────────────────────────────────────

export interface StartSessionRequest {
  householdId: number;
  present: string[];
  time: PickTime;
  services: boolean;
  kids: boolean;
  /** Cards in the round (the server allows 3-15; default 10). */
  size?: number;
}

export function useStartSession() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ householdId, ...body }: StartSessionRequest) =>
      send<SwipeSession>(`/households/${householdId}/sessions`, "POST", body),
    onSettled: invalidate,
  });
}

export interface SwipeRequest {
  householdId: number;
  sessionId: number;
  contentType: "tv" | "movie";
  contentId: number;
  vote: boolean;
}

/** Say yes or no to a title. The vote shows at once and rolls back if the server refuses it. */
export function useSwipe() {
  const qc = useQueryClient();
  const user = useAuthUser();
  const uid = user?.uid ?? "";
  return useMutation({
    mutationFn: ({ householdId, sessionId, contentType, contentId, vote }: SwipeRequest) =>
      send<SwipeResult>(`/households/${householdId}/sessions/${sessionId}/votes`, "POST", {
        content_type: contentType,
        content_id: contentId,
        vote,
      }),
    onMutate: async (vars) => {
      swipesInFlight += 1;
      const key = queryKeys.householdSession(uid, vars.householdId);
      const voteId = `${vars.contentType}:${vars.contentId}`;
      // Drop any refresh already on its way: it predates this vote.
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<SwipeSession | null>(key)?.my_votes[voteId];
      qc.setQueryData<SwipeSession | null>(key, (old) => {
        if (!old) return old;
        const my_votes = { ...old.my_votes, [voteId]: vars.vote };
        return { ...old, my_votes, progress: { ...old.progress, [uid]: Object.keys(my_votes).length } };
      });
      return { key, voteId, before };
    },
    onError: (_err, _vars, ctx) => {
      // Undo just this vote, leaving any swipes made since in place.
      if (!ctx) return;
      qc.setQueryData<SwipeSession | null>(ctx.key, (old) => {
        if (!old) return old;
        const my_votes = { ...old.my_votes };
        if (ctx.before === undefined) delete my_votes[ctx.voteId];
        else my_votes[ctx.voteId] = ctx.before;
        return { ...old, my_votes, progress: { ...old.progress, [uid]: Object.keys(my_votes).length } };
      });
    },
    onSettled: (_data, _err, vars) => {
      swipesInFlight = Math.max(0, swipesInFlight - 1);
      // Only the last swipe to finish refreshes, once every vote is saved.
      if (swipesInFlight === 0) {
        qc.invalidateQueries({ queryKey: queryKeys.householdSession(uid, vars.householdId) });
      }
    },
  });
}

export function usePickFromSession() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({
      householdId,
      sessionId,
      contentType,
      contentId,
    }: Omit<SwipeRequest, "vote">) =>
      send<SwipeSession>(`/households/${householdId}/sessions/${sessionId}/pick`, "POST", {
        content_type: contentType,
        content_id: contentId,
      }),
    onSettled: invalidate,
  });
}

export function useEndSession() {
  const invalidate = useInvalidateHouseholds();
  return useMutation({
    mutationFn: ({ householdId, sessionId }: { householdId: number; sessionId: number }) =>
      send(`/households/${householdId}/sessions/${sessionId}/end`, "POST"),
    onSettled: invalidate,
  });
}
