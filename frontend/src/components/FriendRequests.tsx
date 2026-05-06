import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useRespondToFriendRequest,
  useCancelFriendRequest,
} from "../hooks/api/useFriends";

interface RequestUser {
  id: string;
  username: string;
  email?: string;
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
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
  onResponded: (
    friendshipId: number,
    accepted: boolean,
    req: IncomingRequest,
  ) => void;
  onCancelled: (friendshipId: number) => void;
}

export default function FriendRequests({
  incoming,
  outgoing,
  onResponded,
  onCancelled,
}: Props) {
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const respondMutation = useRespondToFriendRequest();
  const cancelMutation = useCancelFriendRequest();

  async function respond(friendshipId: number, accept: boolean) {
    setRespondingId(friendshipId);
    const req = incoming.find((r) => r.friendship_id === friendshipId)!;
    try {
      await respondMutation.mutateAsync({ friendshipId, accept });
      onResponded(friendshipId, accept, req);
    } finally {
      setRespondingId(null);
    }
  }

  async function cancel(friendshipId: number) {
    setCancellingId(friendshipId);
    try {
      await cancelMutation.mutateAsync(friendshipId);
      onCancelled(friendshipId);
    } finally {
      setCancellingId(null);
    }
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <p className="text-neutral-400 text-sm">No pending friend requests.</p>
    );
  }

  return (
    <div className="space-y-4">
      {incoming.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-neutral-400 mb-2">
            Incoming
          </h4>
          <ul className="space-y-2">
            {incoming.map((req) => (
              <li
                key={req.friendship_id}
                className="flex items-center justify-between bg-neutral-700 px-3 py-2 rounded-lg"
              >
                <Link
                  to={`/user/${req.from_user.username}`}
                  className="text-neutral-100 font-medium hover:text-primary-400 transition-colors"
                >
                  <span>@{req.from_user.username}</span>
                </Link>
                <div className="flex gap-2">
                  <button
                    onClick={() => respond(req.friendship_id, true)}
                    disabled={respondingId === req.friendship_id}
                    className="text-sm bg-success-600 hover:bg-success-500 disabled:opacity-50 text-white px-3 py-1 rounded"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => respond(req.friendship_id, false)}
                    disabled={respondingId === req.friendship_id}
                    className="text-sm bg-neutral-600 hover:bg-neutral-500 disabled:opacity-50 text-neutral-200 px-3 py-1 rounded"
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
          <h4 className="text-xs uppercase tracking-wider text-neutral-400 mb-2">
            Sent ({outgoing.length}/25)
          </h4>
          <ul className="space-y-2">
            {outgoing.map((req) => (
              <li
                key={req.friendship_id}
                className="flex items-center justify-between bg-neutral-700 px-3 py-2 rounded-lg"
              >
                <Link
                  to={`/user/${req.to_user.username}`}
                  className="text-neutral-100 font-medium hover:text-primary-400 transition-colors"
                >
                  <span>@{req.to_user.username}</span>
                </Link>
                <button
                  onClick={() => cancel(req.friendship_id)}
                  disabled={cancellingId === req.friendship_id}
                  className="text-sm text-neutral-400 hover:text-error-500 disabled:opacity-50"
                >
                  {cancellingId === req.friendship_id ? "Cancelling…" : "Cancel"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
