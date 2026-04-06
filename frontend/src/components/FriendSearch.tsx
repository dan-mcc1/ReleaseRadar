import { useState, useRef } from "react";
import { API_URL } from "../constants";
import { Link } from "react-router-dom";

interface SearchResult {
  id: string;
  username: string;
  profile_visibility: "public" | "friends_only" | "private";
}

interface Props {
  token: string;
  onRequestSent: () => void;
  friendIds?: Set<string>;
}

export default function FriendSearch({
  token,
  onRequestSent,
  friendIds,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [sending, setSending] = useState<string | null>(null); // username being sent to
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [followedTo, setFollowedTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQuery(value);
    setError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length === 0) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/friends/search?q=${encodeURIComponent(value.trim())}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (res.ok) {
          setResults(await res.json());
        }
      } catch {
        // silently ignore search errors
      }
    }, 300);
  }

  async function sendRequest(user: SearchResult) {
    setSending(user.username);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/friends/request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ addressee_username: user.username }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "following") {
          setFollowedTo((prev) => new Set(prev).add(user.username));
        } else {
          setSentTo((prev) => new Set(prev).add(user.username));
        }
        onRequestSent();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? "Could not send request.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(null);
    }
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={handleQueryChange}
        placeholder="Search by username…"
        className="w-full bg-neutral-700 text-neutral-100 placeholder-neutral-400 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
      />

      {error && <p className="text-error-500 text-sm mt-2">{error}</p>}

      {results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((user) => (
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
                  disabled={sending === user.username}
                  className="text-sm bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1 rounded"
                >
                  {sending === user.username
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

      {query.trim().length > 0 && results.length === 0 && (
        <p className="text-neutral-400 text-sm mt-2">No users found.</p>
      )}
    </div>
  );
}
