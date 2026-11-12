import { useEffect, useState } from "react";
import { useBrowseCommunities } from "../hooks/api/useCommunities";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser } from "../hooks/useAuthUser";
import GroupCard from "../components/GroupCard";
import CreateGroupModal from "../components/CreateGroupModal";
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  PlusIcon,
  SearchField,
} from "../components/ui";

export default function BrowseGroups() {
  usePageTitle("Groups");
  const user = useAuthUser();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: groups = [], isLoading } = useBrowseCommunities(debounced);

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <PageHeader
        title="Groups"
        description="Find a crew that loves the same stuff you do — fantasy, anime, rom-coms, you name it."
      />

      <div className="flex items-center gap-3 flex-wrap">
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search groups"
          placeholder="Search groups…"
          className="flex-1 min-w-[260px] w-auto"
        />
        {user && (
          <>
            <ButtonLink to="/my-groups">My groups</ButtonLink>
            <Button
              variant="primary"
              icon={<PlusIcon className="w-4 h-4" />}
              onClick={() => setShowCreate(true)}
            >
              Create group
            </Button>
          </>
        )}
      </div>

      <div>
        {isLoading ? (
          <p className="text-neutral-500 text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <EmptyState
            title="No groups found"
            action={
              user && (
                <Button variant="primary" onClick={() => setShowCreate(true)}>
                  Be the first to create one
                </Button>
              )
            }
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
