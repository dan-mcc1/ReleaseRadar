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
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  PlusIcon,
  SectionHeader,
} from "../components/ui";

export default function MyGroups() {
  usePageTitle("My Groups");
  const { data: groups = [], isLoading } = useMyCommunities();
  const { data: invitations = [] } = useMyCommunityInvitations();
  const respond = useRespondToCommunityInvitation();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <PageHeader
        title="My groups"
        actions={
          <>
            <ButtonLink to="/groups">Browse all</ButtonLink>
            <Button
              variant="primary"
              icon={<PlusIcon className="w-4 h-4" />}
              onClick={() => setShowCreate(true)}
            >
              Create group
            </Button>
          </>
        }
      />

      {invitations.length > 0 && (
        <section>
          <SectionHeader title="Pending invitations" note={invitations.length} className="mb-3" />
          <div className="flex flex-col gap-2">
            {invitations.map((inv) => {
              const isResponding =
                respond.isPending && respond.variables?.invitationId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-surface p-4"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/groups/${inv.community.slug}`}
                      className="text-body font-semibold text-white hover:text-primary-300"
                    >
                      {inv.community.name}
                    </Link>
                    <p className="text-caption text-neutral-500 mt-0.5">
                      Invited by{" "}
                      <span className="text-neutral-300">
                        @{inv.invited_by?.username ?? "someone"}
                      </span>
                      {" • "}
                      {inv.community.member_count}{" "}
                      {inv.community.member_count === 1 ? "member" : "members"}
                    </p>
                    {inv.community.description && (
                      <p className="text-label text-neutral-400 mt-1.5 line-clamp-2">
                        {inv.community.description}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="primary"
                      onClick={() =>
                        respond.mutate({ invitationId: inv.id, accept: true })
                      }
                      disabled={isResponding}
                    >
                      Accept
                    </Button>
                    <Button
                      onClick={() =>
                        respond.mutate({ invitationId: inv.id, accept: false })
                      }
                      disabled={isResponding}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div>
        {isLoading ? (
          <p className="text-neutral-500 text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <EmptyState
            title="You haven't joined any groups yet"
            action={<ButtonLink to="/groups" variant="primary">Browse groups</ButtonLink>}
          />
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
