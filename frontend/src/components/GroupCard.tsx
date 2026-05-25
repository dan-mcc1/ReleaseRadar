import { Link } from "react-router-dom";
import type { Community } from "../hooks/api/useCommunities";

export default function GroupCard({ c }: { c: Community }) {
  const color = c.banner_color || "#3b82f6";
  return (
    <Link
      to={`/groups/${c.slug}`}
      className="group flex flex-col rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-colors"
    >
      <div
        className="h-20 relative"
        style={{
          background: `linear-gradient(135deg, ${color}, ${color}88)`,
        }}
      >
        {c.is_featured && (
          <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider bg-amber-400/90 text-amber-950 rounded-full px-2 py-0.5">
            Featured
          </span>
        )}
        {c.visibility === "private" && (
          <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-wider bg-black/40 text-white rounded-full px-2 py-0.5 flex items-center gap-1">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m12 0H4.5v9.75A2.25 2.25 0 006.75 22.5h10.5a2.25 2.25 0 002.25-2.25V10.5z" />
            </svg>
            Private
          </span>
        )}
      </div>
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-[15px] font-semibold text-white group-hover:text-primary-300 transition-colors line-clamp-1">
            {c.name}
          </h3>
          {c.viewer_role && (
            <span className="text-[9.5px] font-mono uppercase tracking-wider text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded">
              {c.viewer_role === "owner" ? "Owner" : c.viewer_role === "admin" ? "Admin" : "Joined"}
            </span>
          )}
        </div>
        {c.description ? (
          <p className="text-[12.5px] text-neutral-400 line-clamp-2 leading-snug">
            {c.description}
          </p>
        ) : (
          <p className="text-[12.5px] text-neutral-600 italic">No description.</p>
        )}
        <div className="text-[11px] text-neutral-500 mt-2 font-mono tracking-[0.05em]">
          {c.member_count} {c.member_count === 1 ? "member" : "members"}
        </div>
      </div>
    </Link>
  );
}
