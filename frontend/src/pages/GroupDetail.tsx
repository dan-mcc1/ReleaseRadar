import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
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
  useUpdateCommunity,
  useDeleteCommunity,
  type Community,
  type CommunityMember,
  type CommunityMediaItem,
  type CommunityPost as CommunityPostT,
  type CommunityReply as CommunityReplyT,
} from "../hooks/api/useCommunities";
import ReportModal from "../components/ReportModal";

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
  const [tab, setTab] = useState<Tab>("discussion");

  usePageTitle(group?.name);

  if (isLoading) {
    return <div className="px-6 lg:px-10 py-10 text-neutral-500 text-sm">Loading…</div>;
  }
  if (isError || !group) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-10">
          <p className="text-neutral-300 font-medium">Group not found.</p>
          <Link to="/groups" className="mt-2 inline-block text-sm text-primary-400 hover:text-primary-300">
            Browse groups →
          </Link>
        </div>
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
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-primary-500 text-white"
                : "border-transparent text-neutral-500 hover:text-neutral-200"
            }`}
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
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shrink-0"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}88)` }}
        >
          {group.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-white">
              {group.name}
            </h1>
            {group.visibility === "private" && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-full px-2 py-0.5">
                Private
              </span>
            )}
            {group.is_featured && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-2 py-0.5">
                Featured
              </span>
            )}
          </div>
          {group.description && (
            <p className="text-neutral-300 text-[14px] mt-2 max-w-2xl leading-relaxed">
              {group.description}
            </p>
          )}
          <p className="text-[11px] text-neutral-500 mt-3 font-mono tracking-[0.05em]">
            {group.member_count} {group.member_count === 1 ? "member" : "members"}
          </p>
        </div>
        {user && (
          <div className="shrink-0 flex items-center gap-2">
            {isMember ? (
              <button
                onClick={() => leave.mutate(group.id)}
                disabled={leave.isPending}
                className="text-sm font-medium text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-4 py-2 rounded-xl disabled:opacity-50"
              >
                {leave.isPending ? "Leaving…" : group.viewer_role === "owner" ? "Owner" : "Leave"}
              </button>
            ) : (
              group.visibility === "public" && (
                <button
                  onClick={() => join.mutate(group.id)}
                  disabled={join.isPending}
                  className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-xl disabled:opacity-50"
                >
                  {join.isPending ? "Joining…" : "Join group"}
                </button>
              )
            )}
            {canReport && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-transparent border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                  </svg>
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-1 w-40 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl z-30 overflow-hidden"
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
          </div>
        )}
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
          <div className="text-center py-12 bg-neutral-900/50 border border-neutral-800 rounded-2xl">
            <p className="text-neutral-300">No posts yet.</p>
            {!isMember && (
              <p className="text-sm text-neutral-500 mt-1">Join the group to start a discussion.</p>
            )}
          </div>
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
      <aside className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sticky top-24">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 mb-2">
          About this group
        </p>
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
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        maxLength={150}
        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600 mb-2"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Start a discussion…"
        rows={3}
        maxLength={5000}
        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600 resize-none"
      />
      {error && <p className="text-error-400 text-xs mt-2">{error}</p>}
      <div className="flex justify-between items-center mt-2">
        <span className="text-[11px] text-neutral-500">{body.length}/5000</span>
        <button
          onClick={submit}
          disabled={create.isPending || !body.trim()}
          className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg"
        >
          {create.isPending ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21s-7-4.5-9.5-9.05C.85 8.62 2.74 5 6.16 5c1.92 0 3.55 1.07 4.34 2.6C11.29 6.07 12.92 5 14.84 5c3.42 0 5.31 3.62 3.66 6.95C19 16.5 12 21 12 21z" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
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
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 relative">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title (optional)"
                maxLength={150}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600 mb-2"
              />
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600 resize-none"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditTitle(post.title ?? "");
                    setEditBody(post.body);
                  }}
                  className="text-xs text-neutral-400 hover:text-white px-3 py-1.5 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={update.isPending || !editBody.trim()}
                  className="text-xs font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
                >
                  {update.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : (
            <>
              {post.title && (
                <h3 className="text-[16px] font-semibold text-white mb-1 leading-tight">
                  {post.title}
                </h3>
              )}
              <p className="text-[13px] text-neutral-500 mb-2">
                {authorLabel} · {timeAgo(post.created_at)}
                {post.edited_at && <span className="text-neutral-600 italic"> · edited</span>}
              </p>
              <p className="text-[14px] text-neutral-200 whitespace-pre-wrap leading-snug">
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
                className="text-xs font-medium text-neutral-400 hover:text-white"
              >
                {post.reply_count} {post.reply_count === 1 ? "reply" : "replies"} {isOpen ? "▲" : "▼"}
              </button>
            </div>
          )}
        </div>
        {!editing && userId && (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 mt-1 w-36 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl z-10 overflow-hidden"
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
        <p className="text-[12px] text-neutral-500">
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
              className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-[13px] text-white outline-none focus:border-neutral-600 resize-none"
            />
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => {
                  setEditing(false);
                  setEditBody(reply.body);
                }}
                className="text-[11px] text-neutral-400 hover:text-white px-2 py-1 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={update.isPending || !editBody.trim()}
                className="text-[11px] font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-2 py-1 rounded-lg"
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <p className="text-[13.5px] text-neutral-200 whitespace-pre-wrap">{reply.body}</p>
        )}
        {!editing && (
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => userId && toggleLike.mutate(reply.id)}
              disabled={!userId}
              className={`flex items-center gap-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
                reply.viewer_liked ? "text-error-400" : "text-neutral-500 hover:text-neutral-200"
              }`}
            >
              <HeartIcon filled={reply.viewer_liked} />
              {reply.like_count}
            </button>
            {isAuthor && (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] text-neutral-500 hover:text-white"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => {
                  if (window.confirm("Delete this reply?")) del.mutate(reply.id);
                }}
                className="text-[11px] text-neutral-600 hover:text-error-400"
              >
                Delete
              </button>
            )}
            {!isAuthor && userId && (
              <button
                onClick={() => setShowReport(true)}
                className="text-[11px] text-neutral-600 hover:text-error-400"
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
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-neutral-600 resize-none"
          />
          <button
            onClick={submit}
            disabled={addReply.isPending || !body.trim()}
            className="text-xs font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg"
          >
            Reply
          </button>
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

  if (isLoading) return <p className="text-neutral-500 text-sm">Loading…</p>;
  const movies = media?.movies ?? [];
  const shows = media?.shows ?? [];
  const total = movies.length + shows.length;
  const canModerate = group.viewer_role === "owner" || group.viewer_role === "admin";
  const canEditMedia = group.viewer_can_edit_media;

  if (total === 0) {
    return (
      <div className="text-center py-12 bg-neutral-900/50 border border-neutral-800 rounded-2xl">
        <p className="text-neutral-300 font-medium">No titles attached yet.</p>
        {isMember ? (
          canEditMedia ? (
            <p className="text-sm text-neutral-500 mt-1">
              Add titles from any movie or show page (look for the "Add to group" button).
            </p>
          ) : (
            <p className="text-sm text-neutral-500 mt-1">
              Only the owner and admins can add titles to this group.
            </p>
          )
        ) : (
          <p className="text-sm text-neutral-500 mt-1">Join to start adding titles.</p>
        )}
      </div>
    );
  }

  function renderItem(item: CommunityMediaItem, type: "movie" | "tv") {
    const label = item.title ?? item.name ?? "";
    const fallback = type === "movie" ? "/movie-icon.png" : "/tv-icon.png";
    // Owners/admins can always remove. Members can only remove what they added,
    // unless members_can_edit_media is on (then they can remove anything).
    const canRemove =
      canModerate ||
      (group.members_can_edit_media && isMember) ||
      (item.added_by === userId && isMember);
    return (
      <div key={item.id} className="group relative">
        <Link to={type === "movie" ? `/movie/${item.content_id}` : `/tv/${item.content_id}`}>
          <div className="aspect-[2/3] rounded-xl overflow-hidden bg-neutral-800">
            <img
              src={item.poster_path ? `${BASE_IMAGE_URL}/w342${item.poster_path}` : fallback}
              alt={label}
              loading="lazy"
              className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
            />
          </div>
          <p className="mt-1.5 text-[12px] font-medium text-neutral-300 text-center line-clamp-1">
            {label}
          </p>
        </Link>
        {canRemove && (
          <button
            onClick={() => {
              if (window.confirm("Remove this title from the group?")) removeMedia.mutate(item.id);
            }}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
            title="Remove"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {shows.length > 0 && (
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 mb-3">
            TV Shows · {shows.length}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3">
            {shows.map((s) => renderItem(s, "tv"))}
          </div>
        </section>
      )}
      {movies.length > 0 && (
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 mb-3">
            Movies · {movies.length}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3">
            {movies.map((m) => renderItem(m, "movie"))}
          </div>
        </section>
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
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  async function submitInvite() {
    setInviteError(null);
    try {
      await invite.mutateAsync(inviteUsername.trim());
      setInviteUsername("");
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed.");
    }
  }

  if (isLoading) return <p className="text-neutral-500 text-sm">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && group.visibility === "private" && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <p className="text-[12px] font-medium text-neutral-300 mb-2">
            Invite a member by @username
          </p>
          <div className="flex gap-2">
            <input
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              placeholder="username"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600"
            />
            <button
              onClick={submitInvite}
              disabled={invite.isPending || !inviteUsername.trim()}
              className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 rounded-xl"
            >
              Invite
            </button>
          </div>
          {inviteError && <p className="text-error-400 text-xs mt-2">{inviteError}</p>}
        </div>
      )}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl divide-y divide-neutral-800">
        {members.map((m: CommunityMember) => {
          const isSelf = m.user.id === viewerId;
          const label = m.user.display_name || `@${m.user.username}`;
          return (
            <div key={m.user.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-neutral-700 flex items-center justify-center text-sm font-semibold text-neutral-200 shrink-0">
                {(m.user.display_name?.[0] ?? m.user.username[0]).toUpperCase()}
              </div>
              <Link to={`/user/${m.user.username}`} className="flex-1 min-w-0 hover:text-primary-300">
                <div className="text-[14px] font-medium text-white truncate">{label}</div>
                <div className="text-[11.5px] text-neutral-500 truncate">@{m.user.username}</div>
              </Link>
              <span
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${
                  m.role === "owner"
                    ? "bg-amber-500/15 text-amber-400"
                    : m.role === "admin"
                      ? "bg-primary-500/15 text-primary-400"
                      : "text-neutral-500"
                }`}
              >
                {m.role}
              </span>
              {isOwner && !isSelf && m.role !== "owner" && (
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={() =>
                      setRole.mutate({
                        userId: m.user.id,
                        role: m.role === "admin" ? "member" : "admin",
                      })
                    }
                    className="text-[11px] text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-600 px-2 py-0.5 rounded"
                  >
                    {m.role === "admin" ? "Demote" : "Promote"}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove ${label} from the group?`)) remove.mutate(m.user.id);
                    }}
                    className="text-[11px] text-error-400 hover:text-error-300 border border-neutral-700 hover:border-neutral-600 px-2 py-0.5 rounded"
                  >
                    Remove
                  </button>
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
    <div className="max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-5">
      <label className="block">
        <span className="text-[12px] text-neutral-400 font-medium">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-neutral-600"
        />
      </label>

      <label className="block">
        <span className="text-[12px] text-neutral-400 font-medium">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={1000}
          className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-neutral-600 resize-none"
        />
      </label>

      <div>
        <span className="text-[12px] text-neutral-400 font-medium block mb-2">Visibility</span>
        <div className="grid grid-cols-2 gap-2">
          {(["public", "private"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                visibility === v
                  ? "border-primary-500/50 bg-primary-600/10 text-white"
                  : "border-neutral-700/50 text-neutral-300 hover:border-neutral-600"
              }`}
            >
              {v === "public" ? "Public" : "Private"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500 mt-1.5">
          {visibility === "public"
            ? "Anyone can find and join."
            : "Invite-only. Hidden from browse."}
        </p>
      </div>

      <div>
        <span className="text-[12px] text-neutral-400 font-medium block mb-2">Member permissions</span>
        <label className="flex items-start gap-3 p-3 rounded-xl border border-neutral-700/50 hover:border-neutral-600 cursor-pointer transition-colors">
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
            <span className="block text-[11px] text-neutral-500 mt-0.5">
              When off, only the owner and admins can manage the title list. Discussion posts are not affected.
            </span>
          </span>
        </label>
      </div>

      <div>
        <span className="text-[12px] text-neutral-400 font-medium block mb-2">Color</span>
        <div className="flex flex-wrap gap-2">
          {SETTINGS_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`w-7 h-7 rounded-full transition-all ${
                color === c
                  ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-900"
                  : "opacity-70 hover:opacity-100"
              }`}
            />
          ))}
        </div>
      </div>

      {error && <p className="text-error-400 text-sm">{error}</p>}

      <button
        onClick={save}
        disabled={!dirty || update.isPending || name.trim().length < 2}
        className="w-full bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white py-2.5 rounded-xl font-medium text-sm"
      >
        {update.isPending ? "Saving…" : saved ? "Saved!" : "Save changes"}
      </button>

      {isOwner && (
        <div className="pt-4 border-t border-neutral-800">
          <button
            onClick={handleDelete}
            disabled={del.isPending}
            className="w-full bg-error-500/10 hover:bg-error-500/20 text-error-400 border border-error-500/25 py-2.5 rounded-xl font-medium text-sm"
          >
            {del.isPending ? "Deleting…" : "Delete group"}
          </button>
        </div>
      )}
    </div>
  );
}
