import { Link } from "react-router-dom";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import type { Community } from "../hooks/api/useCommunities";

export default function GroupCard({ c }: { c: Community }) {
  const color = c.banner_color || "#3b82f6";
  return (
    <Link
      to={`/groups/${c.slug}`}
      className="group flex flex-col rounded-surface overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-colors"
    >
      <div
        className="h-20 relative"
        style={{
          background: `linear-gradient(135deg, ${color}, ${color}88)`,
        }}
      >
        {c.is_featured && (
          <span className="absolute top-2 right-2 text-caption font-semibold bg-warning-400/90 text-warning-950 rounded-full px-2 py-0.5">
            Featured
          </span>
        )}
        {c.visibility === "private" && (
          <span className="absolute top-2 left-2 text-caption font-semibold bg-black/40 text-white rounded-full px-2 py-0.5 flex items-center gap-1">
            <LockClosedIcon className="w-3 h-3" strokeWidth={2.5} aria-hidden="true" />
            Private
          </span>
        )}
      </div>
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-body font-semibold text-white group-hover:text-primary-300 transition-colors line-clamp-1">
            {c.name}
          </h3>
          {c.viewer_role && (
            <span className="text-caption text-neutral-300 bg-neutral-800 px-1.5 py-0.5 rounded">
              {c.viewer_role === "owner" ? "Owner" : c.viewer_role === "admin" ? "Admin" : "Joined"}
            </span>
          )}
        </div>
        {c.description ? (
          <p className="text-label text-neutral-400 line-clamp-2 leading-snug">
            {c.description}
          </p>
        ) : (
          <p className="text-label text-neutral-500 italic">No description.</p>
        )}
        <div className="text-caption text-neutral-500 mt-2 tabular">
          {c.member_count} {c.member_count === 1 ? "member" : "members"}
        </div>
      </div>
    </Link>
  );
}
