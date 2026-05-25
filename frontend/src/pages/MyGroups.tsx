import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useMyCommunities,
  useMyCommunityInvitations,
  useRespondToCommunityInvitation,
} from "../hooks/api/useCommunities";
import { usePageTitle } from "../hooks/usePageTitle";
import GroupCard from "../components/GroupCard";
import CreateGroupModal from "../components/CreateGroupModal";

export default function MyGroups() {
  usePageTitle("My Groups");
  const { data: groups = [], isLoading } = useMyCommunities();
  const { data: invitations = [] } = useMyCommunityInvitations();
  const respond = useRespondToCommunityInvitation();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="pb-24">
      <div className="px-6 lg:px-10 pt-8 pb-2 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
            My communities
          </p>
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
            My Groups
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/groups"
            className="text-sm font-medium text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-4 py-2.5 rounded-xl transition-colors"
          >
            Browse all
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white px-4 py-2.5 rounded-xl"
          >
            + Create group
          </button>
        </div>
      </div>

      {invitations.length > 0 && (
        <div className="px-6 lg:px-10 mt-6">
          <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-3">
            Pending invitations ({invitations.length})
          </p>
          <div className="flex flex-col gap-2">
            {invitations.map((inv) => {
              const isResponding =
                respond.isPending && respond.variables?.invitationId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-2xl p-4"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/groups/${inv.community.slug}`}
                      className="text-[15px] font-semibold text-white hover:text-primary-300"
                    >
                      {inv.community.name}
                    </Link>
                    <p className="text-[12px] text-neutral-500 mt-0.5">
                      Invited by{" "}
                      <span className="text-neutral-300">
                        @{inv.invited_by?.username ?? "someone"}
                      </span>
                      {" • "}
                      {inv.community.member_count}{" "}
                      {inv.community.member_count === 1 ? "member" : "members"}
                    </p>
                    {inv.community.description && (
                      <p className="text-[12.5px] text-neutral-400 mt-1.5 line-clamp-2">
                        {inv.community.description}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() =>
                        respond.mutate({ invitationId: inv.id, accept: true })
                      }
                      disabled={isResponding}
                      className="text-[13px] font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() =>
                        respond.mutate({ invitationId: inv.id, accept: false })
                      }
                      disabled={isResponding}
                      className="text-[13px] font-medium text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-white disabled:opacity-50 px-4 py-2 rounded-xl"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-6 lg:px-10 mt-6">
        {isLoading ? (
          <p className="text-neutral-500 text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 bg-neutral-900/50 border border-neutral-800 rounded-2xl">
            <p className="text-neutral-300 font-medium">You haven't joined any groups yet.</p>
            <Link to="/groups" className="mt-3 inline-block text-sm text-primary-400 hover:text-primary-300">
              Browse groups →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((g) => (
              <GroupCard key={g.id} c={g} />
            ))}
          </div>
        )}
      </div>

      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
