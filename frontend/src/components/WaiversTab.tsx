import { useEffect, useState } from "react";
import { BASE_IMAGE_URL } from "../constants";
import {
  useCancelWaiverBid,
  useGrantAllowance,
  useMyWaiverBids,
  useResolveWaivers,
  useSubmitWaiverBid,
  type FantasyWaiverBid,
} from "../hooks/api/useWaivers";
import {
  useAssetSuggestions,
  useEligibleAssetSearch,
  useMediaSummary,
  type EligibleSearchShow,
} from "../hooks/api/useAuctionDraft";
import { useLeagueMembers, useUserBreakdown } from "../hooks/api/useFantasy";
import { useAuthUser } from "../hooks/useAuthUser";
import { formatHumanDate } from "../utils/formatDate";

export default function WaiversTab({
  leagueId,
  seasonId,
  seasonStartsAt,
  seasonEndsAt,
  isOwner,
}: {
  leagueId: number;
  seasonId: number;
  seasonStartsAt: string;
  seasonEndsAt: string;
  isOwner: boolean;
}) {
  const me = useAuthUser();
  const { data: myBids = [] } = useMyWaiverBids(leagueId, seasonId);
  const { data: members = [] } = useLeagueMembers(leagueId);
  const myMember = members.find((m) => m.user_id === me?.uid);
  const myBudget = myMember?.budget_remaining ?? 0;
  const pending = myBids.filter((b) => b.status === "pending");
  const resolved = myBids.filter((b) => b.status !== "pending");
  const pendingTotal = pending.reduce((sum, b) => sum + b.bid_amount, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 flex flex-col gap-6">
        {pendingTotal > 0 && (
          <p className="text-[12px] text-neutral-400">
            <span className="text-amber-300 font-semibold tabular-nums">
              ${pendingTotal}
            </span>{" "}
            tied up in {pending.length} pending bid
            {pending.length === 1 ? "" : "s"} ·{" "}
            <span className="text-white font-semibold tabular-nums">
              ${Math.max(0, myBudget - pendingTotal)}
            </span>{" "}
            free to bid right now.
          </p>
        )}
        <SubmitBidCard
          leagueId={leagueId}
          seasonId={seasonId}
          seasonStartsAt={seasonStartsAt}
          seasonEndsAt={seasonEndsAt}
          userId={me?.uid}
          myBudget={myBudget}
        />
        {pending.length > 0 && (
          <section>
            <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
              Pending bids ({pending.length})
            </p>
            <div className="flex flex-col gap-2">
              {pending.map((b) => (
                <BidRow key={b.id} bid={b} leagueId={leagueId} />
              ))}
            </div>
          </section>
        )}
        {resolved.length > 0 && (
          <section>
            <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
              Resolved bids
            </p>
            <div className="flex flex-col gap-2">
              {resolved.slice(0, 20).map((b) => (
                <BidRow key={b.id} bid={b} leagueId={leagueId} />
              ))}
            </div>
          </section>
        )}
        {myBids.length === 0 && (
          <p className="text-[13px] text-neutral-500 bg-neutral-900/50 border border-neutral-800 rounded-2xl p-4">
            You haven't submitted any waiver bids this season yet.
          </p>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <HowItWorksCard />
        {isOwner && (
          <OwnerWaiverActions leagueId={leagueId} seasonId={seasonId} />
        )}
      </aside>
    </div>
  );
}

function HowItWorksCard() {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
        How waivers work
      </p>
      <ul className="text-[12.5px] text-neutral-400 space-y-1.5 leading-relaxed">
        <li>
          Bids are <span className="text-neutral-200">blind</span> — others can't
          see your amount.
        </li>
        <li>
          Highest bidder wins each contested asset; ties go to the earliest
          submitter.
        </li>
        <li>
          You only spend money on a <span className="text-neutral-200">win</span>.
          Losing bids are free.
        </li>
        <li>
          Want to add but your roster is full? Pick a drop asset and it'll be
          dropped automatically if you win.
        </li>
      </ul>
    </div>
  );
}

function OwnerWaiverActions({
  leagueId,
  seasonId,
}: {
  leagueId: number;
  seasonId: number;
}) {
  const resolve = useResolveWaivers(leagueId, seasonId);
  const grant = useGrantAllowance(leagueId);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="bg-neutral-900 border border-amber-500/30 rounded-2xl p-4">
      <p className="font-mono text-[10px] tracking-[0.14em] text-amber-300 uppercase mb-2">
        Owner actions
      </p>
      <div className="flex flex-col gap-2">
        <button
          onClick={async () => {
            setMsg(null);
            try {
              const r = await resolve.mutateAsync();
              setMsg(
                `Processed ${r.resolved}. ${r.winners.length} winner(s).`,
              );
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Resolve failed.");
            }
          }}
          disabled={resolve.isPending}
          className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg"
        >
          {resolve.isPending ? "Resolving…" : "Resolve pending bids"}
        </button>
        <button
          onClick={async () => {
            setMsg(null);
            try {
              const r = await grant.mutateAsync();
              setMsg(`Credited ${r.members_updated} member(s).`);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Grant failed.");
            }
          }}
          disabled={grant.isPending}
          className="text-[12px] font-medium text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-white disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          {grant.isPending ? "Granting…" : "Grant weekly allowance"}
        </button>
      </div>
      {msg && (
        <p className="text-[11.5px] text-emerald-300 mt-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-2.5 py-1.5">
          {msg}
        </p>
      )}
    </div>
  );
}

