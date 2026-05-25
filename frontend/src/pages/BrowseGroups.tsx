import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useBrowseCommunities } from "../hooks/api/useCommunities";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser } from "../hooks/useAuthUser";
import GroupCard from "../components/GroupCard";
import CreateGroupModal from "../components/CreateGroupModal";

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
    <div className="pb-24">
      <div className="px-6 lg:px-10 pt-8 pb-2">
        <p className="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase mb-2">
          Communities
        </p>
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
          Groups
        </h1>
        <p className="text-neutral-400 text-sm mt-2 max-w-xl">
          Find a crew that loves the same stuff you do — fantasy, anime, rom-coms, you name it.
        </p>
      </div>

      <div className="px-6 lg:px-10 pt-6 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-2.5 flex-1 min-w-[260px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-500">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search groups…"
            // text-base on mobile (>=16px) prevents iOS Safari from auto-zooming
            // when the input gets focus; shrink back to text-sm on sm+.
            className="flex-1 bg-transparent text-neutral-100 placeholder-neutral-500 outline-none text-base sm:text-sm"
          />
        </div>
        {user && (
          <>
            <Link
              to="/my-groups"
              className="text-sm font-medium text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-4 py-2.5 rounded-xl transition-colors"
            >
              My groups
            </Link>
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white px-4 py-2.5 rounded-xl"
            >
              + Create group
            </button>
          </>
        )}
      </div>

      <div className="px-6 lg:px-10 mt-6">
        {isLoading ? (
          <p className="text-neutral-500 text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 bg-neutral-900/50 border border-neutral-800 rounded-2xl">
            <p className="text-neutral-300 font-medium">No groups found.</p>
            {user && (
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 text-sm text-primary-400 hover:text-primary-300"
              >
                Be the first to create one →
              </button>
            )}
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
