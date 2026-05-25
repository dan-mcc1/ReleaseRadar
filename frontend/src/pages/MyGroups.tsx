import { useState } from "react";
import { Link } from "react-router-dom";
import { useMyCommunities } from "../hooks/api/useCommunities";
import { usePageTitle } from "../hooks/usePageTitle";
import GroupCard from "../components/GroupCard";
import CreateGroupModal from "../components/CreateGroupModal";

export default function MyGroups() {
  usePageTitle("My Groups");
  const { data: groups = [], isLoading } = useMyCommunities();
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
