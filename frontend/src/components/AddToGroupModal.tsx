import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useMyCommunities,
  useAddMedia,
  useRemoveMedia,
  useItemGroupMembership,
  type Community,
} from "../hooks/api/useCommunities";
import { Button, CheckIcon, ChevronRightIcon, CloseIcon, moreLinkClass } from "./ui";

interface Props {
  contentType: "movie" | "tv";
  contentId: number;
  title: string;
  onClose: () => void;
}

export default function AddToGroupModal({
  contentType,
  contentId,
  title,
  onClose,
}: Props) {
  const { data: groups = [], isLoading: groupsLoading } = useMyCommunities();
  const { data: membership = [], isLoading: membershipLoading } =
    useItemGroupMembership(contentType, contentId);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const memberOf = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of membership) map.set(m.community_id, m.media_id);
    return map;
  }, [membership]);

  // Only groups where the viewer is allowed to add titles. By default that's
  // owner/admin only — members are eligible when the group has enabled
  // "any member can add or remove titles".
  const eligible = useMemo(
    () =>
      groups.filter(
        (g: Community) =>
          g.viewer_can_edit_media &&
          (query.trim() === "" || g.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [groups, query],
  );

  const isLoading = groupsLoading || membershipLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-surface p-6 w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-title font-semibold text-white mb-1">Add to group</h3>
        <p className="text-label text-neutral-400 mb-4 line-clamp-1">
          <span className="text-neutral-300 font-medium">{title}</span>
        </p>

        {groups.length > 5 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter your groups…"
            className="bg-neutral-950 border border-neutral-800 rounded-control px-3 py-2 text-body text-white placeholder-neutral-500 outline-none focus:border-neutral-400 mb-3"
          />
        )}

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {isLoading ? (
            <p className="text-neutral-500 text-sm">Loading…</p>
          ) : eligible.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-neutral-300 text-sm">
                {groups.length === 0
                  ? "You haven't joined any groups yet."
                  : "None of your groups let you add titles."}
              </p>
              {groups.length > 0 && (
                <p className="text-caption text-neutral-400 mt-1">
                  Only the owner and admins can add titles by default.
                </p>
              )}
              <Link to="/groups" onClick={onClose} className={`mt-2 ${moreLinkClass}`}>
                Browse groups
                <ChevronRightIcon />
              </Link>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {eligible.map((g: Community) => (
                <li
                  key={g.id}
                  className="flex items-center gap-3 p-2.5 rounded-control border border-neutral-800 hover:border-neutral-700 transition-colors"
                >
                  <div
                    className="w-9 h-9 rounded-lg shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${g.banner_color || "#3b82f6"}, ${g.banner_color || "#3b82f6"}88)`,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-body font-medium text-white truncate">{g.name}</p>
                    <p className="text-caption text-neutral-400">
                      {g.member_count} member{g.member_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <ToggleBtn
                    groupId={g.id}
                    contentType={contentType}
                    contentId={contentId}
                    mediaId={memberOf.get(g.id) ?? null}
                    onError={setError}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-error-400 text-sm mt-3">{error}</p>}

        <Button className="mt-4" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ToggleBtn({
  groupId,
  contentType,
  contentId,
  mediaId,
  onError,
}: {
  groupId: number;
  contentType: "movie" | "tv";
  contentId: number;
  mediaId: number | null;
  onError: (msg: string | null) => void;
}) {
  const add = useAddMedia(groupId);
  const remove = useRemoveMedia(groupId);
  const isAdded = mediaId !== null;
  const isPending = add.isPending || remove.isPending;

  async function handle() {
    onError(null);
    try {
      if (isAdded) {
        // The optimistic add sets media_id to -1 until the POST resolves.
        // Clicking remove during that window would 404 — guard against it.
        if (mediaId === -1) return;
        await remove.mutateAsync({
          mediaId: mediaId as number,
          contentType,
          contentId,
        });
      } else {
        await add.mutateAsync({ content_type: contentType, content_id: contentId });
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed.");
    }
  }

  if (isAdded) {
    return (
      <Button
        size="sm"
        onClick={handle}
        loading={isPending}
        title="Remove from this group"
        className="group/btn"
      >
        <CheckIcon className="w-3 h-3 group-hover/btn:hidden" />
        <CloseIcon className="w-3 h-3 hidden group-hover/btn:inline" />
        <span className="group-hover/btn:hidden">Added</span>
        <span className="hidden group-hover/btn:inline">Remove</span>
      </Button>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={handle} loading={isPending}>
      {isPending ? "Adding…" : "Add"}
    </Button>
  );
}
