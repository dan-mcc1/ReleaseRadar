import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useFriendSearch, useSendFriendRequest } from "../hooks/api/useFriends";

interface SearchResult {
  id: string;
  username: string;
  profile_visibility: "public" | "friends_only" | "private";
}

interface Props {
  onRequestSent: () => void;
  friendIds?: Set<string>;
}

const MAX_MESSAGE_LENGTH = 200;

export default function FriendSearch({ onRequestSent, friendIds }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [followedTo, setFollowedTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [composingFor, setComposingFor] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] } = useFriendSearch(debouncedQuery);
  const sendMutation = useSendFriendRequest();

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
      setError(
        e instanceof Error && e.message ? e.message : "Could not send request.",
      );
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

  const typedResults = results as SearchResult[];

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        placeholder="Search by username…"
        className="w-full bg-neutral-700 text-neutral-100 placeholder-neutral-400 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
      />

      {error && <p className="text-error-500 text-sm mt-2">{error}</p>}

      {typedResults.length > 0 && (
        <ul className="mt-2 space-y-1">
          {typedResults.map((user) => (
            <li key={user.id} className="bg-neutral-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2">
                <Link
                  to={`/user/${user.username}`}
                  className="text-neutral-100 font-medium hover:text-primary-400 transition-colors"
                >
                  <span>@{user.username}</span>
                </Link>
                {friendIds?.has(user.id) ? (
                  <span className="text-neutral-400 text-sm">Already friends</span>
                ) : followedTo.has(user.username) ? (
                  <span className="text-success-400 text-sm">Following</span>
                ) : sentTo.has(user.username) ? (
                  <span className="text-success-400 text-sm">Request sent</span>
                ) : composingFor?.id === user.id ? (
                  <button
                    onClick={cancelComposing}
                    className="text-sm text-neutral-400 hover:text-neutral-200"
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
                    disabled={
                      sendMutation.isPending &&
                      sendMutation.variables?.addresseeUsername === user.username
                    }
                    className="text-sm bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1 rounded"
                  >
                    {sendMutation.isPending &&
                    sendMutation.variables?.addresseeUsername === user.username
                      ? "Sending…"
                      : user.profile_visibility === "public"
                        ? "Follow"
                        : "Add Friend"}
                  </button>
                )}
              </div>

              {composingFor?.id === user.id && (
                <div className="px-3 pb-3 space-y-2 border-t border-neutral-600">
                  <textarea
                    autoFocus
                    value={message}
                    onChange={(e) =>
                      setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))
                    }
                    placeholder="Add a message… (optional)"
                    rows={2}
                    className="w-full mt-2 bg-neutral-600 text-neutral-100 placeholder-neutral-400 px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">
                      {message.length}/{MAX_MESSAGE_LENGTH}
                    </span>
                    <button
                      onClick={() => sendRequest(user, message)}
                      disabled={sendMutation.isPending}
                      className="text-sm bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1 rounded"
                    >
                      {sendMutation.isPending ? "Sending…" : "Send Request"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {query.trim().length > 0 && typedResults.length === 0 && (
        <p className="text-neutral-400 text-sm mt-2">No users found.</p>
      )}
    </div>
  );
}
