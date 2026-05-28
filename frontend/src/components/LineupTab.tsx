import { useState } from "react";
import { BASE_IMAGE_URL } from "../constants";
import {
  useClearBoost,
  useMyBoosts,
  useSetBoost,
} from "../hooks/api/useLineupBoosts";
import {
  useUserBreakdown,
  type FantasyAssetBreakdown,
} from "../hooks/api/useFantasy";

export default function LineupTab({
  leagueId,
  seasonId,
  userId,
  boostSlotsPerWeek,
  seasonStartsAt,
}: {
  leagueId: number;
  seasonId: number;
  userId: string | undefined;
  boostSlotsPerWeek: number;
  seasonStartsAt: string;
}) {
  const currentWeek = computeCurrentWeek(seasonStartsAt);
  const [week, setWeek] = useState(Math.max(1, currentWeek));

  const { data: roster } = useUserBreakdown(leagueId, seasonId, userId);
  const { data: boosts = [] } = useMyBoosts(leagueId, seasonId, week);
  const setBoost = useSetBoost(leagueId, seasonId);
  const clearBoost = useClearBoost(leagueId, seasonId);

  if (!userId)
    return <p className="text-neutral-500 text-sm">Sign in to set lineups.</p>;

  const active = roster?.assets.filter((a) => !a.dropped_at) ?? [];
  const boostedAssetIds = new Set(boosts.map((b) => b.asset_id));
  const boostsUsed = boosts.length;
  const slotsRemaining = boostSlotsPerWeek - boostsUsed;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-1">
            Weekly lineup
          </p>
          <h2 className="text-lg font-semibold text-white">
            Boost up to {boostSlotsPerWeek} {boostSlotsPerWeek === 1 ? "asset" : "assets"} per
            week
          </h2>
          <p className="text-[12.5px] text-neutral-400 mt-0.5">
            Boosted assets score at <strong>1.5x</strong> that week.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeek((w) => Math.max(1, w - 1))}
            disabled={week <= 1}
            className="text-neutral-300 border border-neutral-700 hover:border-neutral-600 disabled:opacity-30 w-8 h-8 rounded-lg"
            aria-label="Previous week"
          >
            ←
          </button>
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1 min-w-[100px] text-center">
            <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
              Week
            </p>
            <p className="text-[18px] font-semibold text-white tabular-nums">
              {week}
            </p>
          </div>
          <button
            onClick={() => setWeek((w) => w + 1)}
            className="text-neutral-300 border border-neutral-700 hover:border-neutral-600 w-8 h-8 rounded-lg"
            aria-label="Next week"
          >
            →
          </button>
        </div>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-neutral-400">
          <span className="text-white font-semibold tabular-nums">
            {boostsUsed}
          </span>
          {" / "}
          {boostSlotsPerWeek} boost slots used this week
        </p>
        {currentWeek > 0 && week !== currentWeek && (
          <button
            onClick={() => setWeek(currentWeek)}
            className="text-[11px] text-primary-400 hover:text-primary-300"
          >
            Jump to current week →
          </button>
        )}
      </div>

      {active.length === 0 ? (
        <p className="text-[13px] text-neutral-500 bg-neutral-900/50 border border-neutral-800 rounded-2xl p-4">
          Draft assets first to set lineups.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {active.map((a) => {
            const isBoosted = boostedAssetIds.has(a.asset_id);
            const boost = boosts.find((b) => b.asset_id === a.asset_id);
            return (
              <BoostableAssetCard
                key={a.asset_id}
                asset={a}
                isBoosted={isBoosted}
                canBoost={isBoosted || slotsRemaining > 0}
                pending={setBoost.isPending || clearBoost.isPending}
                onToggle={() => {
                  if (isBoosted && boost) {
                    clearBoost.mutate(boost.id);
                  } else {
                    setBoost.mutate({
                      asset_id: a.asset_id,
                      week_number: week,
                    });
                  }
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function BoostableAssetCard({
  asset,
  isBoosted,
  canBoost,
  pending,
  onToggle,
}: {
  asset: FantasyAssetBreakdown;
  isBoosted: boolean;
  canBoost: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`relative bg-neutral-900 border rounded-xl overflow-hidden ${
        isBoosted ? "border-amber-500/60" : "border-neutral-800"
      }`}
    >
      <div className="aspect-[2/3] bg-neutral-950 relative">
        {asset.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${asset.poster_path}`}
            alt={asset.title ?? "Asset"}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-700 text-[11px]">
            No poster
          </div>
        )}
        {isBoosted && (
          <span className="absolute top-1.5 right-1.5 text-[10px] font-mono font-bold tracking-wider text-amber-300 bg-amber-500/20 border border-amber-500/40 backdrop-blur px-1.5 py-0.5 rounded">
            ★ 1.5×
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-[12.5px] font-medium text-white line-clamp-1">
          {asset.title ?? `${asset.content_type} #${asset.content_id}`}
        </p>
        <button
          onClick={onToggle}
          disabled={pending || (!isBoosted && !canBoost)}
          className={`mt-2 w-full text-[11.5px] font-semibold rounded-md py-1.5 disabled:opacity-50 ${
            isBoosted
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25"
              : "bg-neutral-950 text-neutral-300 border border-neutral-700 hover:border-neutral-600"
          }`}
          title={!isBoosted && !canBoost ? "Boost slots full" : ""}
        >
          {isBoosted ? "Remove boost" : "Boost this week"}
        </button>
      </div>
    </div>
  );
}

function computeCurrentWeek(seasonStartsAt: string): number {
  const start = new Date(seasonStartsAt);
  const now = new Date();
  if (now < start) return 0;
  const daysIn = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  return Math.floor(daysIn / 7) + 1;
}