function SubmitBidCard({
  leagueId,
  seasonId,
  seasonStartsAt,
  seasonEndsAt,
  userId,
  myBudget,
}: {
  leagueId: number;
  seasonId: number;
  seasonStartsAt: string;
  seasonEndsAt: string;
  userId: string | undefined;
  myBudget: number;
}) {
  const submit = useSubmitWaiverBid(leagueId, seasonId);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pick, setPick] = useState<
    { content_type: "movie" | "tv"; content_id: number; title: string } | null
  >(null);
  const [bidAmount, setBidAmount] = useState(1);
  const [dropAssetId, setDropAssetId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [browseType, setBrowseType] = useState<"movie" | "tv">("movie");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results, isFetching: searchFetching } = useEligibleAssetSearch(
    leagueId,
    seasonId,
    debounced,
  );
  const { data: suggestions, isLoading: suggestionsLoading } =
    useAssetSuggestions(leagueId, seasonId);
  const { data: myRoster } = useUserBreakdown(leagueId, seasonId, userId);
  const activeAssets = myRoster?.assets.filter((a) => !a.dropped_at) ?? [];

  const start = seasonStartsAt.slice(0, 10);
  const end = seasonEndsAt.slice(0, 10);
  const hasQuery = debounced.trim().length > 0;
  const filteredMovies = hasQuery
    ? results?.movies ?? []
    : suggestions?.movies ?? [];
  const filteredShows = hasQuery
    ? results?.shows ?? []
    : suggestions?.shows ?? [];
  const isFetching = hasQuery ? searchFetching : suggestionsLoading;

  async function go() {
    if (!pick) return;
    setError(null);
    setSuccess(null);
    try {
      await submit.mutateAsync({
        content_type: pick.content_type,
        content_id: pick.content_id,
        bid_amount: bidAmount,
        drop_asset_id: dropAssetId === "" ? null : Number(dropAssetId),
      });
      setSuccess(`Bid of $${bidAmount} submitted for ${pick.title}.`);
      setPick(null);
      setQuery("");
      setDebounced("");
      setBidAmount(1);
      setDropAssetId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit bid.");
    }
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
      <h2 className="text-lg font-semibold text-white">Submit a waiver bid</h2>
      <p className="text-[12.5px] text-neutral-400 mt-1">
        Bid on an asset releasing during the season window.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search movies + shows…"
        className="mt-4 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600"
      />

      {!pick && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
              {hasQuery ? "Search results" : "Popular available"}
            </p>
            <div className="inline-flex rounded-lg bg-neutral-950 border border-neutral-800 p-0.5">
              <button
                onClick={() => setBrowseType("movie")}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  browseType === "movie"
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Movies{" "}
                <span className="font-mono text-neutral-500">
                  ({filteredMovies.length})
                </span>
              </button>
              <button
                onClick={() => setBrowseType("tv")}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  browseType === "tv"
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Shows{" "}
                <span className="font-mono text-neutral-500">
                  ({filteredShows.length})
                </span>
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto flex flex-col gap-1">
          {browseType === "movie" && filteredMovies.slice(0, 10).map((m) => (
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
              <Poster path={m.poster_path} />
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
          {browseType === "tv" && filteredShows.slice(0, 10).map((s) => (
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
              <Poster path={s.poster_path} />
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
            ((browseType === "movie" && filteredMovies.length === 0) ||
              (browseType === "tv" && filteredShows.length === 0)) && (
              <p className="text-[12px] text-neutral-500 px-2 py-3">
                {hasQuery
                  ? `No ${browseType === "movie" ? "movies" : "shows"} matching "${debounced}" in the season window.`
                  : `No popular ${browseType === "movie" ? "movies" : "shows"} available right now.`}
              </p>
            )}
          {isFetching && (
            <p className="text-[12px] text-neutral-500 px-2 py-3">Searching…</p>
          )}
          </div>
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
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              Change
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-neutral-400 font-medium">
                Bid amount
              </span>
              <input
                type="number"
                min={1}
                value={bidAmount}
                onChange={(e) =>
                  setBidAmount(parseInt(e.target.value, 10) || 1)
                }
                className="mt-1 w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-2 text-sm text-white text-center font-mono outline-none focus:border-neutral-600"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-400 font-medium">
                Drop if I win? (optional)
              </span>
              <select
                value={dropAssetId}
                onChange={(e) =>
                  setDropAssetId(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className="mt-1 w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-2 text-sm text-white outline-none focus:border-neutral-600"
              >
                <option value="">Don't drop anything</option>
                {activeAssets.map((a) => (
                  <option key={a.asset_id} value={a.asset_id}>
                    {a.title ?? `${a.content_type} #${a.content_id}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            onClick={go}
            disabled={submit.isPending || bidAmount < 0}
            className="mt-3 text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
          >
            {submit.isPending ? "Submitting…" : `Submit $${bidAmount} bid`}
          </button>
        </div>
      )}

      {success && (
        <p className="text-[12px] text-emerald-300 mt-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
          {success}
        </p>
      )}
      {error && (
        <p className="text-[12px] text-red-400 mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

function BidRow({
  bid,
  leagueId,
}: {
  bid: FantasyWaiverBid;
  leagueId: number;
}) {
  const { data: media } = useMediaSummary(bid.content_type, bid.content_id);
  const cancel = useCancelWaiverBid(leagueId);
  const title =
    media?.title ?? `${bid.content_type} #${bid.content_id}`;
  const meta = {
    pending: { label: "PENDING", color: "text-amber-300 bg-amber-500/15 border border-amber-500/30" },
    won: { label: "WON", color: "text-emerald-300 bg-emerald-500/15 border border-emerald-500/30" },
    lost: { label: "LOST", color: "text-neutral-500 bg-neutral-800/50" },
    cancelled: { label: "CANCELLED", color: "text-neutral-500 bg-neutral-800/50" },
  }[bid.status];

  return (
    <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5">
      <Poster path={media?.poster_path ?? null} small />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-white truncate">{title}</p>
        <p className="text-[11px] font-mono text-neutral-500 uppercase mt-0.5">
          {bid.content_type === "movie" ? "MOV" : "TV"} · ${bid.bid_amount}
        </p>
      </div>
      <span
        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}
      >
        {meta.label}
      </span>
      {bid.status === "pending" && (
        <button
          onClick={() => cancel.mutate(bid.id)}
          disabled={cancel.isPending}
          className="text-[11px] text-neutral-500 hover:text-red-400 disabled:opacity-50 shrink-0"
        >
          Cancel
        </button>
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
      if (left > 0) {
        parts.push(`${left} ep${left === 1 ? "" : "s"} left`);
      } else {
        parts.push("season finished");
      }
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

function Poster({
  path,
  small = false,
}: {
  path: string | null | undefined;
  small?: boolean;
}) {
  const cls = small ? "w-9 h-12" : "w-10 h-14";
  if (!path) {
    return (
      <div className={`${cls} bg-neutral-900 border border-neutral-800 rounded shrink-0`} />
    );
  }
  return (
    <img
      src={`${BASE_IMAGE_URL}/w92${path}`}
      alt=""
      className={`${cls} object-cover rounded shrink-0`}
      loading="lazy"
    />
  );
}
