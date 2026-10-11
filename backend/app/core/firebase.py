import json
import os
import time
import firebase_admin
from firebase_admin import credentials, auth
from cachetools import TLRUCache
from threading import Lock
from app.config import settings

_firebase_credentials = os.getenv("FIREBASE_CREDENTIALS")

if _firebase_credentials:
    cred = credentials.Certificate(json.loads(_firebase_credentials))
else:
    cred = credentials.Certificate(settings.FIREBASE_CREDS_PATH)

firebase_admin.initialize_app(cred)

_MAX_CACHE_SECONDS = 3600


def _cached_until(_token: str, claims: dict, now: float) -> float:
    """A verified token stays cached until its own exp — never past it, so an
    expired token is re-verified (and rejected) — and at most an hour."""
    exp = claims.get("exp")
    cap = now + _MAX_CACHE_SECONDS
    return min(float(exp), cap) if exp else cap


# exp is wall-clock epoch seconds, so the cache's timer must be too.
_token_cache = TLRUCache(maxsize=10_000, ttu=_cached_until, timer=time.time)
_lock = Lock()


def verify_token(token: str):
    with _lock:  # cachetools caches aren't thread-safe; reads expire entries
        cached = _token_cache.get(token)
    if cached is not None:
        return cached

    decoded = auth.verify_id_token(token)

    with _lock:
        _token_cache[token] = decoded

    return decoded


def verify_token_strict(token: str):
    """Always calls Firebase with check_revoked=True — never uses the cache.

    Use for destructive or credential-changing operations so that a revoked
    token (password reset, account deletion) is rejected immediately rather
    than being served from the 1-hour TTL cache.
    """
    decoded = auth.verify_id_token(token, check_revoked=True)
    return decoded
