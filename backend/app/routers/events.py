import asyncio
import json
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse
from firebase_admin import auth as firebase_auth
from app.core import event_bus

router = APIRouter()


@router.get("/stream")
async def event_stream(token: str = Query(...)):
    """
    SSE endpoint. Browsers can't set Authorization headers on EventSource,
    so the Firebase token is passed as a query parameter instead.
    """
    try:
        decoded = firebase_auth.verify_id_token(token)
        uid: str = decoded["uid"]
    except Exception:
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
