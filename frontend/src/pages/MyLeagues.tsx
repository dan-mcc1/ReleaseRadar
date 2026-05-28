import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useMyLeagueInvitations,
  useMyLeagues,
  useRespondToLeagueInvitation,
  type FantasyInvitation,
  type FantasyLeague,
} from "../hooks/api/useFantasy";
import { usePageTitle } from "../hooks/usePageTitle";
import CreateLeagueModal from "../components/CreateLeagueModal";

export default function MyLeagues() {
  usePageTitle("Fantasy Leagues");
  const { data: leagues = [], isLoading } = useMyLeagues();
  const { data: invitations = [] } = useMyLeagueInvitations();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="pb-24">
      <div className="px-6 lg:px-10 pt-8 pb-2 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
            Fantasy box office
          </p>
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
            My Leagues
          </h1>
          <p className="text-[13px] text-neutral-400 mt-2 max-w-xl">
            Draft movies and shows, score on real-world ROI, compete with friends
            over a 3-month season.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white px-4 py-2.5 rounded-xl"
        >
          + Create league
        </button>
      </div>

      {invitations.length > 0 && (
        <div className="px-6 lg:px-10 mt-6">
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
            Pending invitations ({invitations.length})
          </p>
          <div className="flex flex-col gap-2">
            {invitations.map((inv) => (
              <InvitationCard key={inv.id} invitation={inv} />
            ))}
          </div>
        </div>
      )}

      <div className="px-6 lg:px-10 mt-6">
        {isLoading ? (
          <p className="text-neutral-500 text-sm">Loading…</p>
        ) : leagues.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {leagues.map((l) => (
              <LeagueCard key={l.id} league={l} />
            ))}
          </div>
        )}
      </div>

      {showCreate && <CreateLeagueModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function LeagueCard({ league }: { league: FantasyLeague }) {
  return (
    <Link
      to={`/fantasy/${league.id}`}
      className="block bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-2xl p-5 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-[16px] font-semibold text-white line-clamp-2">
          {league.name}
        </h3>
        {league.viewer_role && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full shrink-0">
            {league.viewer_role}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-500">
        <span>
          <span className="text-neutral-300 font-medium">
            ${league.starting_budget}
          </span>{" "}
          budget
        </span>
        <span>
          {league.roster_movie_slots + league.roster_tv_slots + league.roster_flex_slots}{" "}
          roster slots
        </span>
        <span>up to {league.max_members} members</span>
      </div>
      {league.current_season_id ? (
        <p className="text-[12px] text-primary-400 mt-3">Season in progress →</p>
      ) : (
        <p className="text-[12px] text-neutral-500 mt-3">No active season yet</p>
      )}
    </Link>
  );
}

function InvitationCard({ invitation }: { invitation: FantasyInvitation }) {
  const respond = useRespondToLeagueInvitation();
  const isResponding =
    respond.isPending && respond.variables?.invitationId === invitation.id;
  const inviterLabel =
    invitation.inviter?.display_name ||
    (invitation.inviter?.username ? `@${invitation.inviter.username}` : "someone");

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold text-white truncate">
          {invitation.league?.name ?? "Fantasy league"}
        </p>
        <p className="text-[12px] text-neutral-500 mt-0.5">
          Invited by <span className="text-neutral-300">{inviterLabel}</span>
          {invitation.league && (
            <>
              {" • "}${invitation.league.starting_budget} starting budget
            </>
          )}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() =>
            respond.mutate({ invitationId: invitation.id, accept: true })
          }
          disabled={isResponding}
          className="text-[13px] font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl"
        >
          Accept
        </button>
        <button
          onClick={() =>
            respond.mutate({ invitationId: invitation.id, accept: false })
          }
          disabled={isResponding}
          className="text-[13px] font-medium text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-white disabled:opacity-50 px-4 py-2 rounded-xl"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-16 bg-neutral-900/50 border border-neutral-800 rounded-2xl">
      <p className="text-neutral-200 font-medium text-base">
        You haven't joined any leagues yet.
      </p>
      <p className="text-neutral-500 text-[13px] mt-2 max-w-md mx-auto">
        Create one to draft movies and shows with friends. Score on actual box
        office and ratings — best portfolio wins.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white px-5 py-2.5 rounded-xl"
      >
        + Create your first league
      </button>
    </div>
  );
}
