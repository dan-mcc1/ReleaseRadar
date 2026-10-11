"""
In-memory pub/sub for SSE notifications.

Each connected user gets one asyncio.Queue per open browser tab.
publish() is synchronous so sync route handlers can call it. Those handlers
run in worker threads, while each queue belongs to the event loop that
created it, so the put is handed to that loop with call_soon_threadsafe —
asyncio.Queue isn't thread-safe, and a direct put from another thread doesn't
wake the waiting stream.

Note: this only works within a single process. If you ever run multiple
Uvicorn workers you'd need Redis pub/sub instead.
"""

import asyncio
import threading
from collections import defaultdict

# user_id -> {queue: the loop that owns it} (one queue per connected tab/client)
_subscribers: dict[str, dict[asyncio.Queue, asyncio.AbstractEventLoop]] = defaultdict(dict)
_lock = threading.Lock()


def subscribe(user_id: str) -> asyncio.Queue:
    """Call from the event loop that will read the queue."""
    q: asyncio.Queue = asyncio.Queue(maxsize=32)
    with _lock:
        _subscribers[user_id][q] = asyncio.get_running_loop()
    return q


def unsubscribe(user_id: str, q: asyncio.Queue) -> None:
    with _lock:
        queues = _subscribers.get(user_id)
        if queues is None:
            return
        queues.pop(q, None)
        if not queues:
            del _subscribers[user_id]


def _offer(q: asyncio.Queue, event: dict) -> None:
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        pass  # drop silently — client will resync on next navigation


def publish(user_id: str, event: dict) -> None:
    """Push a notification event to all open connections for this user.
    Safe to call from any thread."""
    with _lock:
        targets = list(_subscribers.get(user_id, {}).items())
    for q, loop in targets:
        try:
            loop.call_soon_threadsafe(_offer, q, event)
        except RuntimeError:
            pass  # that loop has shut down; its stream is gone
