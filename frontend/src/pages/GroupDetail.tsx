import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  useCommunity,
  useCommunityMembers,
  useCommunityMedia,
  useCommunityPosts,
  useCommunityPost,
  useJoinCommunity,
  useLeaveCommunity,
  useCreatePost,
  useDeletePost,
  useUpdatePost,
  useUpdateReply,
  useTogglePostLike,
  useToggleReplyLike,
  useAddReply,
  useDeleteReply,
  useRemoveMember,
  useInviteMember,
  useSetMemberRole,
  useRemoveMedia,
  useAddMedia,
  useUpdateCommunity,
  useDeleteCommunity,
  useGroupPendingInvitations,
  useRevokeGroupInvitation,
  type Community,
  type CommunityMember,
  type CommunityMedia,
  type CommunityMediaItem,
  type CommunityPost as CommunityPostT,
  type CommunityReply as CommunityReplyT,
} from "../hooks/api/useCommunities";
import { useSearch } from "../hooks/api/useSearch";
import { useBulkWatchStatus } from "../hooks/api/useWatchStatus";
import type { Movie, Show } from "../types/calendar";
import { useFriends } from "../hooks/api/useFriends";
import ReportModal from "../components/ReportModal";
import MiniWatchButton from "../components/MiniWatchButton";
import MiniWatchedButton from "../components/MiniWatchedButton";
import type { WatchStatus } from "../components/WatchButton";
import {
  Button,
  ButtonLink,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  EmptyState,
  IconButton,
  PageHeader,
  PlusIcon,
  PosterCard,
  SearchField,
  Segmented,
  SectionHeader,
  StarIcon,
  cx,
  focusRing,
} from "../components/ui";
import { EllipsisHorizontalIcon, HeartIcon as HeartOutlineIcon } from "@heroicons/react/24/outline";
import { HeartIcon as HeartSolidIcon } from "@heroicons/react/24/solid";

interface UserSearchResult {
  id: string;
  username: string;
  display_name: string | null;
}

