import { useMemo, useState } from "react";
import {
  useAllTrades,
  useMyTrades,
  useProposeTrade,
  useRespondToTrade,
  type FantasyTrade,
  type FantasyTradeLeg,
} from "../hooks/api/useTrades";
import {
  useUserBreakdown,
  type FantasyAssetBreakdown,
  type FantasyMember,
} from "../hooks/api/useFantasy";

export default function TradesTab({
  leagueId,
  seasonId,
  members,
  myId,
  isOwner,
}: {
  leagueId: number;
  seasonId: number;
  members: FantasyMember[];
  myId: string | undefined;
  isOwner: boolean;
}) {
  const [showPropose, setShowPropose] = useState(false);
  const { data: trades = [] } = useMyTrades(leagueId, seasonId);
  const { data: allTrades = [] } = useAllTrades(
    leagueId,
    seasonId,
    "pending",
    isOwner,
  );

  const pending = trades.filter((t) => t.status === "pending");
  const incoming = pending.filter((t) => t.recipient_id === myId);
  const outgoing = pending.filter((t) => t.proposer_id === myId);
  const resolved = trades.filter((t) => t.status !== "pending");

  // Trades the owner can veto but isn't a party to.
  const otherPending = isOwner
    ? allTrades.filter(
        (t) =>
          t.status === "pending" &&
          t.proposer_id !== myId &&
          t.recipient_id !== myId,
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-neutral-400">
          Propose a swap with another league member. Both sides see the full
          deal before accepting.
        </p>
        <button
          onClick={() => setShowPropose(true)}
          className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-xl shrink-0"
        >
          + Propose trade
        </button>
      </div>

      {incoming.length > 0 && (
        <Section title={`Incoming offers (${incoming.length})`}>
          {incoming.map((t) => (
            <TradeRow
              key={t.id}
              trade={t}
              leagueId={leagueId}
              seasonId={seasonId}
              myId={myId}
              isOwner={isOwner}
              members={members}
            />
          ))}
        </Section>
      )}

      {outgoing.length > 0 && (
        <Section title={`Sent offers (${outgoing.length})`}>
          {outgoing.map((t) => (
            <TradeRow
              key={t.id}
              trade={t}
              leagueId={leagueId}
              seasonId={seasonId}
              myId={myId}
              isOwner={isOwner}
              members={members}
            />
          ))}
        </Section>
      )}

      {otherPending.length > 0 && (
        <Section title={`Other league trades pending (${otherPending.length})`}>
          {otherPending.map((t) => (
            <TradeRow
              key={t.id}
              trade={t}
              leagueId={leagueId}
              seasonId={seasonId}
              myId={myId}
              isOwner={isOwner}
              members={members}
            />
          ))}
        </Section>
      )}

      {resolved.length > 0 && (
        <Section title="History">
          {resolved.slice(0, 20).map((t) => (
            <TradeRow
              key={t.id}
              trade={t}
              leagueId={leagueId}
              seasonId={seasonId}
              myId={myId}
              isOwner={isOwner}
              members={members}
            />
          ))}
        </Section>
      )}

      {trades.length === 0 && (
        <p className="text-[13px] text-neutral-500 bg-neutral-900/50 border border-neutral-800 rounded-2xl p-4">
          No trade activity yet this season.
        </p>
      )}

      {showPropose && myId && (
        <ProposeTradeModal
          leagueId={leagueId}
          seasonId={seasonId}
          myId={myId}
          members={members}
          onClose={() => setShowPropose(false)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
        {title}
      </p>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function TradeRow({
  trade,
  leagueId,
  seasonId,
  myId,
  isOwner,
  members,
}: {
  trade: FantasyTrade;
  leagueId: number;
  seasonId: number;
  myId: string | undefined;
  isOwner: boolean;
  members: FantasyMember[];
}) {
  const respond = useRespondToTrade(leagueId, seasonId);
  const memberLabel = (uid: string) => {
    const m = members.find((x) => x.user_id === uid);
    return m?.display_name || m?.user_display_name || (m?.username ? `@${m.username}` : uid);
  };

  const proposerLegs = trade.legs.filter((l) => l.direction === "proposer_sends");
  const recipientLegs = trade.legs.filter((l) => l.direction === "recipient_sends");

  const isIncoming = trade.recipient_id === myId && trade.status === "pending";
  const isOutgoing = trade.proposer_id === myId && trade.status === "pending";

  const statusMeta = {
    pending: { label: "PENDING", color: "text-amber-300 bg-amber-500/15 border border-amber-500/30" },
    accepted: { label: "ACCEPTED", color: "text-emerald-300 bg-emerald-500/15 border border-emerald-500/30" },
    declined: { label: "DECLINED", color: "text-neutral-500 bg-neutral-800/50" },
    cancelled: { label: "CANCELLED", color: "text-neutral-500 bg-neutral-800/50" },
    vetoed: { label: "VETOED", color: "text-red-300 bg-red-500/15 border border-red-500/30" },
  }[trade.status];

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[13px] text-neutral-300">
          <span className="font-semibold text-white">
            {memberLabel(trade.proposer_id)}
          </span>{" "}
          → <span className="font-semibold text-white">{memberLabel(trade.recipient_id)}</span>
        </p>
        <span
          className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${statusMeta.color}`}
        >
          {statusMeta.label}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TradeSide
          title={memberLabel(trade.proposer_id)}
          legs={proposerLegs}
        />
        <TradeSide
          title={memberLabel(trade.recipient_id)}
          legs={recipientLegs}
        />
      </div>

      {trade.message && (
        <p className="text-[12px] text-neutral-400 mt-3 bg-neutral-950 rounded-lg px-3 py-2 italic">
          "{trade.message}"
        </p>
      )}

      {(isIncoming || isOutgoing || (isOwner && trade.status === "pending")) && (
        <div className="flex justify-end gap-2 mt-3">
          {isIncoming && (
            <>
              <button
                onClick={() =>
                  respond.mutate({ tradeId: trade.id, action: "accept" })
                }
                disabled={respond.isPending}
                className="text-[13px] font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg"
              >
                Accept
              </button>
              <button
                onClick={() =>
                  respond.mutate({ tradeId: trade.id, action: "decline" })
                }
                disabled={respond.isPending}
                className="text-[13px] font-medium text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-white disabled:opacity-50 px-4 py-1.5 rounded-lg"
              >
                Decline
              </button>
            </>
          )}
          {isOutgoing && (
            <button
              onClick={() =>
                respond.mutate({ tradeId: trade.id, action: "decline" })
              }
              disabled={respond.isPending}
              className="text-[12px] font-medium text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-white disabled:opacity-50 px-3 py-1.5 rounded-lg"
            >
              Cancel offer
            </button>
          )}
          {isOwner && !isIncoming && !isOutgoing && trade.status === "pending" && (
            <button
              onClick={() => {
                if (confirm("Veto this trade as commissioner?"))
                  respond.mutate({ tradeId: trade.id, action: "veto" });
              }}
              disabled={respond.isPending}
              className="text-[12px] font-medium text-red-400 border border-red-500/30 hover:border-red-500/60 disabled:opacity-50 px-3 py-1.5 rounded-lg"
            >
              Veto (commissioner)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TradeSide({
  title,
  legs,
}: {
  title: string;
  legs: FantasyTradeLeg[];
}) {
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
      <p className="text-[11px] font-mono text-neutral-500 uppercase mb-1.5">
        {title} sends
      </p>
      {legs.length === 0 ? (
        <p className="text-[12px] text-neutral-500">Nothing</p>
      ) : (
        <ul className="text-[12.5px] text-neutral-300 space-y-1">
          {legs.map((l) => (
            <li key={l.id}>
              {l.asset_id != null
                ? `Asset #${l.asset_id}`
                : `$${l.budget_amount}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposeTradeModal({
  leagueId,
  seasonId,
  myId,
  members,
  onClose,
}: {
  leagueId: number;
  seasonId: number;
  myId: string;
  members: FantasyMember[];
  onClose: () => void;
}) {
  const otherMembers = members.filter((m) => m.user_id !== myId);
  const [recipientId, setRecipientId] = useState(
    otherMembers[0]?.user_id ?? "",
  );
  const propose = useProposeTrade(leagueId, seasonId);

  const myMember = members.find((m) => m.user_id === myId);
  const recipientMember = members.find((m) => m.user_id === recipientId);

  const { data: myBreakdown } = useUserBreakdown(leagueId, seasonId, myId);
  const { data: theirBreakdown } = useUserBreakdown(
    leagueId,
    seasonId,
    recipientId || undefined,
  );

  const myAssets = useMemo(
    () => (myBreakdown?.assets ?? []).filter((a) => !a.dropped_at),
    [myBreakdown],
  );
  const theirAssets = useMemo(
    () => (theirBreakdown?.assets ?? []).filter((a) => !a.dropped_at),
    [theirBreakdown],
  );

  const [myPicks, setMyPicks] = useState<Set<number>>(new Set());
  const [theirPicks, setTheirPicks] = useState<Set<number>>(new Set());
  const [myCash, setMyCash] = useState(0);
  const [theirCash, setTheirCash] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  function togglePick(set: Set<number>, id: number, setter: typeof setMyPicks) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function submit() {
    setError(null);
    if (!recipientId) {
      setError("Pick a recipient.");
      return;
    }
    try {
      await propose.mutateAsync({
        recipient_id: recipientId,
        proposer_assets: Array.from(myPicks),
        recipient_assets: Array.from(theirPicks),
        proposer_cash: myCash,
        recipient_cash: theirCash,
        message: message.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not propose trade.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-semibold text-white mb-1">
          Propose a trade
        </h3>
        <p className="text-[13px] text-neutral-400 mb-4">
          Pick assets and (optionally) cash from each side. The recipient sees
          the offer and chooses to accept or decline.
        </p>

        <label className="block mb-4">
          <span className="text-[12px] text-neutral-400 font-medium">
            Recipient
          </span>
          <select
            value={recipientId}
            onChange={(e) => {
              setRecipientId(e.target.value);
              setTheirPicks(new Set());
              setTheirCash(0);
            }}
            className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600"
          >
            {otherMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name ||
                  m.user_display_name ||
                  (m.username ? `@${m.username}` : m.user_id)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-y-auto -mx-1 px-1 min-h-0">
          <AssetPickerSide
            title={`You send${myMember ? ` (${myMember.budget_remaining} budget)` : ""}`}
            assets={myAssets}
            picks={myPicks}
            onToggle={(id) => togglePick(myPicks, id, setMyPicks)}
            cash={myCash}
            setCash={setMyCash}
            maxCash={myMember?.budget_remaining ?? 0}
          />
          <AssetPickerSide
            title={`They send${recipientMember ? ` (${recipientMember.budget_remaining} budget)` : ""}`}
            assets={theirAssets}
            picks={theirPicks}
            onToggle={(id) => togglePick(theirPicks, id, setTheirPicks)}
            cash={theirCash}
            setCash={setTheirCash}
            maxCash={recipientMember?.budget_remaining ?? 0}
          />
        </div>

        <label className="block mt-4">
          <span className="text-[12px] text-neutral-400 font-medium">
            Note (optional)
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Sweeten the offer with a quick pitch…"
            className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none resize-none focus:border-neutral-600"
          />
        </label>

        {error && (
          <p className="text-[12px] text-red-400 mt-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="text-sm font-medium text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-4 py-2 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={
              propose.isPending ||
              !recipientId ||
              (myPicks.size === 0 &&
                theirPicks.size === 0 &&
                myCash === 0 &&
                theirCash === 0)
            }
            className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl"
          >
            {propose.isPending ? "Sending…" : "Send proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssetPickerSide({
  title,
  assets,
  picks,
  onToggle,
  cash,
  setCash,
  maxCash,
}: {
  title: string;
  assets: FantasyAssetBreakdown[];
  picks: Set<number>;
  onToggle: (id: number) => void;
  cash: number;
  setCash: (n: number) => void;
  maxCash: number;
}) {
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3 flex flex-col min-h-0">
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
        {title}
      </p>
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
        {assets.length === 0 ? (
          <p className="text-[12px] text-neutral-500 italic px-2 py-1">
            No assets to trade.
          </p>
        ) : (
          assets.map((a) => {
            const picked = picks.has(a.asset_id);
            return (
              <button
                key={a.asset_id}
                onClick={() => onToggle(a.asset_id)}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left border transition-colors ${
                  picked
                    ? "bg-primary-600/10 border-primary-500/40"
                    : "border-transparent hover:border-neutral-700"
                }`}
              >
                <span className="text-[12.5px] text-white truncate">
                  {a.title ?? `${a.content_type} #${a.content_id}`}
                </span>
                <span className="text-[10.5px] font-mono text-neutral-500 shrink-0">
                  {a.total_points.toFixed(0)}p · ${a.auction_price}
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-neutral-800">
        <label className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400">Cash:</span>
          <input
            type="number"
            min={0}
            max={maxCash}
            value={cash}
            onChange={(e) => setCash(parseInt(e.target.value, 10) || 0)}
            className="w-20 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[12px] text-white font-mono text-center outline-none focus:border-neutral-600"
          />
          <span className="text-[10px] text-neutral-500">/ ${maxCash}</span>
        </label>
      </div>
    </div>
  );
}
