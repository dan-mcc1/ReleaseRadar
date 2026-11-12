import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useFriendSearch, useFriendSuggestions, useSendFriendRequest } from "../hooks/api/useFriends";
import { Button, Chip, CheckIcon, EmptyState, PlusIcon, SearchField, SectionHeader } from "./ui";
import { ArrowRightIcon } from "@heroicons/react/24/outline";

interface SearchResult {
  id: string;
  username: string;
  display_name: string | null;
  profile_visibility: "public" | "friends_only" | "private";
  mutual_friends?: number;
  reason?: "mutual_friends" | "popular";
}

interface Props {
  onRequestSent: () => void;
  friendIds?: Set<string>;
}

const MAX_MESSAGE_LENGTH = 200;

const visibilityLabel = {
  public: "Public",
  friends_only: "Friends only",
  private: "Private",
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

  // One person in the results or in the suggestions. Suggestions show the
  // @handle only and say why the person was suggested.
  function renderRow(user: SearchResult, suggestion: boolean) {
    const isAlreadyFriend = friendIds?.has(user.id);
    const hasSent = sentTo.has(user.username);
    const isFollowing = followedTo.has(user.username);
    const isComposing = composingFor?.id === user.id;
    const isPrivate = user.profile_visibility === "private";
    const isPending = sendMutation.isPending && sendMutation.variables?.addresseeUsername === user.username;
    const showName = !suggestion && user.display_name;

    return (
      <div
        key={user.id}
        className={`bg-neutral-900 rounded-control overflow-hidden border transition-colors ${
          isComposing ? "border-neutral-600" : "border-neutral-800"
        }`}
      >
        {/* Main row */}
        <div
          className="grid items-center gap-3.5 px-4 py-3.5"
          style={{ gridTemplateColumns: "auto 1fr auto" }}
        >
          <Avatar name={suggestion ? user.username : user.display_name || user.username} size={44} />

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/user/${user.username}`}
                className="text-body font-semibold text-neutral-100 hover:text-primary-300 transition-colors"
              >
                {suggestion ? `@${user.username}` : user.display_name || `@${user.username}`}
              </Link>
              {showName && (
                <span className="text-caption text-neutral-500">@{user.username}</span>
              )}
              <span className="text-caption text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded">
                {visibilityLabel[user.profile_visibility]}
              </span>
            </div>
            {suggestion && (
              <div className="mt-1 text-caption text-neutral-500">
                {user.reason === "mutual_friends" && user.mutual_friends! > 0
                  ? `${user.mutual_friends} mutual ${user.mutual_friends === 1 ? "friend" : "friends"}`
                  : "Popular on ReleaseRadar"}
              </div>
            )}
          </div>

          {/* Action */}
          {isPrivate ? (
            <span className="text-caption text-neutral-500 italic shrink-0">
              {suggestion ? "Private" : "Private profile"}
            </span>
          ) : isAlreadyFriend ? (
            <span className="inline-flex items-center gap-1.5 text-caption font-medium text-neutral-300 shrink-0">
              <CheckIcon className="w-3.5 h-3.5" />
              {suggestion ? "Friends" : "Already friends"}
            </span>
          ) : isFollowing ? (
            <span className="inline-flex items-center gap-1.5 text-caption font-medium text-primary-400 shrink-0">
              <CheckIcon className="w-3.5 h-3.5" />
              Following
            </span>
          ) : hasSent ? (
            <span className="text-caption font-medium text-warning-400 shrink-0">
              {suggestion ? "Sent" : "Request sent"}
            </span>
          ) : isComposing ? (
            <Button size="sm" onClick={cancelComposing} className="shrink-0">
              Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<PlusIcon className="w-3.5 h-3.5" />}
              onClick={() =>
                user.profile_visibility === "public"
                  ? sendRequest(user)
                  : startComposing(user)
              }
              disabled={isPending}
              className="shrink-0"
            >
              {isPending ? "Sending…" : user.profile_visibility === "public" ? "Follow" : "Add friend"}
            </Button>
          )}
        </div>

        {/* Compose panel */}
        {isComposing && (
          <div className="px-4 pb-4 pt-3.5 border-t border-neutral-800 bg-neutral-950">
            <div className="text-caption text-neutral-400 mb-2">
              Send @{user.username} a friend request
            </div>
            <textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              placeholder="Add a short message… (optional)"
              rows={2}
              aria-label={`Message to @${user.username}`}
              className="w-full px-3 py-2.5 text-label text-neutral-100 placeholder-neutral-500 bg-neutral-900 border border-neutral-700 rounded-control focus:outline-none resize-none leading-snug focus:border-neutral-400 transition-colors"
            />
            <div className="flex items-center gap-2.5 mt-2">
              <span className="text-caption text-neutral-500 tabular">
                {message.length} / {MAX_MESSAGE_LENGTH}
              </span>
              <span className="flex-1" />
              <Button size="sm" onClick={cancelComposing}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<ArrowRightIcon className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />}
                onClick={() => sendRequest(user, message)}
                disabled={sendMutation.isPending}
              >
                {sendMutation.isPending ? "Sending…" : "Send request"}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Search bar */}
      <div className="mb-5">
        <SearchField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setError(null);
            if (!v) {
              setDebouncedQuery("");
              setFilter("all");
            }
          }}
          label="Search by username"
          placeholder="Search by username…"
          className="w-full"
        />

        {debouncedQuery.trim().length >= 2 && (
          <div className="mt-2.5 text-caption text-neutral-500 flex items-center gap-3">
            <span>
              {typedResults.length} match{typedResults.length !== 1 ? "es" : ""} for{" "}
              <span className="text-neutral-300">"{debouncedQuery}"</span>
            </span>
            <span className="text-neutral-700">·</span>
            <span>
              Case-insensitive ·{" "}
              {debouncedQuery.trim().length < 3 ? "starts with" : "partial match"}
            </span>
          </div>
        )}
      </div>

      {/* Filter chips */}
      {typedResults.length > 0 && (
        <div role="group" aria-label="Filter results" className="flex gap-2 mb-5 flex-wrap items-center">
          {(
            [
              { key: "all" as Filter,          label: "All" },
              { key: "public" as Filter,        label: "Public" },
              { key: "friends_only" as Filter,  label: "Friends only" },
              { key: "connected" as Filter,     label: "Already connected" },
            ] as const
          ).map(({ key, label }) => (
            <Chip
              key={key}
              pressed={filter === key}
              count={filterCounts[key]}
              onClick={() => setFilter(key)}
            >
              {label}
            </Chip>
          ))}
        </div>
      )}

      {error && <p className="text-error-500 text-sm mb-3">{error}</p>}

      {/* Result rows */}
      {filtered.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {filtered.map((user) => renderRow(user, false))}
        </div>
      )}

      {/* Suggestions (shown when not searching) */}
      {!debouncedQuery.trim() && suggestions.length > 0 && (
        <div className="mt-2">
          <SectionHeader title="People you may know" as="h3" divider className="mb-4" />
          <div className="flex flex-col gap-2.5">
            {suggestions.map((user) => renderRow(user, true))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {debouncedQuery.trim() &&
        typedResults.length === 0 &&
        (debouncedQuery.trim().length < 2 ? (
          <p className="text-neutral-500 text-body mt-2">Type at least 2 characters.</p>
        ) : (
          <EmptyState
            className="py-10"
            title="No users found"
            description="Check the spelling or try a shorter username."
          />
        ))}

      {/* About visibility tip */}
      {typedResults.length > 0 && (
        <p className="mt-5 text-caption text-neutral-400 leading-relaxed">
          <strong className="text-neutral-200 font-semibold">Public</strong> profiles can be followed instantly.{" "}
          <strong className="text-neutral-200 font-semibold">Friends-only</strong> profiles require a request — you can include a short message.{" "}
          <strong className="text-neutral-200 font-semibold">Private</strong> profiles are not searchable except by exact handle.
        </p>
      )}
    </div>
  );
}