type Tab = "discussion" | "titles" | "members" | "settings";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function GroupDetail() {
  const { slug } = useParams<{ slug: string }>();
  const user = useAuthUser();
  const navigate = useNavigate();
  const { data: group, isLoading, isError } = useCommunity(slug);
  const [searchParams, setSearchParams] = useSearchParams();
  const VALID_TABS: readonly Tab[] = ["discussion", "titles", "members", "settings"];
  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "discussion";
  function setTab(next: Tab) {
    setSearchParams(
      (p) => {
        if (next === "discussion") p.delete("tab");
        else p.set("tab", next);
        return p;
      },
      { replace: true },
    );
  }

  usePageTitle(group?.name);

  if (isLoading) {
    return <div className="px-6 lg:px-10 py-10 text-neutral-500 text-sm">Loading…</div>;
  }
  if (isError || !group) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <EmptyState
          title="Group not found."
          action={<ButtonLink to="/groups">Browse groups</ButtonLink>}
        />
      </div>
    );
  }

  const isMember = group.viewer_role !== null;
  const isAdmin = group.viewer_role === "owner" || group.viewer_role === "admin";

  const visibleTabs: { id: Tab; label: string }[] = [
    { id: "discussion", label: "Discussion" },
    { id: "titles", label: "Titles" },
    { id: "members", label: `Members · ${group.member_count}` },
  ];
  if (isAdmin) visibleTabs.push({ id: "settings", label: "Settings" });

  return (
    <div className="pb-24">
      <GroupHeader group={group} />

      <div className="px-6 lg:px-10 mt-4 border-b border-neutral-800 flex gap-1 flex-wrap">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
              focusRing,
              tab === t.id
                ? "border-primary-500 text-white"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-6 lg:px-10 mt-6">
        {tab === "discussion" && (
          <DiscussionTab group={group} isMember={isMember} userId={user?.uid ?? null} />
        )}
        {tab === "titles" && (
          <TitlesTab group={group} isMember={isMember} userId={user?.uid ?? null} />
        )}
        {tab === "members" && (
          <MembersTab group={group} isAdmin={isAdmin} viewerId={user?.uid ?? null} />
        )}
        {tab === "settings" && isAdmin && (
          <SettingsTab group={group} onDeleted={() => navigate("/groups")} />
        )}
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────

function GroupHeader({ group }: { group: Community }) {
  const user = useAuthUser();
  const join = useJoinCommunity();
  const leave = useLeaveCommunity();
  const color = group.banner_color || "#3b82f6";
  const isMember = group.viewer_role !== null;
  const [showReport, setShowReport] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const canReport = !!user && group.created_by !== user.uid;

  return (
    <div
      className="relative border-b border-neutral-800 overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${color}33 0%, transparent 60%), #111`,
      }}
    >
      <div className="px-6 lg:px-10 pt-10 pb-7 flex items-start gap-6 flex-wrap">
        <div
          className="w-16 h-16 rounded-surface flex items-center justify-center text-heading font-bold text-white shrink-0"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}88)` }}
        >
          {group.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <PageHeader
            title={group.name}
            description={
              <>
                <span className="tabular">{group.member_count}</span>{" "}
                {group.member_count === 1 ? "member" : "members"}
                {group.visibility === "private" && " · Private"}
                {group.is_featured && " · Featured"}
              </>
            }
            actions={
              user && (
                <>
                  {isMember ? (
                    <Button
                      onClick={() => leave.mutate(group.id)}
                      disabled={leave.isPending}
                    >
                      {leave.isPending ? "Leaving…" : group.viewer_role === "owner" ? "Owner" : "Leave"}
                    </Button>
                  ) : (
                    group.visibility === "public" && (
                      <Button
                        variant="primary"
                        onClick={() => join.mutate(group.id)}
                        disabled={join.isPending}
                      >
                        {join.isPending ? "Joining…" : "Join group"}
                      </Button>
                    )
                  )}
                  {canReport && (
                    <div className="relative">
                      <IconButton
                        variant="secondary"
                        shape="square"
                        label="More actions"
                        aria-expanded={menuOpen}
                        icon={<EllipsisHorizontalIcon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />}
                        onClick={() => setMenuOpen((v) => !v)}
                      />
                      {menuOpen && (
                        <div
                          className="absolute right-0 mt-1 w-40 bg-neutral-900 border border-neutral-800 rounded-control shadow-xl z-30 overflow-hidden"
                          onMouseLeave={() => setMenuOpen(false)}
                        >
                          <button
                            onClick={() => {
                              setMenuOpen(false);
                              setShowReport(true);
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm text-error-400 hover:bg-neutral-800 transition-colors"
                          >
                            Report group
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )
            }
          />
          {group.description && (
            <p className="text-neutral-300 text-body mt-3 max-w-2xl leading-relaxed">
              {group.description}
            </p>
          )}
        </div>
      </div>
      {showReport && (
        <ReportModal
          reportedType="community"
          reportedId={String(group.id)}
          label="this group"
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

// ─── Discussion ───────────────────────────────────────────────────────────

function DiscussionTab({
  group,
  isMember,
  userId,
}: {
  group: Community;
  isMember: boolean;
  userId: string | null;
}) {
  const { data: posts = [], isLoading } = useCommunityPosts(group.id);
  const [openPostId, setOpenPostId] = useState<number | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
      <div className="flex flex-col gap-3">
        {isMember && <NewPostBox communityId={group.id} />}
        {isLoading ? (
          <p className="text-neutral-500 text-sm">Loading…</p>
        ) : posts.length === 0 ? (
          <EmptyState
            className="py-12"
            title="No posts yet."
            description={!isMember ? "Join the group to start a discussion." : undefined}
          />
        ) : (
          posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              communityId={group.id}
              userId={userId}
              isOpen={openPostId === p.id}
              onToggle={() => setOpenPostId(openPostId === p.id ? null : p.id)}
              canModerate={group.viewer_role === "owner" || group.viewer_role === "admin"}
            />
          ))
        )}
      </div>
      <aside className="sticky top-24">
        <SectionHeader title="About this group" className="mb-2" />
        <p className="text-sm text-neutral-300">
          {group.description || "No description yet."}
        </p>
      </aside>
    </div>
  );
}

function NewPostBox({ communityId }: { communityId: number }) {
  const create = useCreatePost(communityId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await create.mutateAsync({ title: title.trim() || null, body });
      setTitle("");
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post.");
    }
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-surface p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        maxLength={150}
        className="w-full bg-neutral-950 border border-neutral-800 rounded-control px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600 mb-2"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Start a discussion…"
        rows={3}
        maxLength={5000}
        className="w-full bg-neutral-950 border border-neutral-800 rounded-control px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600 resize-none"
      />
      {error && <p className="text-error-400 text-xs mt-2">{error}</p>}
      <div className="flex justify-between items-center mt-2">
        <span className="text-caption text-neutral-500">{body.length}/5000</span>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={create.isPending || !body.trim()}
        >
          {create.isPending ? "Posting…" : "Post"}
        </Button>
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <HeartSolidIcon className="w-3.5 h-3.5" aria-hidden="true" />
  ) : (
    <HeartOutlineIcon className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
  );
}

function PostRow({
  post,
  communityId,
  userId,
  isOpen,
  onToggle,
  canModerate,
}: {
  post: CommunityPostT;
  communityId: number;
  userId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  canModerate: boolean;
}) {
  const del = useDeletePost(communityId);
  const update = useUpdatePost(communityId);
  const toggleLike = useTogglePostLike(communityId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title ?? "");
  const [editBody, setEditBody] = useState(post.body);
  const [showReport, setShowReport] = useState(false);

  const isAuthor = post.user?.id === userId;
  const canDelete = isAuthor || canModerate;
  const authorLabel = post.user?.display_name || (post.user ? `@${post.user.username}` : "Unknown");

  async function saveEdit() {
    await update.mutateAsync({ postId: post.id, title: editTitle.trim() || null, body: editBody });
    setEditing(false);
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-surface p-4 relative">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title (optional)"
                maxLength={150}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-control px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600 mb-2"
              />
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-control px-3 py-2 text-sm text-white outline-none focus:border-neutral-600 resize-none"
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setEditTitle(post.title ?? "");
                    setEditBody(post.body);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveEdit}
                  disabled={update.isPending || !editBody.trim()}
                >
                  {update.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          ) : (
            <>
              {post.title && (
                <h3 className="text-title font-semibold text-white mb-1 leading-tight">
                  {post.title}
                </h3>
              )}
              <p className="text-label text-neutral-500 mb-2">
                {authorLabel} · {timeAgo(post.created_at)}
                {post.edited_at && <span className="text-neutral-600 italic"> · edited</span>}
              </p>
              <p className="text-body text-neutral-200 whitespace-pre-wrap leading-snug">
                {post.body}
              </p>
            </>
          )}
          {!editing && (
            <div className="flex items-center gap-4 mt-3">
              <button
                onClick={() => userId && toggleLike.mutate(post.id)}
                disabled={!userId}
                className={`flex items-center gap-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                  post.viewer_liked
                    ? "text-error-400"
                    : "text-neutral-500 hover:text-neutral-200"
                }`}
              >
                <HeartIcon filled={post.viewer_liked} />
                {post.like_count}
              </button>
              <button
                onClick={onToggle}
                aria-expanded={isOpen}
                className="flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-white"
              >
                {post.reply_count} {post.reply_count === 1 ? "reply" : "replies"}
                <ChevronDownIcon className={cx("w-3.5 h-3.5 transition-transform", isOpen && "rotate-180")} />
              </button>
            </div>
          )}
        </div>
        {!editing && userId && (
          <div className="relative shrink-0">
            <IconButton
              size="sm"
              label="Post actions"
              aria-expanded={menuOpen}
              icon={<EllipsisHorizontalIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
              onClick={() => setMenuOpen((v) => !v)}
            />
            {menuOpen && (
              <div
                className="absolute right-0 mt-1 w-36 bg-neutral-900 border border-neutral-800 rounded-control shadow-xl z-10 overflow-hidden"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {isAuthor && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setEditing(true);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      if (window.confirm("Delete this post?")) del.mutate(post.id);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Delete
                  </button>
                )}
                {!isAuthor && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowReport(true);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-error-400 hover:bg-neutral-800"
                  >
                    Report
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {isOpen && <PostReplies postId={post.id} userId={userId} canModerate={canModerate} />}
      {showReport && (
        <ReportModal
          reportedType="community_post"
          reportedId={String(post.id)}
          label="this post"
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

function ReplyRow({
  reply,
  postId,
  userId,
  canModerate,
}: {
  reply: CommunityReplyT;
  postId: number;
  userId: string | null;
  canModerate: boolean;
}) {
  const del = useDeleteReply(postId);
  const update = useUpdateReply(postId);
  const toggleLike = useToggleReplyLike(postId);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(reply.body);
  const [showReport, setShowReport] = useState(false);

  const isAuthor = reply.user?.id === userId;
  const canDelete = isAuthor || canModerate;
  const author = reply.user?.display_name || (reply.user ? `@${reply.user.username}` : "Unknown");

  async function saveEdit() {
    await update.mutateAsync({ replyId: reply.id, body: editBody });
    setEditing(false);
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-caption text-neutral-500">
          {author} · {timeAgo(reply.created_at)}
          {reply.edited_at && <span className="text-neutral-600 italic"> · edited</span>}
        </p>
        {editing ? (
          <>
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-label text-white outline-none focus:border-neutral-600 resize-none"
            />
            <div className="flex justify-end gap-2 mt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setEditBody(reply.body);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveEdit}
                disabled={update.isPending || !editBody.trim()}
              >
                Save
              </Button>
            </div>
          </>
        ) : (
          <p className="text-label text-neutral-200 whitespace-pre-wrap">{reply.body}</p>
        )}
        {!editing && (
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => userId && toggleLike.mutate(reply.id)}
              disabled={!userId}
              className={`flex items-center gap-1 text-caption font-medium transition-colors disabled:cursor-not-allowed ${
                reply.viewer_liked ? "text-error-400" : "text-neutral-500 hover:text-neutral-200"
              }`}
            >
              <HeartIcon filled={reply.viewer_liked} />
              {reply.like_count}
            </button>
            {isAuthor && (
              <button
                onClick={() => setEditing(true)}
                className="text-caption text-neutral-500 hover:text-white"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => {
                  if (window.confirm("Delete this reply?")) del.mutate(reply.id);
                }}
                className="text-caption text-neutral-600 hover:text-error-400"
              >
                Delete
              </button>
            )}
            {!isAuthor && userId && (
              <button
                onClick={() => setShowReport(true)}
                className="text-caption text-neutral-600 hover:text-error-400"
              >
                Report
              </button>
            )}
          </div>
        )}
      </div>
      {showReport && (
        <ReportModal
          reportedType="community_reply"
          reportedId={String(reply.id)}
          label="this reply"
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

function PostReplies({
  postId,
  userId,
  canModerate,
}: {
  postId: number;
  userId: string | null;
  canModerate: boolean;
}) {
  const { data, isLoading } = useCommunityPost(postId);
  const addReply = useAddReply(postId);
  const [body, setBody] = useState("");

  if (isLoading) return <p className="text-xs text-neutral-500 mt-3">Loading…</p>;
  const replies = data?.replies ?? [];

  async function submit() {
    if (!body.trim()) return;
    await addReply.mutateAsync(body.trim());
    setBody("");
  }

  return (
    <div className="mt-4 pt-4 border-t border-neutral-800 space-y-3">
      {replies.map((r) => (
        <ReplyRow key={r.id} reply={r} postId={postId} userId={userId} canModerate={canModerate} />
      ))}
      {userId && (
        <div className="flex gap-2 items-start">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Reply…"
            rows={2}
            maxLength={2000}
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-label text-white placeholder-neutral-600 outline-none focus:border-neutral-600 resize-none"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={addReply.isPending || !body.trim()}
          >
            Reply
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Titles ───────────────────────────────────────────────────────────────

function TitlesTab({
  group,
  isMember,
  userId,
}: {
  group: Community;
  isMember: boolean;
  userId: string | null;
}) {
  const { data: media, isLoading } = useCommunityMedia(group.id);
  const removeMedia = useRemoveMedia(group.id);
  const [editing, setEditing] = useState(false);

  const movies = media?.movies ?? [];
  const shows = media?.shows ?? [];

  // Bulk-fetch watch status for every title in the group so each tile gets its
  // own WatchButton initial state without N separate requests, and so we can
  // compute the user's progress.
  const statusItems = useMemo(
    () => [
      ...movies.map((m) => ({ content_type: "movie", content_id: m.content_id })),
      ...shows.map((s) => ({ content_type: "tv", content_id: s.content_id })),
    ],
    [movies, shows],
  );
  const { data: statusMap } = useBulkWatchStatus(userId ? statusItems : []);

  const progress = useMemo(() => {
    if (!userId) return null;
    const total = movies.length + shows.length;
    if (total === 0) return null;
    let watched = 0;
    let watching = 0;
    let watchlisted = 0;
    for (const m of movies) {
      const s = statusMap?.[`movie:${m.content_id}`]?.status;
      if (s === "Watched") watched++;
      else if (s === "Currently Watching") watching++;
      else if (s === "Want To Watch") watchlisted++;
    }
    for (const s of shows) {
      const st = statusMap?.[`tv:${s.content_id}`]?.status;
      if (st === "Watched") watched++;
      else if (st === "Currently Watching") watching++;
      else if (st === "Want To Watch") watchlisted++;
    }
    return {
      total,
      watched,
      watching,
      watchlisted,
      unseen: total - watched - watching - watchlisted,
      pct: Math.round((watched / total) * 100),
    };
  }, [userId, movies, shows, statusMap]);

  if (isLoading) return <p className="text-neutral-500 text-sm">Loading…</p>;
  const total = movies.length + shows.length;
  const canModerate = group.viewer_role === "owner" || group.viewer_role === "admin";
  const canEditMedia = group.viewer_can_edit_media;

  // Whether the viewer could remove *any* item in this group — enables the
  // Edit button. Per-item permission still applies in render.
  const viewerCanRemoveAny =
    canModerate || (group.members_can_edit_media && isMember) || isMember;

  function canRemoveItem(item: CommunityMediaItem): boolean {
    return (
      canModerate ||
      (group.members_can_edit_media && isMember) ||
      (item.added_by === userId && isMember)
    );
  }

  function renderItem(item: CommunityMediaItem, type: "movie" | "tv") {
    const label = item.title ?? item.name ?? "";
    const showRemove = editing && canRemoveItem(item);
    const statusEntry = statusMap?.[`${type}:${item.content_id}`];
    return (
      <PosterCard
        key={item.id}
        to={type === "movie" ? `/movie/${item.content_id}` : `/tv/${item.content_id}`}
        title={label}
        posterPath={item.poster_path}
        corner={
          item.vote_average != null && item.vote_average > 0 ? (
            <span className="px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-warning-400 text-caption font-semibold leading-none flex items-center gap-0.5">
              <StarIcon className="w-3 h-3" />
              {item.vote_average.toFixed(1)}
            </span>
          ) : undefined
        }
        actions={
          showRemove ? (
            <IconButton
              variant="overlay"
              size="sm"
              label="Remove from group"
              icon={<CloseIcon className="w-4 h-4" />}
              onClick={() =>
                removeMedia.mutate({
                  mediaId: item.id,
                  contentType: type,
                  contentId: item.content_id,
                })
              }
            />
          ) : undefined
        }
        footer={
          !editing && userId ? (
            <div className="flex items-center gap-0.5">
              {(statusEntry?.status ?? "none") !== "Watched" && (
                <MiniWatchButton
                  contentType={type}
                  contentId={item.content_id}
                  initialStatus={(statusEntry?.status ?? "none") as WatchStatus}
                  bulkManaged
                />
              )}
              <MiniWatchedButton
                contentType={type}
                contentId={item.content_id}
                initialStatus={(statusEntry?.status ?? "none") as WatchStatus}
                bulkManaged
              />
            </div>
          ) : undefined
        }
      />
    );
  }

  const editButton = total > 0 && viewerCanRemoveAny && (
    <Button size="sm" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
      {editing ? "Done" : "Edit"}
    </Button>
  );

  const firstSection: "shows" | "movies" | null =
    shows.length > 0 ? "shows" : movies.length > 0 ? "movies" : null;

  return (
    <div className="flex flex-col gap-6">
      {canEditMedia && (
        <GroupTitleSearch
          groupId={group.id}
          media={media ?? { movies: [], shows: [] }}
        />
      )}

      {progress && <GroupProgressCard progress={progress} />}

      {total === 0 ? (
        <EmptyState
          className="py-12"
          title="No titles attached yet."
          description={
            isMember
              ? canEditMedia
                ? "Use the search above to add your first title."
                : "Only the owner and admins can add titles to this group."
              : "Join to start adding titles."
          }
        />
      ) : (
      <div className="flex flex-col gap-8">
        {shows.length > 0 && (
          <section>
            <SectionHeader
              as="h3"
              title="TV shows"
              note={String(shows.length)}
              action={firstSection === "shows" && editButton}
              className="mb-3"
            />
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 2xl:grid-cols-posters-dense gap-3">
              {shows.map((s) => renderItem(s, "tv"))}
            </div>
          </section>
        )}
        {movies.length > 0 && (
          <section>
            <SectionHeader
              as="h3"
              title="Movies"
              note={String(movies.length)}
              action={firstSection === "movies" && editButton}
              className="mb-3"
            />
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 2xl:grid-cols-posters-dense gap-3">
              {movies.map((m) => renderItem(m, "movie"))}
            </div>
          </section>
        )}
      </div>
      )}
    </div>
  );
}

// ─── Group progress card ───────────────────────────────────────────────────

interface GroupProgress {
  total: number;
  watched: number;
  watching: number;
  watchlisted: number;
  unseen: number;
  pct: number;
}

function GroupProgressCard({ progress }: { progress: GroupProgress }) {
  const complete = progress.watched === progress.total;
  return (
    <section>
      <SectionHeader
        as="h3"
        title="Your progress"
        note={`${progress.pct}%`}
        action={
          complete && (
            <span className="inline-flex items-center gap-1 text-label font-medium text-success-400">
              <CheckIcon className="w-4 h-4" />
              Complete
            </span>
          )
        }
        className="mb-2"
      />

      <p className="text-body text-neutral-400 mb-2">
        <span className="tabular font-semibold text-white">{progress.watched}</span> of{" "}
        {progress.total} watched
      </p>

      <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            complete ? "bg-success-500" : "bg-primary-500"
          }`}
          style={{ width: `${progress.pct}%` }}
        />
      </div>

      <p className="mt-3 text-label text-neutral-400 tabular">
        {progress.watching} watching · {progress.watchlisted} on watchlist · {progress.unseen} untracked
      </p>

      {complete ? (
        <p className="mt-2 text-label text-success-300 leading-snug">
          Nice — you've watched every title in this group.
        </p>
      ) : progress.watched === 0 ? (
        <p className="mt-2 text-label text-neutral-500 leading-snug">
          You haven't watched any titles in this group yet.
        </p>
      ) : (
        <p className="mt-2 text-label text-neutral-500 leading-snug">
          {progress.total - progress.watched}{" "}
          {progress.total - progress.watched === 1 ? "title" : "titles"} left to
          go.
        </p>
      )}
    </section>
  );
}

