import { useState } from "react";
import { Link } from "react-router-dom";
import { API_URL } from "../constants";

interface Friend {
  id: string;
  username: string;
  email: string;
}

interface FriendEntry {
  friendship_id: number;
  friend: Friend;
}

interface Props {
  token: string;
  friends: FriendEntry[];
  onFriendRemoved: (friendId: string) => void;
}

export default function FriendsList({ token, friends, onFriendRemoved }: Props) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function removeFriend(friendId: string) {
    setRemoving(friendId);
    try {
      await fetch(`${API_URL}/friends/remove/${friendId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      onFriendRemoved(friendId);
    } finally {
      setRemoving(null);
      setConfirmId(null);
    }
  }

  if (friends.length === 0) {
    return <p className="text-slate-400 text-sm">You have no friends added yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {friends.map(({ friendship_id, friend }) => (
        <li
          key={friendship_id}
          className="flex items-center justify-between bg-slate-700 px-3 py-2 rounded-lg"
        >
          <Link
            to={`/user/${friend.username}`}
            className="text-slate-100 font-medium hover:text-blue-400 transition-colors"
          >
            @{friend.username}
          </Link>

          {confirmId === friend.id ? (
            <div className="flex gap-2 items-center">
              <span className="text-slate-400 text-sm">Remove friend?</span>
              <button
                onClick={() => removeFriend(friend.id)}
                disabled={removing === friend.id}
                className="text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1 rounded"
              >
                {removing === friend.id ? "Removing…" : "Yes"}
              </button>
              <button
                onClick={() => setConfirmId(null)}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(friend.id)}
              className="text-sm text-slate-500 hover:text-red-400"
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
