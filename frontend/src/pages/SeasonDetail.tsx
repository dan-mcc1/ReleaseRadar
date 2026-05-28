import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import {
  useLeague,
  useLeagueMembers,
  useLeagueSeasons,
  useSeasonStandings,
  useUserBreakdown,
  type FantasyAssetBreakdown,
  type FantasySeason,
  type FantasyStandingsRow,
  type FantasyUserBreakdown,
} from "../hooks/api/useFantasy";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser } from "../hooks/useAuthUser";
import WaiversTab from "../components/WaiversTab";
import TradesTab from "../components/TradesTab";
import { useMediaSummary } from "../hooks/api/useAuctionDraft";
import { useSetAssetSlot } from "../hooks/api/useRoster";
import {
  useClearBoost,
  useMyBoosts,
  useSetBoost,
} from "../hooks/api/useLineupBoosts";

type Tab = "standings" | "my-roster" | "all-rosters" | "waivers" | "trades";

const TAB_VALUES: Tab[] = [
  "standings",
  "my-roster",
  "all-rosters",
  "waivers",
  "trades",
];

export default function SeasonDetail() {
  const { leagueId, seasonId } = useParams<{
    leagueId: string;
    seasonId: string;
  }>();
  const lid = leagueId ? parseInt(leagueId, 10) : undefined;
  const sid = seasonId ? parseInt(seasonId, 10) : undefined;

  const me = useAuthUser();
  const { data: league } = useLeague(lid);
  const { data: seasons = [] } = useLeagueSeasons(lid);
  const { data: members = [] } = useLeagueMembers(lid);
  const myMember = members.find((m) => m.user_id === me?.uid);
  const myBudget = myMember?.budget_remaining ?? 0;
  const season = seasons.find((s) => s.id === sid);

  usePageTitle(season?.name ?? "Season");

  // Tab selection lives in the URL (?tab=...) so deep links + browser back
  // work, and refreshing keeps you on the tab you were viewing.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab = tabParam && TAB_VALUES.includes(tabParam) ? tabParam : "standings";
  const setTab = (next: Tab) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "standings") {
          params.delete("tab");
        } else {
          params.set("tab", next);
        }
        return params;
      },
      { replace: false },
    );
  };

  if (!lid || !sid) {
    return (
      <div className="px-6 lg:px-10 pt-8">
        <p className="text-neutral-300">Season not found.</p>
      </div>
    );
  }

  if (!league || !season) {
    return (
      <p className="px-6 lg:px-10 pt-8 text-neutral-500 text-sm">Loading…</p>
    );
  }

  return (
    <div className="pb-24">
      <div className="px-6 lg:px-10 pt-8">
        <Link
          to={`/fantasy/${lid}`}
          className="text-[12px] text-neutral-500 hover:text-neutral-300"
        >
          ← {league.name}
        </Link>

        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
              {season.name}
            </h1>
            <p className="text-[12px] text-neutral-500 mt-2">
              {new Date(season.starts_at).toLocaleDateString()} →{" "}
              {new Date(season.ends_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {myMember && (
              <div className="inline-flex items-center gap-2 bg-primary-600/15 border border-primary-500/30 rounded-lg px-3 py-1.5">
                <span className="font-mono text-[10px] tracking-[0.14em] text-primary-300 uppercase">
                  Budget
                </span>
                <span className="text-[14px] font-bold text-white tabular-nums">
                  ${myBudget}
                </span>
              </div>
            )}
            <SeasonStatusBadge season={season} />
            {(season.status === "draft" || season.status === "upcoming") && (
              <Link
                to={`/fantasy/${lid}/seasons/${sid}/draft`}
                className="text-[12px] font-semibold bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg"
              >
                {season.status === "draft" ? "Go to draft room →" : "Start draft →"}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 lg:px-10 mt-6 border-b border-neutral-800 overflow-x-auto">
        <div className="flex gap-1">
          <TabButton active={tab === "standings"} onClick={() => setTab("standings")}>
            Standings
          </TabButton>
          <TabButton active={tab === "my-roster"} onClick={() => setTab("my-roster")}>
            My Roster
          </TabButton>
          <TabButton active={tab === "all-rosters"} onClick={() => setTab("all-rosters")}>
            All Rosters
          </TabButton>
          <TabButton active={tab === "waivers"} onClick={() => setTab("waivers")}>
            Waivers
          </TabButton>
          <TabButton active={tab === "trades"} onClick={() => setTab("trades")}>
            Trades
          </TabButton>
        </div>
      </div>

      <div className="px-6 lg:px-10 mt-6">
        {tab === "standings" && <StandingsTab leagueId={lid} seasonId={sid} />}
        {tab === "my-roster" && (
          <MyRosterTab
            leagueId={lid}
            seasonId={sid}
            userId={me?.uid}
            movieSlots={league.roster_movie_slots}
            tvSlots={league.roster_tv_slots}
            flexSlots={league.roster_flex_slots}
            benchSlots={league.bench_slots}
            boostSlotsPerWeek={league.boost_slots}
            seasonStartsAt={season.starts_at}
          />
        )}
        {tab === "all-rosters" && (
          <AllRostersTab
            leagueId={lid}
            seasonId={sid}
            members={members.map((m) => ({
              user_id: m.user_id,
              label:
                m.display_name ||
                m.user_display_name ||
                (m.username ? `@${m.username}` : m.user_id),
            }))}
            movieSlots={league.roster_movie_slots}
            tvSlots={league.roster_tv_slots}
            flexSlots={league.roster_flex_slots}
            benchSlots={league.bench_slots}
            myId={me?.uid}
          />
        )}
        {tab === "waivers" && (
          <WaiversTab
            leagueId={lid}
            seasonId={sid}
            seasonStartsAt={season.starts_at}
            seasonEndsAt={season.ends_at}
            isOwner={league.viewer_role === "owner"}
          />
        )}
        {tab === "trades" && (
          <TradesTab
            leagueId={lid}
            seasonId={sid}
            members={members}
            myId={me?.uid}
            isOwner={league.viewer_role === "owner"}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary-500 text-white"
          : "border-transparent text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function SeasonStatusBadge({ season }: { season: FantasySeason }) {
  const meta = {
    upcoming: { label: "UPCOMING", color: "text-neutral-300 bg-neutral-800" },
    draft: {
      label: "DRAFT IN PROGRESS",
      color: "text-amber-300 bg-amber-500/15 border border-amber-500/30",
    },
    active: {
      label: "ACTIVE",
      color: "text-emerald-300 bg-emerald-500/15 border border-emerald-500/30",
    },
    complete: { label: "COMPLETE", color: "text-neutral-500 bg-neutral-800/50" },
  }[season.status];
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

// ─── Standings tab ──────────────────────────────────────────────────────────

function StandingsTab({
  leagueId,
  seasonId,
}: {
  leagueId: number;
  seasonId: number;
}) {
  const { data: standings = [], isLoading } = useSeasonStandings(
    leagueId,
    seasonId,
  );

  if (isLoading) return <p className="text-neutral-500 text-sm">Loading…</p>;
  if (standings.length === 0) {
    return (
      <p className="text-[13px] text-neutral-500 bg-neutral-900/50 border border-neutral-800 rounded-2xl p-4">
        No standings yet. They'll populate once the season is drafted and the
        scoring runner has produced its first weekly snapshot.
      </p>
    );
  }

  return (
    <div className="overflow-hidden border border-neutral-800 rounded-2xl bg-neutral-900/50">
      <table className="w-full">
        <thead>
          <tr className="text-left border-b border-neutral-800">
            <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-neutral-500 w-12">
              #
            </th>
            <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
              Player
            </th>
            <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-neutral-500 text-right">
              Assets
            </th>
            <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-neutral-500 text-right">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <StandingsRow key={row.user_id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandingsRow({ row }: { row: FantasyStandingsRow }) {
  const label =
    row.league_display_name ||
    row.user_display_name ||
    (row.username ? `@${row.username}` : row.user_id);
  return (
    <tr className="border-b border-neutral-800/50 last:border-b-0">
      <td className="px-4 py-3 text-[14px] font-mono text-neutral-300">
        {row.rank}
      </td>
      <td className="px-4 py-3">
        <p className="text-[14px] font-medium text-white">{label}</p>
        {row.role !== "member" && (
          <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mt-0.5">
            {row.role}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-[13px] text-neutral-400 text-right tabular-nums">
        {row.asset_count}
      </td>
      <td className="px-4 py-3 text-[15px] font-semibold text-white text-right tabular-nums">
        {row.total_points.toFixed(1)}
      </td>
    </tr>
  );
}

// ─── My Roster tab ──────────────────────────────────────────────────────────

function MyRosterTab({
  leagueId,
  seasonId,
  userId,
  movieSlots,
  tvSlots,
  flexSlots,
  benchSlots,
  boostSlotsPerWeek,
  seasonStartsAt,
}: {
  leagueId: number;
  seasonId: number;
  userId: string | undefined;
  movieSlots: number;
  tvSlots: number;
  flexSlots: number;
  benchSlots: number;
  boostSlotsPerWeek: number;
  seasonStartsAt: string;
}) {
  const { data, isLoading } = useUserBreakdown(leagueId, seasonId, userId);

  if (!userId) return null;
  if (isLoading) return <p className="text-neutral-500 text-sm">Loading…</p>;

  return (
    <RosterView
      leagueId={leagueId}
      seasonId={seasonId}
      breakdown={data}
      movieSlots={movieSlots}
      tvSlots={tvSlots}
      flexSlots={flexSlots}
      benchSlots={benchSlots}
      boostSlotsPerWeek={boostSlotsPerWeek}
      seasonStartsAt={seasonStartsAt}
      ownerView={true}
    />
  );
}

const SLOT_META: Record<
  "movie" | "tv" | "flex" | "bench",
  { label: string; color: string }
> = {
  movie: { label: "MOV", color: "text-sky-300 bg-sky-500/15 border-sky-500/20" },
  tv: { label: "TV", color: "text-purple-300 bg-purple-500/15 border-purple-500/20" },
  flex: { label: "FLEX", color: "text-amber-300 bg-amber-500/15 border-amber-500/20" },
  bench: { label: "BENCH", color: "text-neutral-400 bg-neutral-800/50 border-neutral-700" },
};

type SlotType = "movie" | "tv" | "flex" | "bench";

function RosterView({
  leagueId,
  seasonId,
  breakdown,
  movieSlots,
  tvSlots,
  flexSlots,
  benchSlots,
  boostSlotsPerWeek,
  seasonStartsAt,
  ownerView,
}: {
  leagueId: number;
  seasonId: number;
  breakdown: FantasyUserBreakdown | undefined;
  movieSlots: number;
  tvSlots: number;
  flexSlots: number;
  benchSlots: number;
  boostSlotsPerWeek?: number;
  seasonStartsAt?: string;
  ownerView: boolean;
}) {
  const active = (breakdown?.assets ?? []).filter((a) => !a.dropped_at);
  const dropped = (breakdown?.assets ?? []).filter((a) => a.dropped_at);
  const totalPoints = breakdown?.total_points ?? 0;

  const [editing, setEditing] = useState(false);
  const currentWeek = seasonStartsAt
    ? Math.max(1, computeCurrentWeek(seasonStartsAt))
    : 1;

  const { data: boosts = [] } = useMyBoosts(
    ownerView ? leagueId : undefined,
    ownerView ? seasonId : undefined,
    currentWeek,
  );
  const boostedAssetIds = new Set(boosts.map((b) => b.asset_id));
  const boostsUsed = boosts.length;
  const boostsRemaining = (boostSlotsPerWeek ?? 0) - boostsUsed;

  const movieAssets = active.filter((a) => a.slot_type === "movie");
  const tvAssets = active.filter((a) => a.slot_type === "tv");
  const flexAssets = active.filter((a) => a.slot_type === "flex");
  const benchAssets = active.filter((a) => a.slot_type === "bench");

  // Build rows in slot order, padding with empty placeholders up to each
  // section's configured slot count.
  type Row =
    | { kind: "asset"; slot: SlotType; asset: FantasyAssetBreakdown }
    | { kind: "empty"; slot: SlotType };
  const rows: Row[] = [];
  for (const a of movieAssets) rows.push({ kind: "asset", slot: "movie", asset: a });
  for (let i = movieAssets.length; i < movieSlots; i++)
    rows.push({ kind: "empty", slot: "movie" });
  for (const a of tvAssets) rows.push({ kind: "asset", slot: "tv", asset: a });
  for (let i = tvAssets.length; i < tvSlots; i++)
    rows.push({ kind: "empty", slot: "tv" });
  for (const a of flexAssets) rows.push({ kind: "asset", slot: "flex", asset: a });
  for (let i = flexAssets.length; i < flexSlots; i++)
    rows.push({ kind: "empty", slot: "flex" });
  for (const a of benchAssets) rows.push({ kind: "asset", slot: "bench", asset: a });
  for (let i = benchAssets.length; i < benchSlots; i++)
    rows.push({ kind: "empty", slot: "bench" });

  // Compute the open slots map — used to determine which destinations a given
  // asset can move to in edit mode.
  const openSlots: Record<SlotType, number> = {
    movie: movieSlots - movieAssets.length,
    tv: tvSlots - tvAssets.length,
    flex: flexSlots - flexAssets.length,
    bench: benchSlots - benchAssets.length,
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-4 flex-wrap">
        <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
          Roster ({active.length}/{movieSlots + tvSlots + flexSlots + benchSlots})
        </p>
        <div className="flex items-center gap-3">
          <p className="text-[14px] text-neutral-300">
            Total{" "}
            <span className="text-white font-semibold tabular-nums">
              {totalPoints.toFixed(1)}
            </span>{" "}
            pts
          </p>
          {ownerView && (
            <button
              onClick={() => setEditing((v) => !v)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                editing
                  ? "bg-primary-600 hover:bg-primary-500 text-white"
                  : "border border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:text-white"
              }`}
            >
              {editing ? "Done" : "Edit lineup"}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mb-4 bg-neutral-900/50 border border-neutral-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12.5px] text-neutral-400">
            Move assets to/from the bench. Boosts on starters give{" "}
            <strong className="text-white">1.5×</strong> scoring this week.
          </p>
          <p className="text-[12px] font-mono text-neutral-400 tabular-nums">
            Week {currentWeek} · {boostsUsed}/{boostSlotsPerWeek ?? 0} boosts used
          </p>
        </div>
      )}

      <div className="overflow-hidden border border-neutral-800 rounded-2xl bg-neutral-900/50">
        <div className="hidden sm:grid grid-cols-[80px_56px_1fr_120px_72px_140px] gap-3 px-4 py-2.5 border-b border-neutral-800 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
          <span>Slot</span>
          <span></span>
          <span>Title</span>
          <span>Release</span>
          <span className="text-right">Pts</span>
          <span className="text-right">{editing ? "Actions" : ""}</span>
        </div>
        <div className="divide-y divide-neutral-800/60">
          {rows.map((r, i) =>
            r.kind === "asset" ? (
              <RosterRow
                key={r.asset.asset_id}
                asset={r.asset}
                leagueId={leagueId}
                seasonId={seasonId}
                editing={editing}
                openSlots={openSlots}
                isBoosted={boostedAssetIds.has(r.asset.asset_id)}
                boost={boosts.find((b) => b.asset_id === r.asset.asset_id)}
                boostsRemaining={boostsRemaining}
                currentWeek={currentWeek}
              />
            ) : (
              <EmptyRosterRow
                key={`empty-${r.slot}-${i}`}
                slot={r.slot}
                editing={editing}
              />
            ),
          )}
        </div>
      </div>

      {dropped.length > 0 && (
        <div className="mt-8">
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
            Dropped ({dropped.length})
          </p>
          <div className="overflow-hidden border border-neutral-800 rounded-2xl bg-neutral-900/50 opacity-60">
            <div className="divide-y divide-neutral-800/60">
              {dropped.map((a) => (
                <RosterRow
                  key={a.asset_id}
                  asset={a}
                  leagueId={leagueId}
                  seasonId={seasonId}
                  editing={false}
                  openSlots={openSlots}
                  isBoosted={false}
                  boost={undefined}
                  boostsRemaining={0}
                  currentWeek={currentWeek}
                  muted
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RosterRow({
  asset,
  leagueId,
  seasonId,
  editing,
  openSlots,
  isBoosted,
  boost,
  boostsRemaining,
  currentWeek,
  muted = false,
}: {
  asset: FantasyAssetBreakdown;
  leagueId: number;
  seasonId: number;
  editing: boolean;
  openSlots: Record<SlotType, number>;
  isBoosted: boolean;
  boost: { id: number } | undefined;
  boostsRemaining: number;
  currentWeek: number;
  muted?: boolean;
}) {
  const href =
    asset.content_type === "movie"
      ? `/movie/${asset.content_id}`
      : `/show/${asset.content_id}`;
  const meta = SLOT_META[asset.slot_type];
  const { data: media } = useMediaSummary(asset.content_type, asset.content_id);
  const releaseDate = media?.release_date || media?.first_air_date || null;
  const formattedDate = releaseDate ? formatReleaseDate(releaseDate) : null;

  const setSlot = useSetAssetSlot(leagueId, seasonId);
  const setBoost = useSetBoost(leagueId, seasonId);
  const clearBoost = useClearBoost(leagueId, seasonId);

  const onBench = asset.slot_type === "bench";

  // Where can this asset move to? Movie content → movie or flex or bench. TV
  // → tv or flex or bench. Only show destinations with open slots (excluding
  // current).
  const movableTargets: SlotType[] = [];
  const candidates: SlotType[] = asset.content_type === "movie"
    ? ["movie", "flex", "bench"]
    : ["tv", "flex", "bench"];
  for (const t of candidates) {
    if (t === asset.slot_type) continue;
    if (openSlots[t] > 0) movableTargets.push(t);
  }

  const RowInner = (
    <div className="grid grid-cols-[80px_56px_1fr_auto] sm:grid-cols-[80px_56px_1fr_120px_72px_140px] items-center gap-3">
      <span
        className={`inline-flex items-center justify-center text-[10px] font-mono font-bold tracking-wider px-2 py-1 rounded border ${meta.color}`}
      >
        {meta.label}
        {isBoosted && <span className="ml-1 text-amber-300">★</span>}
      </span>
      {asset.poster_path ? (
        <img
          src={`${BASE_IMAGE_URL}/w92${asset.poster_path}`}
          alt={asset.title ?? ""}
          className="w-12 h-[72px] object-cover rounded shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-12 h-[72px] bg-neutral-950 border border-neutral-800 rounded shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-white line-clamp-2 leading-tight">
          {asset.title ?? `${asset.content_type} #${asset.content_id}`}
        </p>
        <p className="text-[11px] font-mono text-neutral-500 mt-1">
          ${asset.auction_price}
          {asset.dropped_at && " · dropped"}
        </p>
        <p className="text-[11px] text-neutral-400 mt-0.5 sm:hidden">
          {formattedDate ?? "—"}
        </p>
      </div>
      <p className="hidden sm:block text-[12px] text-neutral-400 tabular-nums">
        {formattedDate ?? "—"}
      </p>
      <p
        className={`text-right text-[15px] font-semibold tabular-nums ${
          onBench ? "text-neutral-500" : "text-white"
        }`}
      >
        {asset.total_points.toFixed(1)}
      </p>
      {editing ? (
        <div className="flex items-center justify-end gap-1.5 flex-wrap">
          {!onBench && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (boost) {
                  clearBoost.mutate(boost.id);
                } else if (boostsRemaining > 0) {
                  setBoost.mutate({
                    asset_id: asset.asset_id,
                    week_number: currentWeek,
                  });
                }
              }}
              disabled={
                setBoost.isPending ||
                clearBoost.isPending ||
                (!isBoosted && boostsRemaining <= 0)
              }
              className={`text-[11px] font-semibold rounded px-2 py-1 transition-colors disabled:opacity-40 ${
                isBoosted
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "border border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:text-white"
              }`}
              title={
                isBoosted
                  ? "Remove boost"
                  : boostsRemaining <= 0
                    ? "No boost slots left this week"
                    : "Boost (1.5x this week)"
              }
            >
              {isBoosted ? "★ Boosted" : "★ Boost"}
            </button>
          )}
          {movableTargets.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                e.preventDefault();
                const target = e.target.value as SlotType;
                if (target) {
                  setSlot.mutate({ assetId: asset.asset_id, slotType: target });
                }
              }}
              onClick={(e) => e.stopPropagation()}
              disabled={setSlot.isPending}
              className="text-[11px] font-medium bg-neutral-900 border border-neutral-700 hover:border-neutral-600 text-neutral-300 rounded px-1.5 py-1 outline-none focus:border-neutral-500 disabled:opacity-50"
            >
              <option value="">Move to…</option>
              {movableTargets.map((t) => (
                <option key={t} value={t}>
                  {t === "bench" ? "Bench" : SLOT_META[t].label}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <span className="hidden sm:block" />
      )}
    </div>
  );

  if (editing) {
    return (
      <div
        className={`px-4 py-3 ${muted ? "opacity-60" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {RowInner}
      </div>
    );
  }
  return (
    <Link
      to={href}
      className={`block px-4 py-3 hover:bg-neutral-900 transition-colors ${muted ? "opacity-60" : ""}`}
    >
      {RowInner}
    </Link>
  );
}

function EmptyRosterRow({
  slot,
  editing,
}: {
  slot: SlotType;
  editing: boolean;
}) {
  const meta = SLOT_META[slot];
  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[80px_56px_1fr_auto] sm:grid-cols-[80px_56px_1fr_120px_72px_140px] items-center gap-3">
        <span
          className={`inline-flex items-center justify-center text-[10px] font-mono font-bold tracking-wider px-2 py-1 rounded border ${meta.color} opacity-50`}
        >
          {meta.label}
        </span>
        <div className="w-12 h-[72px] bg-neutral-950 border border-dashed border-neutral-800 rounded shrink-0" />
        <p className="text-[13px] text-neutral-600 italic">Empty slot</p>
        <p className="hidden sm:block text-[12px] text-neutral-600">—</p>
        <p className="text-right text-[14px] font-mono text-neutral-600 tabular-nums">
          0.0
        </p>
        {editing && <span className="hidden sm:block" />}
      </div>
    </div>
  );
}

function computeCurrentWeek(seasonStartsAt: string): number {
  const start = new Date(seasonStartsAt);
  const now = new Date();
  if (now < start) return 1;
  const daysIn = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  return Math.floor(daysIn / 7) + 1;
}

function formatReleaseDate(iso: string): string {
  // YYYY-MM-DD → "Jul 26, 2024". Done in UTC to avoid off-by-one from timezone.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}


// ─── All Rosters tab ────────────────────────────────────────────────────────

function AllRostersTab({
  leagueId,
  seasonId,
  members,
  movieSlots,
  tvSlots,
  flexSlots,
  benchSlots,
  myId,
}: {
  leagueId: number;
  seasonId: number;
  members: { user_id: string; label: string }[];
  movieSlots: number;
  tvSlots: number;
  flexSlots: number;
  benchSlots: number;
  myId: string | undefined;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Default the picker to the next member after the viewer (likely their
  // closest competitor), or the first member if the viewer isn't in the list.
  const initial = useMemo(() => {
    if (members.length === 0) return "";
    const myIdx = members.findIndex((m) => m.user_id === myId);
    if (myIdx === -1) return members[0].user_id;
    return members[(myIdx + 1) % members.length].user_id;
  }, [members, myId]);
  const urlMember = searchParams.get("member");
  const selected =
    urlMember && members.some((m) => m.user_id === urlMember)
      ? urlMember
      : initial;
  const setSelected = (next: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === initial) {
        params.delete("member");
      } else {
        params.set("member", next);
      }
      return params;
    });
  };

  // If the members list shifts so the URL member is no longer valid, the
  // derived `selected` automatically falls back to `initial` above.
  useEffect(() => {}, [members]);

  if (members.length === 0) {
    return (
      <p className="text-[13px] text-neutral-500 bg-neutral-900/50 border border-neutral-800 rounded-2xl p-4">
        No members in this league yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <label className="text-[12px] text-neutral-400 font-medium">
          Roster:
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600 min-w-[200px]"
        >
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.label}
              {m.user_id === myId ? " (you)" : ""}
            </option>
          ))}
        </select>
      </div>

      <MemberRosterView
        leagueId={leagueId}
        seasonId={seasonId}
        userId={selected}
        movieSlots={movieSlots}
        tvSlots={tvSlots}
        flexSlots={flexSlots}
        benchSlots={benchSlots}
      />
    </div>
  );
}

function MemberRosterView({
  leagueId,
  seasonId,
  userId,
  movieSlots,
  tvSlots,
  flexSlots,
  benchSlots,
}: {
  leagueId: number;
  seasonId: number;
  userId: string;
  movieSlots: number;
  tvSlots: number;
  flexSlots: number;
  benchSlots: number;
}) {
  const { data, isLoading } = useUserBreakdown(leagueId, seasonId, userId);
  if (isLoading) {
    return <p className="text-neutral-500 text-sm">Loading…</p>;
  }
  return (
    <RosterView
      leagueId={leagueId}
      seasonId={seasonId}
      breakdown={data}
      movieSlots={movieSlots}
      tvSlots={tvSlots}
      flexSlots={flexSlots}
      benchSlots={benchSlots}
      ownerView={false}
    />
  );
}