// ─── Title search (in-tab add) ─────────────────────────────────────────────

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

interface SearchRowItem {
  type: "movie" | "tv";
  id: number;
  title: string;
  year: string | null;
  poster_path: string | null;
}

function GroupTitleSearch({
  groupId,
  media,
}: {
  groupId: number;
  media: CommunityMedia;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const { data: results, isFetching } = useSearch(debounced);
  const add = useAddMedia(groupId);
  const remove = useRemoveMedia(groupId);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // Lookup map: `${type}:${content_id}` -> media_id (the CommunityMedia row id),
  // used to know which results are already attached and to issue a targeted
  // remove without an extra request.
  const memberOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of media.movies) map.set(`movie:${m.content_id}`, m.id);
    for (const s of media.shows) map.set(`tv:${s.content_id}`, s.id);
    return map;
  }, [media]);

  const rows: SearchRowItem[] = useMemo(() => {
    if (!results) return [];
    const shows = (results.shows ?? []) as Show[];
    const movies = (results.movies ?? []) as Movie[];
    const showRows: SearchRowItem[] = shows.map((s) => ({
      type: "tv",
      id: s.id,
      title: s.name,
      year: s.first_air_date ? s.first_air_date.slice(0, 4) : null,
      poster_path: s.poster_path ?? null,
    }));
    const movieRows: SearchRowItem[] = movies.map((m) => ({
      type: "movie",
      id: m.id,
      title: m.title,
      year: m.release_date ? m.release_date.slice(0, 4) : null,
      poster_path: m.poster_path ?? null,
    }));
    // Lead with whichever type's top result is more popular; ties keep TV first.
    const moviesFirst =
      (movies[0]?.popularity ?? 0) > (shows[0]?.popularity ?? 0);
    const ordered = moviesFirst
      ? [...movieRows, ...showRows]
      : [...showRows, ...movieRows];
    return ordered.slice(0, 12);
  }, [results]);

  async function toggle(row: SearchRowItem) {
    setError(null);
    const key = `${row.type}:${row.id}`;
    const existingMediaId = memberOf.get(key);
    setPendingKey(key);
    try {
      if (existingMediaId !== undefined) {
        if (existingMediaId === -1) return; // in-flight add; ignore
        await remove.mutateAsync({
          mediaId: existingMediaId,
          contentType: row.type,
          contentId: row.id,
        });
      } else {
        await add.mutateAsync({
          content_type: row.type,
          content_id: row.id,
          title: row.title,
          poster_path: row.poster_path,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div>
      <p className="text-label font-medium text-neutral-300 mb-2">Add a title</p>
      <SearchField
        value={query}
        onChange={setQuery}
        label="Search movies and shows to add"
        placeholder="Search movies and shows…"
        className="w-full"
      />

      {debounced && (
        <div className="mt-3">
          {isFetching && rows.length === 0 ? (
            <p className="text-neutral-500 text-sm py-2">Searching…</p>
          ) : rows.length === 0 ? (
            <p className="text-neutral-500 text-sm py-2">No matches.</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-80 overflow-y-auto -mx-1 px-1">
              {rows.map((row) => {
                const key = `${row.type}:${row.id}`;
                const mediaId = memberOf.get(key);
                const isAdded = mediaId !== undefined;
                const isPending = pendingKey === key;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 p-2 rounded-control hover:bg-neutral-800/60 transition-colors"
                  >
                    <div className="w-9 h-12 rounded-md overflow-hidden bg-neutral-800 shrink-0">
                      {row.poster_path ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w92${row.poster_path}`}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-medium text-white truncate">
                        {row.title}
                      </p>
                      <p className="text-caption text-neutral-500">
                        {row.type === "movie" ? "Movie" : "TV"}
                        {row.year ? ` · ${row.year}` : ""}
                      </p>
                    </div>
                    <IconButton
                      variant="secondary"
                      label={isAdded ? `Remove ${row.title} from this group` : `Add ${row.title} to this group`}
                      pressed={isAdded}
                      disabled={isPending || mediaId === -1}
                      onClick={() => toggle(row)}
                      icon={
                        isPending ? (
                          <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : isAdded ? (
                          <CheckIcon className="w-4 h-4" />
                        ) : (
                          <PlusIcon className="w-4 h-4" />
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="text-error-400 text-sm mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Members ──────────────────────────────────────────────────────────────

function MembersTab({
  group,
  isAdmin,
  viewerId,
}: {
  group: Community;
  isAdmin: boolean;
  viewerId: string | null;
}) {
  const { data: members = [], isLoading } = useCommunityMembers(group.id);
  const isOwner = group.viewer_role === "owner";
  const remove = useRemoveMember(group.id);
  const setRole = useSetMemberRole(group.id);
  const invite = useInviteMember(group.id);
  const { data: pendingInvites = [] } = useGroupPendingInvitations(
    isAdmin && group.visibility === "private" ? group.id : undefined,
  );
  const revokeInvite = useRevokeGroupInvitation(group.id);

  const [inviteQuery, setInviteQuery] = useState("");
  const [debouncedInviteQuery, setDebouncedInviteQuery] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitedUsernames, setInvitedUsernames] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedInviteQuery(inviteQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [inviteQuery]);

  // Only friends can be invited, so the picker searches the friends list.
  const { data: friendsRaw } = useFriends();
  const searchResults = useMemo(() => {
    const q = debouncedInviteQuery.toLowerCase();
    if (!q) return [];
    return ((friendsRaw ?? []) as { friend: UserSearchResult }[])
      .map((f) => f.friend)
      .filter(
        (f) =>
          f.username?.toLowerCase().includes(q) ||
          f.display_name?.toLowerCase().includes(q),
      );
  }, [friendsRaw, debouncedInviteQuery]);

  // Pre-compute membership + pending sets to grey out already-handled users.
  const memberIds = useMemo(
    () => new Set(members.map((m: CommunityMember) => m.user.id)),
    [members],
  );
  const pendingIds = useMemo(
    () => new Set(pendingInvites.map((p) => p.user.id)),
    [pendingInvites],
  );

  async function sendInvite(username: string) {
    setInviteError(null);
    try {
      await invite.mutateAsync(username);
      setInvitedUsernames((prev) => new Set(prev).add(username));
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed.");
    }
  }

  if (isLoading) return <p className="text-neutral-500 text-sm">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && group.visibility === "private" && (
        <section>
          <p className="text-label font-medium text-neutral-300 mb-2">
            Invite friends to this group
          </p>
          <SearchField
            value={inviteQuery}
            onChange={(v) => {
              setInviteQuery(v);
              setInviteError(null);
            }}
            label="Search your friends"
            placeholder="Search your friends…"
            className="w-full"
          />
          {debouncedInviteQuery && searchResults.length === 0 && (
            <p className="text-neutral-500 text-xs mt-3">
              No friends match. You can only invite friends.
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-3 flex flex-col divide-y divide-neutral-800">
              {searchResults.map((u) => {
                const isMember = memberIds.has(u.id);
                const isPending = pendingIds.has(u.id) || invitedUsernames.has(u.username);
                const isSending =
                  invite.isPending && invite.variables === u.username;
                return (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 py-2"
                  >
                    <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-caption font-semibold text-neutral-200 shrink-0">
                      {(u.display_name?.[0] ?? u.username[0]).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-label font-medium text-white truncate">
                        {u.display_name || `@${u.username}`}
                      </div>
                      {u.display_name && (
                        <div className="text-caption text-neutral-500 truncate">
                          @{u.username}
                        </div>
                      )}
                    </div>
                    {isMember ? (
                      <span className="text-caption font-medium text-neutral-400 shrink-0">
                        Member
                      </span>
                    ) : isPending ? (
                      <span className="text-caption font-medium text-warning-400 shrink-0">
                        Invited
                      </span>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => sendInvite(u.username)}
                        disabled={isSending}
                        className="shrink-0"
                      >
                        {isSending ? "…" : "Invite"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {inviteError && <p className="text-error-400 text-xs mt-2">{inviteError}</p>}

          {pendingInvites.length > 0 && (
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <p className="text-label font-medium text-neutral-300 mb-2">
                Pending invitations ({pendingInvites.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {pendingInvites.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 py-1"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-label text-neutral-200 truncate">
                        {p.user.display_name || `@${p.user.username}`}
                      </div>
                      {p.user.display_name && (
                        <div className="text-caption text-neutral-500 truncate">
                          @{p.user.username}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeInvite.mutate(p.id)}
                      disabled={revokeInvite.isPending}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      <div className="border-y border-neutral-800 divide-y divide-neutral-800">
        {members.map((m: CommunityMember) => {
          const isSelf = m.user.id === viewerId;
          const label = m.user.display_name || `@${m.user.username}`;
          return (
            <div key={m.user.id} className="flex items-center gap-3 py-3">
              <div className="w-9 h-9 rounded-full bg-neutral-700 flex items-center justify-center text-sm font-semibold text-neutral-200 shrink-0">
                {(m.user.display_name?.[0] ?? m.user.username[0]).toUpperCase()}
              </div>
              <Link to={`/user/${m.user.username}`} className="flex-1 min-w-0 hover:text-primary-300">
                <div className="text-body font-medium text-white truncate">{label}</div>
                <div className="text-caption text-neutral-500 truncate">@{m.user.username}</div>
              </Link>
              <span
                className={`text-caption capitalize px-2 py-0.5 rounded ${
                  m.role === "owner"
                    ? "bg-warning-500/15 text-warning-400"
                    : m.role === "admin"
                      ? "bg-neutral-800 text-neutral-300"
                      : "text-neutral-500"
                }`}
              >
                {m.role}
              </span>
              {isOwner && !isSelf && m.role !== "owner" && (
                <div className="flex gap-1 ml-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      setRole.mutate({
                        userId: m.user.id,
                        role: m.role === "admin" ? "member" : "admin",
                      })
                    }
                  >
                    {m.role === "admin" ? "Demote" : "Promote"}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Remove ${label} from the group?`)) remove.mutate(m.user.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────

const SETTINGS_COLORS = [
  "#3b82f6", "#10b981", "#a855f7", "#ec4899",
  "#f97316", "#f59e0b", "#14b8a6", "#ef4444",
];

function SettingsTab({ group, onDeleted }: { group: Community; onDeleted: () => void }) {
  const update = useUpdateCommunity(group.id);
  const del = useDeleteCommunity();
  const isOwner = group.viewer_role === "owner";
  const navigate = useNavigate();

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(group.visibility);
  const [color, setColor] = useState(group.banner_color || SETTINGS_COLORS[0]);
  const [membersCanEdit, setMembersCanEdit] = useState(group.members_can_edit_media);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== group.name ||
    description.trim() !== (group.description ?? "") ||
    visibility !== group.visibility ||
    color !== (group.banner_color || SETTINGS_COLORS[0]) ||
    membersCanEdit !== group.members_can_edit_media;

  async function save() {
    setError(null);
    try {
      const updated = await update.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        visibility,
        banner_color: color,
        members_can_edit_media: membersCanEdit,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // If the slug changed (unlikely — slug is fixed after create), redirect
      if (updated.slug !== group.slug) navigate(`/groups/${updated.slug}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Permanently delete "${group.name}"? This cannot be undone.`)) return;
    await del.mutateAsync(group.id);
    onDeleted();
  }

  return (
    <div className="max-w-xl space-y-5">
      <label className="block">
        <span className="text-caption text-neutral-400 font-medium">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-control px-3 py-2.5 text-sm text-white outline-none focus:border-neutral-600"
        />
      </label>

      <label className="block">
        <span className="text-caption text-neutral-400 font-medium">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={1000}
          className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-control px-3 py-2.5 text-sm text-white outline-none focus:border-neutral-600 resize-none"
        />
      </label>

      <div>
        <span className="text-caption text-neutral-400 font-medium block mb-2">Visibility</span>
        <Segmented
          label="Visibility"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ]}
        />
        <p className="text-caption text-neutral-500 mt-1.5">
          {visibility === "public"
            ? "Anyone can find and join."
            : "Invite-only. Hidden from browse."}
        </p>
      </div>

      <div>
        <span className="text-caption text-neutral-400 font-medium block mb-2">Member permissions</span>
        <label className="flex items-start gap-3 p-3 rounded-control border border-neutral-700/50 hover:border-neutral-600 cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={membersCanEdit}
            onChange={(e) => setMembersCanEdit(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-primary-500"
          />
          <span className="flex-1">
            <span className="block text-sm text-white font-medium">
              Allow any member to add or remove titles
            </span>
            <span className="block text-caption text-neutral-500 mt-0.5">
              When off, only the owner and admins can manage the title list. Discussion posts are not affected.
            </span>
          </span>
        </label>
      </div>

      <div>
        <span className="text-caption text-neutral-400 font-medium block mb-2">Color</span>
        <div className="flex flex-wrap gap-2">
          {SETTINGS_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              style={{ backgroundColor: c }}
              className={cx(
                "w-7 h-7 rounded-full transition-all",
                focusRing,
                color === c
                  ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-900"
                  : "opacity-70 hover:opacity-100",
              )}
            />
          ))}
        </div>
      </div>

      {error && <p className="text-error-400 text-sm">{error}</p>}

      <Button
        variant="primary"
        onClick={save}
        disabled={!dirty || update.isPending || name.trim().length < 2}
        className="w-full"
      >
        {update.isPending ? "Saving…" : saved ? "Saved!" : "Save changes"}
      </Button>

      {isOwner && (
        <div className="pt-4 border-t border-neutral-800">
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={del.isPending}
            className="w-full"
          >
            {del.isPending ? "Deleting…" : "Delete group"}
          </Button>
        </div>
      )}
    </div>
  );
}
