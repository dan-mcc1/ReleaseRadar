import asyncio
import json
import secrets
import time
from fastapi import APIRouter, Query, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from app.core import event_bus
from app.core.limiter import limiter
from app.dependencies.auth import get_current_user

router = APIRouter()

# In-memory store of one-time SSE session tokens.
# Maps token -> (uid, expiry_timestamp)
_sse_tokens: dict[str, tuple[str, float]] = {}
_SSE_TOKEN_TTL = 60  # seconds


@router.post("/token")
@limiter.limit("10/minute")
async def issue_sse_token(request: Request, uid: str = Depends(get_current_user)):
    """
    Issues a short-lived (60s), single-use token for opening the SSE stream.
    The client exchanges its Firebase ID token here (via Authorization header),
    then uses the returned session_token in the EventSource URL instead.
    """
    token = secrets.token_urlsafe(32)
    now = time.monotonic()
    # Lazy cleanup: purge expired entries on every insert to prevent unbounded growth
    expired = [k for k, (_, exp) in _sse_tokens.items() if exp <= now]
    for k in expired:
        del _sse_tokens[k]
    _sse_tokens[token] = (uid, now + _SSE_TOKEN_TTL)
    return {"session_token": token}


@router.get("/stream")
async def event_stream(token: str = Query(...)):
    """
    SSE endpoint. Accepts a short-lived session token (not the Firebase ID token)
    so that credentials are never exposed in URLs or server logs.
    """
    entry = _sse_tokens.pop(token, None)
    if entry is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    uid, expiry = entry
    if time.monotonic() > expiry:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    q = event_bus.subscribe(uid)

    async def generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Keepalive comment — prevents proxies from closing the connection
                    yield ": keepalive\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            event_bus.unsubscribe(uid, q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disables nginx buffering
        },
    )
