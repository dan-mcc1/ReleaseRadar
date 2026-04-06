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
  onFindFriends?: () => void;
}

export default function FriendsList({
  token,
  friends,
  onFriendRemoved,
  onFindFriends,
}: Props) {
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
    return (
      <div className="text-center py-4">
        <p className="text-neutral-400 text-sm mb-3">
          You have no friends added yet.
        </p>
        {onFindFriends && (
          <button
            onClick={onFindFriends}
            className="text-sm bg-primary-600 hover:bg-primary-500 text-white font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            Find Friends
          </button>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {friends.map(({ friendship_id, friend }) => (
        <li
          key={friendship_id}
          className="flex items-center justify-between bg-neutral-700 px-3 py-2 rounded-lg"
        >
          <Link
            to={`/user/${friend.username}`}
            className="text-neutral-100 font-medium hover:text-primary-400 transition-colors"
          >
            @{friend.username}
          </Link>

          {confirmId === friend.id ? (
            <div className="flex gap-2 items-center">
              <span className="text-neutral-400 text-sm">Remove friend?</span>
              <button
                onClick={() => removeFriend(friend.id)}
                disabled={removing === friend.id}
                className="text-sm bg-error-500 hover:bg-error-500 disabled:opacity-50 text-white px-3 py-1 rounded"
              >
                {removing === friend.id ? "Removing…" : "Yes"}
              </button>
              <button
                onClick={() => setConfirmId(null)}
                className="text-sm text-neutral-400 hover:text-neutral-200"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(friend.id)}
              className="text-sm text-neutral-500 hover:text-error-400"
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
