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

export default function FriendSearch({ onRequestSent, friendIds }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [followedTo, setFollowedTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] } = useFriendSearch(debouncedQuery);
  const sendMutation = useSendFriendRequest();

  async function sendRequest(user: SearchResult) {
    setError(null);
    try {
      const data = await sendMutation.mutateAsync(user.username);
      if (data.status === "following") {
        setFollowedTo((prev) => new Set(prev).add(user.username));
      } else {
        setSentTo((prev) => new Set(prev).add(user.username));
      }
      onRequestSent();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Could not send request.",
      );
    }
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
            <li
              key={user.id}
              className="flex items-center justify-between bg-neutral-700 px-3 py-2 rounded-lg"
            >
              <Link
                to={`/user/${user.username}`}
                className="text-neutral-100 font-medium hover:text-primary-400 transition-colors"
              >
                <span>@{user.username}</span>
              </Link>
              {friendIds?.has(user.id) ? (
                <span className="text-neutral-400 text-sm">
                  Already friends
                </span>
              ) : followedTo.has(user.username) ? (
                <span className="text-success-400 text-sm">Following</span>
              ) : sentTo.has(user.username) ? (
                <span className="text-success-400 text-sm">Request sent</span>
              ) : (
                <button
                  onClick={() => sendRequest(user)}
                  disabled={
                    sendMutation.isPending &&
                    sendMutation.variables === user.username
                  }
                  className="text-sm bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1 rounded"
                >
                  {sendMutation.isPending &&
                  sendMutation.variables === user.username
                    ? "Sending…"
                    : user.profile_visibility === "public"
                      ? "Follow"
                      : "Add Friend"}
                </button>
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
