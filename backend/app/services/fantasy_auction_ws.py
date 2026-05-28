"""WebSocket connection manager for live auction draft. Lets clients subscribe
to a (league_id, season_id) "room" and receive push notifications when the
auction state changes (new bid, nomination opened, nomination closed, etc.).

Thread-safe entry point: `manager.notify()` is callable from sync code (service
mutations) or background threads. It uses `run_coroutine_threadsafe` to schedule
the broadcast onto the main event loop, which the lifespan binds at startup."""
import asyncio
import json
import logging
from typing import Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class AuctionConnectionManager:
    def __init__(self):
        self._rooms: dict[tuple[int, int], Set[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(
        self, ws: WebSocket, league_id: int, season_id: int
    ) -> None:
        await ws.accept()
        self._rooms.setdefault((league_id, season_id), set()).add(ws)

    def disconnect(
        self, ws: WebSocket, league_id: int, season_id: int
    ) -> None:
        room = self._rooms.get((league_id, season_id))
        if room and ws in room:
            room.discard(ws)
            if not room:
                self._rooms.pop((league_id, season_id), None)

    def notify(self, league_id: int, season_id: int, payload: dict) -> None:
        """Thread-safe broadcast trigger. Service code calls this after commits;
        the WebSocket layer fans out from the main loop."""
        if self._loop is None or self._loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(
                self._broadcast(league_id, season_id, payload),
                self._loop,
            )
        except Exception as e:
            logger.error("auction ws notify failed: %s", e)

    async def _broadcast(
        self, league_id: int, season_id: int, payload: dict
    ) -> None:
        room = self._rooms.get((league_id, season_id))
        if not room:
            return
        message = json.dumps(payload, default=str)
        dead: list[WebSocket] = []
        for ws in list(room):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            room.discard(ws)


manager = AuctionConnectionManager()


def emit(
    league_id: int, season_id: int, event_type: str, extra: dict | None = None
) -> None:
    """Convenience wrapper. Service code uses this to push an event to all
    connected clients for a room."""
    payload = {
        "event": event_type,
        "league_id": league_id,
        "season_id": season_id,
    }
    if extra:
        payload.update(extra)
    manager.notify(league_id, season_id, payload)
