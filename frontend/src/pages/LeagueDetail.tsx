import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useCancelLeagueInvitation,
  useCreateSeason,
  useDeleteLeague,
  useInviteToLeague,
  useLeague,
  useLeagueInvitations,
  useLeagueMembers,
  useLeagueSeasons,
  useLeaveLeague,
  useRemoveLeagueMember,
  useSetCurrentSeason,
  type FantasyInvitation,
  type FantasyMember,
  type FantasySeason,
} from "../hooks/api/useFantasy";
import { useFriendSearch } from "../hooks/api/useFriends";
import { usePageTitle } from "../hooks/usePageTitle";

interface UserSearchResult {
  id: string;
  username: string;
  display_name: string | null;
  profile_visibility?: "public" | "friends_only" | "private";
}

const SEASON_CODE_OPTIONS = [
  { code: "summer", label: "Summer" },
  { code: "fall", label: "Fall" },
  { code: "holiday", label: "Holiday" },
  { code: "spring", label: "Spring" },
] as const;

export default function LeagueDetail() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const id = leagueId ? parseInt(leagueId, 10) : undefined;

  const { data: league, isLoading } = useLeague(id);
  const { data: members = [] } = useLeagueMembers(id);
  const { data: seasons = [] } = useLeagueSeasons(id);
  const isOwnerView = league?.viewer_role === "owner";
  const { data: invitations = [] } = useLeagueInvitations(
    isOwnerView ? id : undefined,
  );

  usePageTitle(league?.name ?? "League");

  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateSeason, setShowCreateSeason] = useState(false);

  if (isLoading) {
    return <p className="px-6 lg:px-10 pt-8 text-neutral-500 text-sm">Loading…</p>;
  }
  if (!league || !id) {
    return (
      <div className="px-6 lg:px-10 pt-8">
        <p className="text-neutral-300">League not found.</p>
        <Link to="/fantasy" className="text-primary-400 text-sm mt-2 inline-block">
          ← Back to my leagues
        </Link>
      </div>
    );
  }

  const isOwner = league.viewer_role === "owner";

  return (
    <div className="pb-24">
      <div className="px-6 lg:px-10 pt-8">
        <Link
          to="/fantasy"
          className="text-[12px] text-neutral-500 hover:text-neutral-300"
        >
          ← My Leagues
        </Link>

        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
              {league.name}
            </h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-500 mt-2">
              <span>
                <span className="text-neutral-300 font-medium">
                  ${league.starting_budget}
                </span>{" "}
                budget
              </span>
              <span>
                {league.roster_movie_slots}M / {league.roster_tv_slots}TV /{" "}
                {league.roster_flex_slots}F slots
              </span>
              <span>{league.boost_slots} boost slots/wk</span>
            </div>
          </div>
          <RoleActions
            league={league}
            isOwner={isOwner}
            onDeleted={() => navigate("/fantasy")}
            onLeft={() => navigate("/fantasy")}
          />
        </div>
      </div>

      <CurrentSeasonBanner league={league} seasons={seasons} />

      <div className="px-6 lg:px-10 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SectionHeader
            title="Seasons"
            action={
              isOwner ? (
                <button
                  onClick={() => setShowCreateSeason(true)}
                  className="text-[12px] font-semibold bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg"
                >
                  + New season
                </button>
              ) : null
            }
          />
          {seasons.length === 0 ? (
            <p className="text-[13px] text-neutral-500 bg-neutral-900/50 border border-neutral-800 rounded-2xl p-4">
              No seasons yet. {isOwner ? "Create one to start drafting." : ""}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {seasons.map((s) => (
                <SeasonRow
                  key={s.id}
                  leagueId={id}
                  season={s}
                  isCurrent={league.current_season_id === s.id}
                  isOwner={isOwner}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHeader
            title={`Members (${members.length}/${league.max_members})`}
            action={
              isOwner ? (
                <button
                  onClick={() => setShowAddMember(true)}
                  className="text-[12px] font-semibold bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg"
                >
                  + Invite
                </button>
              ) : null
            }
          />
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <MemberRow
                key={m.user_id}
                leagueId={id}
                member={m}
                canRemove={isOwner && m.role !== "owner"}
              />
            ))}
          </div>

          {isOwner && invitations.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
                Pending invitations ({invitations.length})
              </p>
              <div className="flex flex-col gap-2">
                {invitations.map((inv) => (
                  <InvitationRow key={inv.id} leagueId={id} invitation={inv} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddMember && (
        <InviteMembersModal
          leagueId={id}
          existingMemberIds={new Set(members.map((m) => m.user_id))}
          existingInvitedIds={new Set(invitations.map((i) => i.user_id))}
          onClose={() => setShowAddMember(false)}
        />
      )}
      {showCreateSeason && (
        <CreateSeasonModal
          leagueId={id}
          onClose={() => setShowCreateSeason(false)}
        />
      )}
    </div>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
        {title}
      </p>
      {action}
    </div>
  );
}

function CurrentSeasonBanner({
  league,
  seasons,
}: {
  league: ReturnType<typeof useLeague>["data"];
  seasons: FantasySeason[];
}) {
  if (!league?.current_season_id) return null;
  const current = seasons.find((s) => s.id === league.current_season_id);
  if (!current) return null;

  return (
    <div className="px-6 lg:px-10 mt-6">
      <Link
        to={`/fantasy/${league.id}/seasons/${current.id}`}
        className="block bg-gradient-to-r from-primary-600/20 to-primary-600/5 border border-primary-500/30 rounded-2xl p-5 hover:from-primary-600/30 hover:to-primary-600/10 transition-colors"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-mono text-[10px] tracking-[0.14em] text-primary-300 uppercase">
              Current season
            </p>
            <h2 className="text-xl font-semibold text-white mt-1">{current.name}</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5">
              {new Date(current.starts_at).toLocaleDateString()} →{" "}
              {new Date(current.ends_at).toLocaleDateString()}{" "}
              <span className="text-neutral-500">· {current.status}</span>
            </p>
          </div>
          <div className="text-[13px] text-primary-300 font-medium">
            View season →
          </div>
        </div>
      </Link>
    </div>
  );
}

function SeasonRow({
  leagueId,
  season,
  isCurrent,
  isOwner,
}: {
  leagueId: number;
  season: FantasySeason;
  isCurrent: boolean;
  isOwner: boolean;
}) {
  const setCurrent = useSetCurrentSeason(leagueId);
  return (
    <div className="flex items-center justify-between gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3">
      <div className="min-w-0">
        <Link
          to={`/fantasy/${leagueId}/seasons/${season.id}`}
          className="text-[14px] font-semibold text-white hover:text-primary-300"
        >
          {season.name}
        </Link>
        <p className="text-[11.5px] text-neutral-500 mt-0.5">
          {new Date(season.starts_at).toLocaleDateString()} →{" "}
          {new Date(season.ends_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${
            statusClass(season.status)
          }`}
        >
          {season.status}
        </span>
        {isCurrent ? (
          <span className="text-[10px] font-mono uppercase tracking-wider text-primary-300 bg-primary-500/15 border border-primary-500/30 px-2 py-0.5 rounded-full">
            Current
          </span>
        ) : (
          isOwner && (
            <button
              onClick={() => setCurrent.mutate(season.id)}
              disabled={setCurrent.isPending}
              className="text-[11px] text-neutral-400 hover:text-white disabled:opacity-50"
            >
              Set current
            </button>
          )
        )}
      </div>
    </div>
  );
}

function statusClass(status: string) {
  switch (status) {
    case "upcoming":
      return "text-neutral-300 bg-neutral-800";
    case "draft":
      return "text-amber-300 bg-amber-500/15 border border-amber-500/30";
    case "active":
      return "text-emerald-300 bg-emerald-500/15 border border-emerald-500/30";
    case "complete":
      return "text-neutral-500 bg-neutral-800/50";
    default:
      return "text-neutral-300 bg-neutral-800";
  }
}

function MemberRow({
  leagueId,
  member,
  canRemove,
}: {
  leagueId: number;
  member: FantasyMember;
  canRemove: boolean;
}) {
  const remove = useRemoveLeagueMember(leagueId);
  return (
    <div className="flex items-center justify-between gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-white truncate">
          {member.display_name || member.user_display_name || member.username || member.user_id}
        </p>
        <p className="text-[11px] text-neutral-500">
          ${member.budget_remaining} remaining
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full">
          {member.role}
        </span>
        {canRemove && (
          <button
            onClick={() => {
              if (confirm(`Remove ${member.username ?? "this member"} from the league?`)) {
                remove.mutate(member.user_id);
              }
            }}
            disabled={remove.isPending}
            className="text-[11px] text-neutral-500 hover:text-red-400 disabled:opacity-50"
            title="Remove member"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function RoleActions({
  league,
  isOwner,
  onDeleted,
  onLeft,
}: {
  league: NonNullable<ReturnType<typeof useLeague>["data"]>;
  isOwner: boolean;
  onDeleted: () => void;
  onLeft: () => void;
}) {
  const deleteLeague = useDeleteLeague();
  const leave = useLeaveLeague();

  if (isOwner) {
    return (
      <button
        onClick={() => {
          if (
            confirm(
              `Delete "${league.name}"? This wipes all members, seasons, and scores.`,
            )
          ) {
            deleteLeague.mutate(league.id, { onSuccess: onDeleted });
          }
        }}
        disabled={deleteLeague.isPending}
        className="text-[12px] text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 px-3 py-1.5 rounded-lg disabled:opacity-50"
      >
        Delete league
      </button>
    );
  }
  if (league.viewer_role) {
    return (
      <button
        onClick={() => {
          if (confirm(`Leave "${league.name}"?`)) {
            leave.mutate(league.id, { onSuccess: onLeft });
          }
        }}
        disabled={leave.isPending}
        className="text-[12px] text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-3 py-1.5 rounded-lg disabled:opacity-50"
      >
        Leave
      </button>
    );
  }
  return null;
}

function InvitationRow({
  leagueId,
  invitation,
}: {
  leagueId: number;
  invitation: FantasyInvitation;
}) {
  const cancel = useCancelLeagueInvitation(leagueId);
  const invitee = invitation.invitee;
  const label =
    invitee?.display_name || (invitee?.username ? `@${invitee.username}` : "user");
  return (
    <div className="flex items-center justify-between gap-3 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-white truncate">{label}</p>
        {invitee?.display_name && invitee?.username && (
          <p className="text-[11px] text-neutral-500 font-mono truncate">
            @{invitee.username}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
          Pending
        </span>
        <button
          onClick={() => {
            if (confirm(`Cancel invitation to ${label}?`)) {
              cancel.mutate(invitation.id);
            }
          }}
          disabled={cancel.isPending}
          className="text-[11px] text-neutral-500 hover:text-red-400 disabled:opacity-50"
          title="Cancel invitation"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function MemberAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const hue = hashHue(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `oklch(0.32 0.10 ${hue})`,
        color: `oklch(0.88 0.08 ${hue})`,
        fontSize: size * 0.38,
        fontWeight: 600,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        letterSpacing: "0.02em",
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function InviteMembersModal({
  leagueId,
  existingMemberIds,
  existingInvitedIds,
  onClose,
}: {
  leagueId: number;
  existingMemberIds: Set<string>;
  existingInvitedIds: Set<string>;
  onClose: () => void;
}) {
  const invite = useInviteToLeague(leagueId);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: rawResults = [], isFetching } = useFriendSearch(debouncedQuery);
  const results = rawResults as UserSearchResult[];

  const showingSearch = debouncedQuery.trim().length > 0;
  const filtered = useMemo(
    () => results.filter((u) => u.username),
    [results],
  );

  async function handleInvite(user: UserSearchResult) {
    setError(null);
    try {
      await invite.mutateAsync({ username: user.username });
      setInvitedIds((prev) => new Set(prev).add(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send invitation.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-semibold text-white mb-1">Invite members</h3>
        <p className="text-[13px] text-neutral-400 mb-4">
          Search by username or display name. They'll get an invite to accept.
        </p>

        <div
          className="flex items-center gap-3 bg-neutral-950 border border-neutral-800 rounded-xl px-3 mb-3"
          style={{ height: 44 }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-neutral-500 shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder="Search users…"
            className="flex-1 bg-transparent text-neutral-100 placeholder-neutral-500 outline-none text-[14px]"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setDebouncedQuery("");
              }}
              className="w-6 h-6 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-500 flex items-center justify-center hover:text-neutral-300 shrink-0"
              aria-label="Clear search"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        {error && (
          <p className="text-[12px] text-red-400 mb-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-0">
          {!showingSearch ? (
            <p className="text-[12.5px] text-neutral-500 py-8 text-center">
              Start typing to find friends.
            </p>
          ) : isFetching && filtered.length === 0 ? (
            <p className="text-[12.5px] text-neutral-500 py-8 text-center">
              Searching…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-[12.5px] text-neutral-500 py-8 text-center">
              No users matching "{debouncedQuery}".
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((user) => {
                const isMember = existingMemberIds.has(user.id);
                const alreadyInvited =
                  existingInvitedIds.has(user.id) || invitedIds.has(user.id);
                const isPending =
                  invite.isPending && invite.variables?.username === user.username;
                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5"
                  >
                    <MemberAvatar
                      name={user.display_name || user.username}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-white truncate">
                        {user.display_name || `@${user.username}`}
                      </p>
                      {user.display_name && (
                        <p className="text-[11.5px] text-neutral-500 font-mono truncate">
                          @{user.username}
                        </p>
                      )}
                    </div>
                    {isMember ? (
                      <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 bg-neutral-800 px-2 py-1 rounded-full shrink-0">
                        In league
                      </span>
                    ) : alreadyInvited ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-1 rounded-full shrink-0">
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Invited
                      </span>
                    ) : (
                      <button
                        onClick={() => handleInvite(user)}
                        disabled={isPending}
                        className="text-[12px] font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg shrink-0"
                      >
                        {isPending ? "Inviting…" : "Invite"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="text-sm font-medium text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-4 py-2 rounded-xl"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateSeasonModal({
  leagueId,
  onClose,
}: {
  leagueId: number;
  onClose: () => void;
}) {
  const create = useCreateSeason(leagueId);
  const now = new Date();
  const [code, setCode] = useState<(typeof SEASON_CODE_OPTIONS)[number]["code"]>("summer");
  const [year, setYear] = useState(now.getFullYear());
  const [startsAt, setStartsAt] = useState(now.toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState(
    new Date(now.getTime() + 90 * 86400_000).toISOString().slice(0, 10),
  );
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await create.mutateAsync({
        code,
        year,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        make_current: makeCurrent,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create season.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-semibold text-white mb-1">Create a season</h3>
        <p className="text-[13px] text-neutral-400 mb-4">
          One of four windows per year. Each lasts ~3 months and ends with a champion.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="text-[12px] text-neutral-400 font-medium">Type</span>
            <select
              value={code}
              onChange={(e) => setCode(e.target.value as typeof code)}
              className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600"
            >
              {SEASON_CODE_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] text-neutral-400 font-medium">Year</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
              className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="text-[12px] text-neutral-400 font-medium">Starts</span>
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-neutral-400 font-medium">Ends</span>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 mb-4">
          <input
            type="checkbox"
            checked={makeCurrent}
            onChange={(e) => setMakeCurrent(e.target.checked)}
            className="accent-primary-500"
          />
          <span className="text-[13px] text-neutral-300">Make this the current season</span>
        </label>

        {error && (
          <p className="text-[12px] text-red-400 mb-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm font-medium text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-4 py-2 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={create.isPending}
            className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl"
          >
            {create.isPending ? "Creating…" : "Create season"}
          </button>
        </div>
      </div>
    </div>
  );
}
