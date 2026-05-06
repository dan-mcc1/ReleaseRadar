"""
In-memory pub/sub for SSE notifications.

Each connected user gets one asyncio.Queue per open browser tab.
publish() is synchronous (put_nowait) so it can be called from sync
route handlers without needing await.

Note: this only works within a single process. If you ever run multiple
Uvicorn workers you'd need Redis pub/sub instead.
"""
import asyncio
from collections import defaultdict

# user_id -> set of queues (one per connected tab/client)
_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(user_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=32)
    _subscribers[user_id].add(q)
    return q


def unsubscribe(user_id: str, q: asyncio.Queue) -> None:
    _subscribers[user_id].discard(q)
    if not _subscribers[user_id]:
        del _subscribers[user_id]


def publish(user_id: str, event: dict) -> None:
    """Push a notification event to all open connections for this user."""
    for q in list(_subscribers.get(user_id, [])):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # drop silently — client will resync on next navigation
