import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import {
  useAuctionWebSocket,
  useCompleteDraft,
  useDraftState,
  useEligibleAssetSearch,
  useMediaSummary,
  useNominate,
  useNominationHistory,
  usePassNomination,
  usePlaceBid,
  useSkipTurn,
  useStartDraft,
  type AuctionMemberState,
  type AuctionNomination,
  type DraftState,
  type EligibleSearchShow,
} from "../hooks/api/useAuctionDraft";
import { useLeague, useLeagueMembers, useLeagueSeasons } from "../hooks/api/useFantasy";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser } from "../hooks/useAuthUser";
import { formatHumanDate } from "../utils/formatDate";

export default function DraftRoom() {
  const { leagueId, seasonId } = useParams<{
    leagueId: string;
    seasonId: string;
  }>();
  const lid = leagueId ? parseInt(leagueId, 10) : undefined;
  const sid = seasonId ? parseInt(seasonId, 10) : undefined;

  const me = useAuthUser();
  const { data: league, isLoading: leagueLoading, error: leagueError } = useLeague(lid);
  const { data: seasons = [] } = useLeagueSeasons(lid);
  const { data: members = [] } = useLeagueMembers(lid);
  const { data: draftState, isLoading } = useDraftState(lid, sid);
  useAuctionWebSocket(lid, sid);

  const season = seasons.find((s) => s.id === sid);
  usePageTitle(season ? `${season.name} Draft` : "Draft");

  if (!lid || !sid) {
    return (
      <p className="px-6 lg:px-10 pt-8 text-neutral-500 text-sm">
        Invalid draft URL.
      </p>
    );
  }

  if (leagueError || (league === null && !leagueLoading)) {
    return (
      <div className="px-6 lg:px-10 pt-8">
        <p className="text-neutral-300">
          League not found or you don't have access.
        </p>
        <Link to="/fantasy" className="text-primary-400 text-sm mt-2 inline-block">
          ← My leagues
        </Link>
      </div>
    );
  }

  if (!league || !season) {
    return (
      <p className="px-6 lg:px-10 pt-8 text-neutral-500 text-sm">Loading…</p>
    );
  }

  const isOwner = league.viewer_role === "owner";
  const isMyTurn = draftState?.current_nominator_user_id === me?.uid;

  // Build a username/display lookup for showing nice names everywhere.
  const userLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      map.set(
        m.user_id,
        m.display_name ||
          m.user_display_name ||
          (m.username ? `@${m.username}` : m.user_id),
      );
    }
    return map;
  }, [members]);

  return (
    <div className="pb-24">
      <div className="px-6 lg:px-10 pt-8">
        <Link
          to={`/fantasy/${lid}/seasons/${sid}`}
          className="text-[12px] text-neutral-500 hover:text-neutral-300"
        >
          ← {season.name}
        </Link>

        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
              Auction Draft
            </h1>
            <p className="text-[12px] text-neutral-500 mt-2">{season.name}</p>
          </div>
          <DraftStatusBadge state={draftState} />
        </div>
      </div>

      {isLoading ? (
        <p className="px-6 lg:px-10 mt-8 text-neutral-500 text-sm">Loading draft…</p>
      ) : (
        <div className="px-6 lg:px-10 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <MainPanel
              leagueId={lid}
              seasonId={sid}
              state={draftState}
              isOwner={isOwner}
              isMyTurn={isMyTurn}
              myBudget={
                draftState?.members.find((m) => m.user_id === me?.uid)?.budget_remaining ?? 0
              }
              myOpenSlots={
                draftState?.members.find((m) => m.user_id === me?.uid)?.open_slots ?? {
                  movie: 0,
                  tv: 0,
                  flex: 0,
                }
              }
              userLabels={userLabels}
              seasonStartsAt={season.starts_at}
              seasonEndsAt={season.ends_at}
            />
            <NominationHistoryPanel
              leagueId={lid}
              seasonId={sid}
              userLabels={userLabels}
            />
          </div>
          <div>
            <MembersPanel
              state={draftState}
              userLabels={userLabels}
              currentNominatorId={draftState?.current_nominator_user_id ?? null}
              passedUserIds={new Set(draftState?.current_nomination?.passed_user_ids ?? [])}
              highBidderId={draftState?.current_nomination?.current_high_bidder_id ?? null}
              minNextBid={
                draftState?.current_nomination
                  ? draftState.current_nomination.current_high_bid + 1
                  : 0
              }
              activeContentType={draftState?.current_nomination?.content_type ?? null}
            />
            {isOwner && draftState?.status === "draft" && (
              <OwnerControls leagueId={lid} seasonId={sid} hasOpenNomination={!!draftState.current_nomination} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftStatusBadge({ state }: { state: DraftState | undefined }) {
  const status = state?.status ?? "upcoming";
  const meta = {
    upcoming: { label: "NOT STARTED", color: "text-neutral-300 bg-neutral-800" },
    draft: {
      label: "DRAFTING",
      color: "text-amber-300 bg-amber-500/15 border border-amber-500/30",
    },
    active: {
      label: "DRAFT COMPLETE",
      color: "text-emerald-300 bg-emerald-500/15 border border-emerald-500/30",
    },
    complete: { label: "FINISHED", color: "text-neutral-500 bg-neutral-800/50" },
  }[status];
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────

function MainPanel({
  leagueId,
  seasonId,
  state,
  isOwner,
  isMyTurn,
  myBudget,
  myOpenSlots,
  userLabels,
  seasonStartsAt,
  seasonEndsAt,
}: {
  leagueId: number;
  seasonId: number;
  state: DraftState | undefined;
  isOwner: boolean;
  isMyTurn: boolean;
  myBudget: number;
  myOpenSlots: { movie: number; tv: number; flex: number };
  userLabels: Map<string, string>;
  seasonStartsAt: string;
  seasonEndsAt: string;
}) {
  if (!state) return null;

  if (state.status === "upcoming") {
    return isOwner ? (
      <StartDraftCard leagueId={leagueId} seasonId={seasonId} />
    ) : (
      <WaitingCard
        title="The draft hasn't started yet"
        body="Wait for the league owner to kick off the auction."
      />
    );
  }

  if (state.status === "complete" || state.status === "active") {
    return (
      <WaitingCard
        title="Draft complete"
        body="Head back to the season page to see standings as scoring runs."
      />
    );
  }

  // status === 'draft'
  if (state.current_nomination) {
    return (
      <ActiveNominationCard
        leagueId={leagueId}
        seasonId={seasonId}
        nomination={state.current_nomination}
        myBudget={myBudget}
        myOpenSlots={myOpenSlots}
        userLabels={userLabels}
      />
    );
  }

  if (isMyTurn) {
    return (
      <NominateCard
        leagueId={leagueId}
        seasonId={seasonId}
        myBudget={myBudget}
        seasonStartsAt={seasonStartsAt}
        seasonEndsAt={seasonEndsAt}
      />
    );
  }

  const nominatorLabel =
    state.current_nominator_user_id
      ? userLabels.get(state.current_nominator_user_id) ?? state.current_nominator_user_id
      : "someone";
  return (
    <WaitingCard
      title={`Waiting on ${nominatorLabel}`}
      body="They're choosing who to nominate next."
      deadline={state.nomination_deadline}
    />
  );
}

function StartDraftCard({
  leagueId,
  seasonId,
}: {
  leagueId: number;
  seasonId: number;
}) {
  const start = useStartDraft(leagueId, seasonId);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    try {
      await start.mutateAsync({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start draft.");
    }
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
        Owner action
      </p>
      <h2 className="text-xl font-semibold text-white">Start the draft</h2>
      <p className="text-[13px] text-neutral-400 mt-1.5 max-w-md">
        The nomination order will be randomized. Each player gets the configured
        nomination window to pick an asset and a starting bid.
      </p>
      {error && (
        <p className="text-[12px] text-red-400 mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <button
        onClick={go}
        disabled={start.isPending}
        className="mt-4 text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl"
      >
        {start.isPending ? "Starting…" : "Start draft"}
      </button>
    </div>
  );
}

function WaitingCard({
  title,
  body,
  deadline,
}: {
  title: string;
  body: string;
  deadline?: string | null;
}) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="text-[13px] text-neutral-400 mt-1.5">{body}</p>
      {deadline && <Countdown expiresAt={deadline} label="auto-skip in" />}
    </div>
  );
}

// ─── Active nomination ──────────────────────────────────────────────────────

function ActiveNominationCard({
  leagueId,
  seasonId,
  nomination,
  myBudget,
  myOpenSlots,
  userLabels,
}: {
  leagueId: number;
  seasonId: number;
  nomination: AuctionNomination;
  myBudget: number;
  myOpenSlots: { movie: number; tv: number; flex: number };
  userLabels: Map<string, string>;
}) {
  const me = useAuthUser();
  const placeBid = usePlaceBid(leagueId, seasonId);
  const passNom = usePassNomination(leagueId, seasonId);
  const minNextBid = nomination.current_high_bid + 1;
  const [bid, setBid] = useState(minNextBid);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBid(nomination.current_high_bid + 1);
  }, [nomination.current_high_bid]);

  const iAmHighBidder = nomination.current_high_bidder_id === me?.uid;
  const iHavePassed = (nomination.passed_user_ids ?? []).includes(me?.uid ?? "");
  const passedCount = nomination.passed_user_ids?.length ?? 0;
  const slotMeta = slotBadge(nomination.slot_type);
  const { data: media } = useMediaSummary(
    nomination.content_type,
    nomination.content_id,
  );

  // Does the viewer have a slot that can hold this content type?
  const dedicatedSlot =
    nomination.content_type === "movie"
      ? myOpenSlots.movie
      : myOpenSlots.tv;
  const iHaveSlot = dedicatedSlot > 0 || myOpenSlots.flex > 0;
  const iCanAfford = myBudget >= minNextBid;

  async function submit(amount: number) {
    setError(null);
    try {
      await placeBid.mutateAsync({
        nominationId: nomination.id,
        amount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place bid.");
    }
  }

  async function dropOut() {
    setError(null);
    if (!confirm("Drop out of bidding on this asset? You can't bid again.")) return;
    try {
      await passNom.mutateAsync(nomination.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pass.");
    }
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
      <div className="p-5 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-5">
        <Link
          to={
            nomination.content_type === "movie"
              ? `/movie/${nomination.content_id}`
              : `/show/${nomination.content_id}`
          }
          className="block"
        >
          <div className="aspect-[2/3] bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800">
            {media?.poster_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w342${media.poster_path}`}
                alt={media.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-700 text-[11px] text-center px-3">
                {nomination.content_type === "movie" ? "Movie" : "Show"}
                <br />#{nomination.content_id}
              </div>
            )}
          </div>
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span
              className={`text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded ${slotMeta.color}`}
            >
              {slotMeta.label} SLOT
            </span>
            <span className="text-[11px] text-neutral-500 font-mono uppercase">
              Nominated by{" "}
              <span className="text-neutral-300">
                {userLabels.get(nomination.nominator_user_id) ?? "—"}
              </span>
            </span>
          </div>
          <h2 className="text-2xl font-semibold text-white tracking-tight">
            {media?.title ??
              `${nomination.content_type === "movie" ? "Movie" : "Show"} #${nomination.content_id}`}
          </h2>
          {(media?.release_date || media?.first_air_date) && (
            <p className="text-[12px] text-neutral-500 mt-1">
              {(media.release_date || media.first_air_date)?.slice(0, 10)}
            </p>
          )}

          <div className="mt-4 flex items-baseline gap-3 flex-wrap">
            <p className="text-[10px] font-mono tracking-[0.12em] text-neutral-500 uppercase">
              Current high bid
            </p>
            <p className="text-3xl font-bold text-primary-300 tabular-nums">
              ${nomination.current_high_bid}
            </p>
            <p className="text-[12px] text-neutral-400">
              from{" "}
              <span className="text-neutral-200 font-medium">
                {userLabels.get(nomination.current_high_bidder_id) ?? "—"}
              </span>
              {iAmHighBidder && (
                <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                  ● YOU
                </span>
              )}
            </p>
          </div>

          <Countdown expiresAt={nomination.expires_at} label="closes in" />

          {!iAmHighBidder && !iHavePassed && !iHaveSlot && (
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <p className="text-[12px] text-neutral-400 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5">
                You can't bid on this — you have no open {nomination.content_type} slot
                and no open flex slot.
              </p>
            </div>
          )}
          {!iAmHighBidder && !iHavePassed && iHaveSlot && !iCanAfford && (
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <p className="text-[12px] text-neutral-400 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5">
                You're out of budget for this auction — current bid is $
                {nomination.current_high_bid} and you have ${myBudget}. You'll
                automatically sit out the rest of this nomination.
              </p>
            </div>
          )}
          {!iAmHighBidder && !iHavePassed && iHaveSlot && iCanAfford && (
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="number"
                  min={minNextBid}
                  max={myBudget}
                  value={bid}
                  onChange={(e) => setBid(parseInt(e.target.value, 10) || 0)}
                  className="w-24 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white text-center font-mono outline-none focus:border-neutral-600"
                />
                <button
                  onClick={() => submit(bid)}
                  disabled={
                    placeBid.isPending || bid < minNextBid || bid > myBudget
                  }
                  className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
                >
                  {placeBid.isPending ? "Bidding…" : `Bid $${bid}`}
                </button>
                {[1, 5, 10].map((inc) => {
                  const v = nomination.current_high_bid + inc;
                  return (
                    <button
                      key={inc}
                      onClick={() => submit(v)}
                      disabled={placeBid.isPending || v > myBudget}
                      className="text-[12px] font-medium text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-white disabled:opacity-50 px-3 py-2 rounded-lg"
                    >
                      +${inc}
                    </button>
                  );
                })}
                <button
                  onClick={dropOut}
                  disabled={passNom.isPending}
                  className="ml-auto text-[12px] font-medium text-neutral-400 border border-neutral-700 hover:border-red-500/60 hover:text-red-400 disabled:opacity-50 px-3 py-2 rounded-lg"
                  title="Pass on this asset — you won't be able to bid again on it"
                >
                  {passNom.isPending ? "Passing…" : "I'm out"}
                </button>
              </div>
              <p className="text-[11px] text-neutral-500 mt-2">
                Your budget: ${myBudget}. Bid must exceed ${nomination.current_high_bid}.
                {passedCount > 0 && ` · ${passedCount} passed.`}
              </p>
              {error && (
                <p className="text-[12px] text-red-400 mt-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </div>
          )}
          {iHavePassed && (
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <p className="text-[12px] text-neutral-500">
                You passed on this asset.
                {passedCount > 0 && ` · ${passedCount} passed total.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {nomination.bids && nomination.bids.length > 0 && (
        <div className="border-t border-neutral-800 px-5 py-4">
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
            Bid history
          </p>
          <div className="flex flex-col gap-1">
            {nomination.bids.slice(0, 8).map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between text-[12px]"
              >
                <span className="text-neutral-300">
                  {userLabels.get(b.user_id) ?? b.user_id}
                </span>
                <span className="font-mono text-neutral-400 tabular-nums">
                  ${b.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Nominate form ──────────────────────────────────────────────────────────

function NominateCard({
  leagueId,
  seasonId,
  myBudget,
  seasonStartsAt,
  seasonEndsAt,
}: {
  leagueId: number;
  seasonId: number;
  myBudget: number;
  seasonStartsAt: string;
  seasonEndsAt: string;
}) {
  const nominate = useNominate(leagueId, seasonId);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pick, setPick] = useState<
    { content_type: "movie" | "tv"; content_id: number; title: string } | null
  >(null);
  const [bid, setBid] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Server filters: movies must release in [start, end]; shows must have a
  // season whose air_date falls in the window. Server enriches show results
  // with `eligible_air_date` — the in-window season's start date.
  const { data: results, isFetching } = useEligibleAssetSearch(
    leagueId,
    seasonId,
    debounced,
  );
  const start = seasonStartsAt.slice(0, 10);
  const end = seasonEndsAt.slice(0, 10);
  const filteredMovies = results?.movies ?? [];
  const filteredShows = results?.shows ?? [];

  async function submit() {
    if (!pick) return;
    setError(null);
    try {
      await nominate.mutateAsync({
        content_type: pick.content_type,
        content_id: pick.content_id,
        starting_bid: bid,
      });
      setPick(null);
      setQuery("");
      setDebounced("");
      setBid(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not nominate.");
    }
  }

  return (
    <div className="bg-neutral-900 border border-amber-500/30 rounded-2xl p-5">
      <p className="font-mono text-[10px] tracking-[0.14em] text-amber-300 uppercase mb-1">
        Your turn to nominate
      </p>
      <h2 className="text-xl font-semibold text-white">
        Pick an asset to auction
      </h2>
      <p className="text-[12px] text-neutral-400 mt-1">
        Search for a movie or show. Whoever bids highest gets it.
      </p>

      <div className="mt-4">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies + shows…"
          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600"
        />
        <p className="text-[11px] text-neutral-500 mt-1.5">
          Only assets with content during {formatHumanDate(start)} –{" "}
          {formatHumanDate(end)} are shown.
        </p>
      </div>

      {debounced.trim() && !pick && (
        <div className="mt-3 max-h-64 overflow-y-auto flex flex-col gap-1">
          {filteredMovies.slice(0, 5).map((m) => (
            <button
              key={`m-${m.id}`}
              onClick={() =>
                setPick({
                  content_type: "movie",
                  content_id: m.id,
                  title: m.title ?? `Movie #${m.id}`,
                })
              }
              className="flex items-center gap-3 bg-neutral-950 border border-neutral-800 hover:border-neutral-700 rounded-xl px-3 py-2 text-left"
            >
              <SmallPoster path={m.poster_path} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-white truncate">
                  {m.title}
                </p>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  Movie · {formatHumanDate(m.release_date) ?? m.release_date}
                </p>
              </div>
            </button>
          ))}
          {filteredShows.slice(0, 5).map((s) => (
            <button
              key={`s-${s.id}`}
              onClick={() =>
                setPick({
                  content_type: "tv",
                  content_id: s.id,
                  title: s.name ?? `Show #${s.id}`,
                })
              }
              className="flex items-center gap-3 bg-neutral-950 border border-neutral-800 hover:border-neutral-700 rounded-xl px-3 py-2 text-left"
            >
              <SmallPoster path={s.poster_path} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-white truncate">
                  {s.name}
                  {s.season_number != null && (
                    <span className="text-neutral-500 font-mono text-[11px] ml-1.5">
                      S{s.season_number}
                    </span>
                  )}
                </p>
                <ShowMetaLine show={s} />
              </div>
            </button>
          ))}
          {!isFetching &&
            filteredMovies.length === 0 &&
            filteredShows.length === 0 && (
              <p className="text-[12px] text-neutral-500 px-2 py-3">
                No results for "{debounced}" releasing between{" "}
                {formatHumanDate(start)} and {formatHumanDate(end)}.
              </p>
            )}
          {isFetching && (
            <p className="text-[12px] text-neutral-500 px-2 py-3">Searching…</p>
          )}
        </div>
      )}

      {pick && (
        <div className="mt-3 bg-neutral-950 border border-neutral-800 rounded-xl p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] font-medium text-white truncate">
              {pick.title}
            </p>
            <button
              onClick={() => setPick(null)}
              className="text-[11px] text-neutral-500 hover:text-neutral-300 shrink-0"
            >
              Change
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label className="text-[12px] text-neutral-400">Starting bid</label>
            <input
              type="number"
              min={1}
              max={myBudget}
              value={bid}
              onChange={(e) => setBid(parseInt(e.target.value, 10) || 1)}
              className="w-24 bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5 text-sm text-white text-center font-mono outline-none focus:border-neutral-600"
            />
            <button
              onClick={submit}
              disabled={nominate.isPending || bid < 1 || bid > myBudget}
              className="ml-auto text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
            >
              {nominate.isPending ? "Nominating…" : `Nominate at $${bid}`}
            </button>
          </div>
          <p className="text-[11px] text-neutral-500 mt-2">Budget: ${myBudget}.</p>
          {error && (
            <p className="text-[12px] text-red-400 mt-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ShowMetaLine({ show }: { show: EligibleSearchShow }) {
  const today = new Date().toISOString().slice(0, 10);
  const isPast = show.eligible_air_date < today;
  const parts: string[] = [];
  if (isPast) {
    parts.push("airing now");
    if (show.season_end_date) {
      parts.push(`ends ${formatHumanDate(show.season_end_date)}`);
    }
    if (show.episodes_remaining != null) {
      const left = show.episodes_remaining;
      parts.push(left > 0 ? `${left} ep${left === 1 ? "" : "s"} left` : "season finished");
    }
  } else {
    parts.push(`premieres ${formatHumanDate(show.eligible_air_date)}`);
    if (show.episode_count != null) {
      parts.push(`${show.episode_count} ep${show.episode_count === 1 ? "" : "s"}`);
    }
  }
  return (
    <p className="text-[11px] text-neutral-400 mt-0.5">
      Show · {parts.join(" · ")}
    </p>
  );
}

function SmallPoster({ path }: { path: string | null | undefined }) {
  if (!path) {
    return <div className="w-10 h-14 bg-neutral-900 border border-neutral-800 rounded shrink-0" />;
  }
  return (
    <img
      src={`${BASE_IMAGE_URL}/w92${path}`}
      alt=""
      className="w-10 h-14 object-cover rounded shrink-0"
      loading="lazy"
    />
  );
}

// ─── Members panel ──────────────────────────────────────────────────────────

function MembersPanel({
  state,
  userLabels,
  currentNominatorId,
  passedUserIds,
  highBidderId,
  minNextBid,
  activeContentType,
}: {
  state: DraftState | undefined;
  userLabels: Map<string, string>;
  currentNominatorId: string | null;
  passedUserIds: Set<string>;
  highBidderId: string | null;
  minNextBid: number;
  activeContentType: "movie" | "tv" | null;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
        Members
      </p>
      <div className="flex flex-col gap-2">
        {(state?.members ?? []).map((m) => {
          const isHighBidder = m.user_id === highBidderId;
          const slotForType =
            activeContentType === "movie"
              ? m.open_slots.movie
              : activeContentType === "tv"
                ? m.open_slots.tv
                : 0;
          const noSlot =
            activeContentType !== null &&
            !isHighBidder &&
            slotForType === 0 &&
            m.open_slots.flex === 0;
          const noBudget =
            activeContentType !== null &&
            !isHighBidder &&
            !passedUserIds.has(m.user_id) &&
            !noSlot &&
            m.budget_remaining < minNextBid;
          return (
            <MemberRow
              key={m.user_id}
              member={m}
              label={userLabels.get(m.user_id) ?? m.user_id}
              isCurrent={m.user_id === currentNominatorId}
              isHighBidder={isHighBidder}
              hasPassed={passedUserIds.has(m.user_id)}
              outOfBudget={noBudget}
              noEligibleSlot={noSlot}
            />
          );
        })}
      </div>
      {state?.nomination_order && state.nomination_order.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
            Nomination order
          </p>
          <ol className="text-[12px] text-neutral-400 space-y-0.5">
            {state.nomination_order.map((uid, i) => (
              <li
                key={`${uid}-${i}`}
                className={
                  i === state.next_nominator_index
                    ? "text-primary-300 font-medium"
                    : ""
                }
              >
                {i + 1}. {userLabels.get(uid) ?? uid}
                {i === state.next_nominator_index && " ←"}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function MemberRow({
  member,
  label,
  isCurrent,
  isHighBidder,
  hasPassed,
  outOfBudget,
  noEligibleSlot,
}: {
  member: AuctionMemberState;
  label: string;
  isCurrent: boolean;
  isHighBidder: boolean;
  hasPassed: boolean;
  outOfBudget: boolean;
  noEligibleSlot: boolean;
}) {
  const dimmed = hasPassed || outOfBudget || noEligibleSlot;
  return (
    <div
      className={`rounded-xl px-3 py-2.5 border ${
        isHighBidder
          ? "bg-emerald-500/10 border-emerald-500/40"
          : isCurrent
            ? "bg-primary-600/10 border-primary-500/40"
            : dimmed
              ? "bg-neutral-950 border-neutral-800 opacity-60"
              : "bg-neutral-900 border-neutral-800"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={`text-[13px] font-medium truncate ${dimmed ? "text-neutral-500 line-through" : "text-white"}`}
        >
          {label}
        </p>
        <div className="flex items-center gap-1.5">
          {isHighBidder && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-300">
              ● HIGH
            </span>
          )}
          {hasPassed && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              OUT
            </span>
          )}
          {!hasPassed && outOfBudget && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              NO $
            </span>
          )}
          {!hasPassed && noEligibleSlot && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              NO SLOT
            </span>
          )}
          <p className="text-[13px] font-mono font-semibold text-neutral-200 tabular-nums">
            ${member.budget_remaining}
          </p>
        </div>
      </div>
      <p className="text-[10.5px] text-neutral-500 font-mono mt-0.5">
        {member.open_slots.movie}M · {member.open_slots.tv}TV · {member.open_slots.flex}F open
      </p>
    </div>
  );
}

// ─── Owner controls ─────────────────────────────────────────────────────────

function OwnerControls({
  leagueId,
  seasonId,
  hasOpenNomination,
}: {
  leagueId: number;
  seasonId: number;
  hasOpenNomination: boolean;
}) {
  const skip = useSkipTurn(leagueId, seasonId);
  const complete = useCompleteDraft(leagueId, seasonId);
  const navigate = useNavigate();

  return (
    <div className="mt-6 bg-neutral-900/50 border border-neutral-800 rounded-xl p-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
        Owner controls
      </p>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => {
            if (confirm("Skip the current nominator's turn?")) skip.mutate();
          }}
          disabled={skip.isPending || hasOpenNomination}
          className="text-[12px] font-medium text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-white disabled:opacity-50 px-3 py-1.5 rounded-lg text-left"
          title={hasOpenNomination ? "Close the open auction first" : ""}
        >
          {skip.isPending ? "Skipping…" : "Skip current turn"}
        </button>
        <button
          onClick={() => {
            if (
              confirm(
                "Force-complete the draft? Any remaining slots stay empty.",
              )
            ) {
              complete.mutate(undefined, {
                onSuccess: () => navigate(`/fantasy/${leagueId}/seasons/${seasonId}`),
              });
            }
          }}
          disabled={complete.isPending || hasOpenNomination}
          className="text-[12px] font-medium text-red-400 border border-red-500/30 hover:border-red-500/60 disabled:opacity-50 px-3 py-1.5 rounded-lg text-left"
        >
          {complete.isPending ? "Completing…" : "Force-complete draft"}
        </button>
      </div>
    </div>
  );
}

// ─── Nomination history ─────────────────────────────────────────────────────

function NominationHistoryPanel({
  leagueId,
  seasonId,
  userLabels,
}: {
  leagueId: number;
  seasonId: number;
  userLabels: Map<string, string>;
}) {
  const { data: closed = [] } = useNominationHistory(leagueId, seasonId, "closed");
  if (closed.length === 0) return null;
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
        Recently drafted ({closed.length})
      </p>
      <div className="flex flex-col gap-2">
        {closed.slice(0, 10).map((n) => (
          <NominationHistoryRow
            key={n.id}
            nomination={n}
            userLabels={userLabels}
          />
        ))}
      </div>
    </div>
  );
}

function NominationHistoryRow({
  nomination,
  userLabels,
}: {
  nomination: AuctionNomination;
  userLabels: Map<string, string>;
}) {
  const { data: media } = useMediaSummary(
    nomination.content_type,
    nomination.content_id,
  );
  const slot = slotBadge(nomination.slot_type);
  const title =
    media?.title ??
    `${nomination.content_type === "movie" ? "Movie" : "Show"} #${nomination.content_id}`;
  return (
    <div className="flex items-center justify-between gap-3 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0 ${slot.color}`}
        >
          {slot.label}
        </span>
        <p className="text-[13px] text-white truncate">{title}</p>
      </div>
      <p className="text-[12px] text-neutral-400 shrink-0">
        <span className="text-neutral-200 font-medium">
          {userLabels.get(nomination.current_high_bidder_id) ?? nomination.current_high_bidder_id}
        </span>{" "}
        <span className="font-mono tabular-nums">
          ${nomination.current_high_bid}
        </span>
      </p>
    </div>
  );
}

// ─── Countdown timer ────────────────────────────────────────────────────────

function Countdown({ expiresAt, label }: { expiresAt: string; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const closing = remaining === 0;
  const seconds = Math.floor(remaining / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return (
    <p className="mt-3 font-mono text-[12px] text-neutral-400 uppercase tracking-wider">
      {label}{" "}
      <span
        className={`tabular-nums text-[14px] ${
          closing
            ? "text-amber-300"
            : remaining < 10_000
              ? "text-red-300"
              : "text-white"
        }`}
      >
        {closing
          ? "closing…"
          : m > 0
            ? `${m}:${s.toString().padStart(2, "0")}`
            : `0:${s.toString().padStart(2, "0")}`}
      </span>
    </p>
  );
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function slotBadge(slot: "movie" | "tv" | "flex") {
  return {
    movie: { label: "MOV", color: "text-sky-300 bg-sky-500/15" },
    tv: { label: "TV", color: "text-purple-300 bg-purple-500/15" },
    flex: { label: "FLEX", color: "text-amber-300 bg-amber-500/15" },
  }[slot];
}
