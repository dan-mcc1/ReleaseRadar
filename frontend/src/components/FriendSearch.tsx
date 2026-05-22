import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useFriendSearch, useFriendSuggestions, useSendFriendRequest } from "../hooks/api/useFriends";

interface SearchResult {
  id: string;
  username: string;
  profile_visibility: "public" | "friends_only" | "private";
  mutual_friends?: number;
  reason?: "mutual_friends" | "popular";
}

interface Props {
  onRequestSent: () => void;
  friendIds?: Set<string>;
}

const MAX_MESSAGE_LENGTH = 200;

const visibilityMeta = {
  public:       { label: "PUBLIC",       color: "#34d399", icon: "◉" },
  friends_only: { label: "FRIENDS ONLY", color: "#fbbf24", icon: "◐" },
  private:      { label: "PRIVATE",      color: "#a3a3a3", icon: "○" },
};

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const hue = hashHue(name);
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: `oklch(0.32 0.10 ${hue})`,
        color: `oklch(0.88 0.08 ${hue})`,
        fontSize: size * 0.38, fontWeight: 600, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        letterSpacing: "0.02em",
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

type Filter = "all" | "public" | "friends_only" | "connected";

export default function FriendSearch({ onRequestSent, friendIds }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [followedTo, setFollowedTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [composingFor, setComposingFor] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] } = useFriendSearch(debouncedQuery);
  const { data: suggestionsRaw = [] } = useFriendSuggestions();
  const sendMutation = useSendFriendRequest();
  const typedResults = results as SearchResult[];
  const suggestions = suggestionsRaw as SearchResult[];

  const filtered = typedResults.filter((u) => {
    if (filter === "public") return u.profile_visibility === "public";
    if (filter === "friends_only") return u.profile_visibility === "friends_only";
    if (filter === "connected") return friendIds?.has(u.id) || sentTo.has(u.username) || followedTo.has(u.username);
    return true;
  });

  const filterCounts = {
    all: typedResults.length,
    public: typedResults.filter((u) => u.profile_visibility === "public").length,
    friends_only: typedResults.filter((u) => u.profile_visibility === "friends_only").length,
    connected: typedResults.filter((u) => friendIds?.has(u.id) || sentTo.has(u.username) || followedTo.has(u.username)).length,
  };

  async function sendRequest(user: SearchResult, msg?: string) {
    setError(null);
    try {
      const data = await sendMutation.mutateAsync({
        addresseeUsername: user.username,
        message: msg?.trim() || undefined,
      });
      if (data.status === "following") {
        setFollowedTo((prev) => new Set(prev).add(user.username));
      } else {
        setSentTo((prev) => new Set(prev).add(user.username));
      }
      setComposingFor(null);
      setMessage("");
      onRequestSent();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not send request.");
    }
  }

  function startComposing(user: SearchResult) {
    setComposingFor(user);
    setMessage("");
    setError(null);
  }

  function cancelComposing() {
    setComposingFor(null);
    setMessage("");
    setError(null);
  }

  return (
    <div>
      {/* Search bar */}
      <div className="mb-5">
        <div
          className="flex items-center gap-3 bg-neutral-900 border border-neutral-700 rounded-xl px-4"
          style={{ height: 56, boxShadow: "0 0 0 3px oklch(0.50 0.15 155 / 0.14)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-500 shrink-0">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            placeholder="Search by username…"
            className="flex-1 bg-transparent text-neutral-100 placeholder-neutral-500 outline-none tracking-tight"
            style={{ fontSize: 17 }}
          />
          {debouncedQuery.trim() && (
            <span
              className="font-mono text-[11px] text-neutral-500 px-2 py-0.5 border border-neutral-700 rounded shrink-0"
              style={{ letterSpacing: "0.04em" }}
            >
              {filtered.length} RESULTS
            </span>
          )}
          {query && (
            <button
              onClick={() => { setQuery(""); setDebouncedQuery(""); setFilter("all"); }}
              className="w-7 h-7 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-500 flex items-center justify-center hover:text-neutral-300 transition-colors shrink-0"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        {debouncedQuery.trim() && (
          <div
            className="mt-2.5 font-mono text-[10.5px] text-neutral-500 flex items-center gap-3"
            style={{ letterSpacing: "0.05em" }}
          >
            <span>
              {typedResults.length} MATCH{typedResults.length !== 1 ? "ES" : ""} FOR{" "}
              <span className="text-neutral-300">"{debouncedQuery}"</span>
            </span>
            <span className="text-neutral-700">·</span>
            <span>CASE-INSENSITIVE · PARTIAL MATCH</span>
          </div>
        )}
      </div>

      {/* Filter chips */}
      {typedResults.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap items-center">
          <span className="font-mono text-[10.5px] text-neutral-500 tracking-[0.1em] uppercase mr-1">Filter:</span>
          {(
            [
              { key: "all" as Filter,          label: "All" },
              { key: "public" as Filter,        label: "Public" },
              { key: "friends_only" as Filter,  label: "Friends only" },
              { key: "connected" as Filter,     label: "Already connected" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={[
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium border transition-colors",
                filter === key
                  ? "text-primary-400 bg-primary-500/10 border-transparent"
                  : "text-neutral-400 bg-neutral-900 border-neutral-700 hover:text-neutral-200 hover:border-neutral-600",
              ].join(" ")}
            >
              {label}
              <span className={["font-mono text-[10px]", filter === key ? "text-primary-400" : "text-neutral-600"].join(" ")}>
                {filterCounts[key]}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-error-500 text-sm mb-3">{error}</p>}

      {/* Result rows */}
      {filtered.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {filtered.map((user) => {
            const vm = visibilityMeta[user.profile_visibility];
            const isAlreadyFriend = friendIds?.has(user.id);
            const hasSent = sentTo.has(user.username);
            const isFollowing = followedTo.has(user.username);
            const isComposing = composingFor?.id === user.id;
            const isPrivate = user.profile_visibility === "private";
            const isPending = sendMutation.isPending && sendMutation.variables?.addresseeUsername === user.username;

            return (
              <div
                key={user.id}
                className="bg-neutral-900 rounded-xl overflow-hidden border transition-colors"
                style={{ borderColor: isComposing ? "#404040" : "#262626" }}
              >
                {/* Main row */}
                <div
                  className="grid items-center gap-3.5 px-4 py-3.5"
                  style={{ gridTemplateColumns: "auto 1fr auto" }}
                >
                  <Avatar name={user.username} size={44} />

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/user/${user.username}`}
                        className="text-[15px] font-semibold text-neutral-100 hover:text-primary-400 transition-colors tracking-tight"
                      >
                        @{user.username}
                      </Link>
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono font-semibold"
                        style={{
                          fontSize: 9.5, color: vm.color,
                          background: `${vm.color}1a`, letterSpacing: "0.06em",
                        }}
                      >
                        {vm.icon} {vm.label}
                      </span>
                    </div>
                  </div>

                  {/* Action */}
                  {isPrivate ? (
                    <span className="text-[12px] text-neutral-500 italic shrink-0">Private profile</span>
                  ) : isAlreadyFriend ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-primary-400 bg-primary-500/10 rounded-lg shrink-0">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Already friends
                    </span>
                  ) : isFollowing ? (
                    <span className="font-mono text-[10.5px] text-primary-400 shrink-0" style={{ letterSpacing: "0.06em" }}>
                      ● FOLLOWING
                    </span>
                  ) : hasSent ? (
                    <span className="font-mono text-[10.5px] text-warning-400 shrink-0" style={{ letterSpacing: "0.06em" }}>
                      ● REQUEST SENT
                    </span>
                  ) : isComposing ? (
                    <button
                      onClick={cancelComposing}
                      className="text-[12px] text-neutral-500 hover:text-neutral-300 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        user.profile_visibility === "public"
                          ? sendRequest(user)
                          : startComposing(user)
                      }
                      disabled={isPending}
                      className={[
                        "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-semibold rounded-lg transition-colors disabled:opacity-50 shrink-0",
                        user.profile_visibility === "public"
                          ? "bg-primary-500 hover:bg-primary-400 text-neutral-900"
                          : "bg-transparent border border-neutral-600 text-neutral-200 hover:border-neutral-400",
                      ].join(" ")}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      {isPending ? "Sending…" : user.profile_visibility === "public" ? "Follow" : "Add friend"}
                    </button>
                  )}
                </div>

                {/* Compose panel */}
                {isComposing && (
                  <div className="px-4 pb-4 pt-3.5 border-t border-neutral-800 bg-neutral-950">
                    <div
                      className="font-mono text-[10px] text-neutral-500 uppercase mb-2"
                      style={{ letterSpacing: "0.12em" }}
                    >
                      Send @{user.username} a friend request
                    </div>
                    <textarea
                      autoFocus
                      value={message}
                      onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                      placeholder="Add a short message… (optional)"
                      rows={2}
                      className="w-full px-3 py-2.5 text-[13px] text-neutral-100 placeholder-neutral-500 bg-neutral-900 border border-neutral-700 rounded-lg outline-none resize-none leading-snug focus:border-neutral-500 transition-colors"
                    />
                    <div className="flex items-center gap-2.5 mt-2">
                      <span className="font-mono text-[10.5px] text-neutral-500" style={{ letterSpacing: "0.04em" }}>
                        {message.length} / {MAX_MESSAGE_LENGTH}
                      </span>
                      <span className="flex-1" />
                      <button
                        onClick={cancelComposing}
                        className="text-[12px] text-neutral-500 hover:text-neutral-300 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => sendRequest(user, message)}
                        disabled={sendMutation.isPending}
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-neutral-900 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                        {sendMutation.isPending ? "Sending…" : "Send request"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Suggestions (shown when not searching) */}
      {!debouncedQuery.trim() && suggestions.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[10px] text-neutral-500 tracking-[0.12em] uppercase">
              People you may know
            </span>
            <div className="flex-1 h-px bg-neutral-800" />
          </div>
          <div className="flex flex-col gap-2.5">
            {suggestions.map((user) => {
              const vm = visibilityMeta[user.profile_visibility];
              const isAlreadyFriend = friendIds?.has(user.id);
              const hasSent = sentTo.has(user.username);
              const isFollowing = followedTo.has(user.username);
              const isComposing = composingFor?.id === user.id;
              const isPrivate = user.profile_visibility === "private";
              const isPending = sendMutation.isPending && sendMutation.variables?.addresseeUsername === user.username;

              return (
                <div
                  key={user.id}
                  className="bg-neutral-900 rounded-xl overflow-hidden border transition-colors"
                  style={{ borderColor: isComposing ? "#404040" : "#262626" }}
                >
                  <div
                    className="grid items-center gap-3.5 px-4 py-3.5"
                    style={{ gridTemplateColumns: "auto 1fr auto" }}
                  >
                    <Avatar name={user.username} size={44} />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/user/${user.username}`}
                          className="text-[15px] font-semibold text-neutral-100 hover:text-primary-400 transition-colors tracking-tight"
                        >
                          @{user.username}
                        </Link>
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono font-semibold"
                          style={{
                            fontSize: 9.5, color: vm.color,
                            background: `${vm.color}1a`, letterSpacing: "0.06em",
                          }}
                        >
                          {vm.icon} {vm.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {user.reason === "mutual_friends" && user.mutual_friends! > 0 ? (
                          <span className="font-mono text-[10px] text-primary-400/80" style={{ letterSpacing: "0.05em" }}>
                            ◉ {user.mutual_friends} mutual {user.mutual_friends === 1 ? "friend" : "friends"}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-neutral-500" style={{ letterSpacing: "0.05em" }}>
                            ◎ Popular on ReleaseRadar
                          </span>
                        )}
                      </div>
                    </div>

                    {isPrivate ? (
                      <span className="text-[12px] text-neutral-500 italic shrink-0">Private</span>
                    ) : isAlreadyFriend ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-primary-400 bg-primary-500/10 rounded-lg shrink-0">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Friends
                      </span>
                    ) : isFollowing ? (
                      <span className="font-mono text-[10.5px] text-primary-400 shrink-0" style={{ letterSpacing: "0.06em" }}>
                        ● FOLLOWING
                      </span>
                    ) : hasSent ? (
                      <span className="font-mono text-[10.5px] text-warning-400 shrink-0" style={{ letterSpacing: "0.06em" }}>
                        ● SENT
                      </span>
                    ) : isComposing ? (
                      <button
                        onClick={cancelComposing}
                        className="text-[12px] text-neutral-500 hover:text-neutral-300 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          user.profile_visibility === "public"
                            ? sendRequest(user)
                            : startComposing(user)
                        }
                        disabled={isPending}
                        className={[
                          "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-semibold rounded-lg transition-colors disabled:opacity-50 shrink-0",
                          user.profile_visibility === "public"
                            ? "bg-primary-500 hover:bg-primary-400 text-neutral-900"
                            : "bg-transparent border border-neutral-600 text-neutral-200 hover:border-neutral-400",
                        ].join(" ")}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        {isPending ? "Sending…" : user.profile_visibility === "public" ? "Follow" : "Add friend"}
                      </button>
                    )}
                  </div>

                  {isComposing && (
                    <div className="px-4 pb-4 pt-3.5 border-t border-neutral-800 bg-neutral-950">
                      <div
                        className="font-mono text-[10px] text-neutral-500 uppercase mb-2"
                        style={{ letterSpacing: "0.12em" }}
                      >
                        Send @{user.username} a friend request
                      </div>
                      <textarea
                        autoFocus
                        value={message}
                        onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                        placeholder="Add a short message… (optional)"
                        rows={2}
                        className="w-full px-3 py-2.5 text-[13px] text-neutral-100 placeholder-neutral-500 bg-neutral-900 border border-neutral-700 rounded-lg outline-none resize-none leading-snug focus:border-neutral-500 transition-colors"
                      />
                      <div className="flex items-center gap-2.5 mt-2">
                        <span className="font-mono text-[10.5px] text-neutral-500" style={{ letterSpacing: "0.04em" }}>
                          {message.length} / {MAX_MESSAGE_LENGTH}
                        </span>
                        <span className="flex-1" />
                        <button
                          onClick={cancelComposing}
                          className="text-[12px] text-neutral-500 hover:text-neutral-300 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => sendRequest(user, message)}
                          disabled={sendMutation.isPending}
                          className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-neutral-900 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                          {sendMutation.isPending ? "Sending…" : "Send request"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {debouncedQuery.trim() && typedResults.length === 0 && (
        <p className="text-neutral-500 text-[14px] mt-2">No users found.</p>
      )}

      {/* About visibility tip */}
      {typedResults.length > 0 && (
        <div className="mt-4 flex items-start gap-3 p-4 bg-neutral-900 border border-neutral-800 rounded-xl">
          <span className="text-primary-400 text-[14px] mt-0.5">◉</span>
          <div>
            <div className="text-[12.5px] font-semibold mb-1">About visibility</div>
            <div className="text-[12px] text-neutral-400 leading-relaxed">
              <strong className="text-neutral-200 font-semibold">Public</strong> profiles can be followed instantly.{" "}
              <strong className="text-neutral-200 font-semibold">Friends-only</strong> profiles require a request — you can include a short message.{" "}
              <strong className="text-neutral-200 font-semibold">Private</strong> profiles are not searchable except by exact handle.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
