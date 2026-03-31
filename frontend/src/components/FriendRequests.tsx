import { useState } from "react";
import { API_URL } from "../constants";

interface RequestUser {
  id: string;
  username: string;
  email: string;
}

interface IncomingRequest {
  friendship_id: number;
  from_user: RequestUser;
  created_at: string;
}

interface OutgoingRequest {
  friendship_id: number;
  to_user: RequestUser;
  created_at: string;
}

interface Props {
  token: string;
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
  onResponded: (friendshipId: number, accepted: boolean, req: IncomingRequest) => void;
  onCancelled: (friendshipId: number) => void;
}

export default function FriendRequests({ token, incoming, outgoing, onResponded, onCancelled }: Props) {
  const [responding, setResponding] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  async function respond(friendshipId: number, accept: boolean) {
    setResponding(friendshipId);
    const req = incoming.find((r) => r.friendship_id === friendshipId)!;
    try {
      const res = await fetch(`${API_URL}/friends/respond`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ friendship_id: friendshipId, accept }),
      });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent("friend-request-handled"));
        onResponded(friendshipId, accept, req);
      }
    } finally {
      setResponding(null);
    }
  }

  async function cancel(friendshipId: number) {
    setCancelling(friendshipId);
    try {
      await fetch(`${API_URL}/friends/cancel/${friendshipId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      onCancelled(friendshipId);
    } finally {
      setCancelling(null);
    }
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return <p className="text-slate-400 text-sm">No pending friend requests.</p>;
  }

  return (
    <div className="space-y-4">
      {incoming.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Incoming</h4>
          <ul className="space-y-2">
            {incoming.map((req) => (
              <li
                key={req.friendship_id}
                className="flex items-center justify-between bg-slate-700 px-3 py-2 rounded-lg"
              >
                <span className="text-slate-100 font-medium">@{req.from_user.username}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => respond(req.friendship_id, true)}
                    disabled={responding === req.friendship_id}
                    className="text-sm bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-3 py-1 rounded"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => respond(req.friendship_id, false)}
                    disabled={responding === req.friendship_id}
                    className="text-sm bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-slate-200 px-3 py-1 rounded"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outgoing.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            Sent ({outgoing.length}/25)
          </h4>
          <ul className="space-y-2">
            {outgoing.map((req) => (
              <li
                key={req.friendship_id}
                className="flex items-center justify-between bg-slate-700 px-3 py-2 rounded-lg"
              >
                <span className="text-slate-100 font-medium">@{req.to_user.username}</span>
                <button
                  onClick={() => cancel(req.friendship_id)}
                  disabled={cancelling === req.friendship_id}
                  className="text-sm text-slate-400 hover:text-red-400 disabled:opacity-50"
                >
                  {cancelling === req.friendship_id ? "Cancelling…" : "Cancel"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
