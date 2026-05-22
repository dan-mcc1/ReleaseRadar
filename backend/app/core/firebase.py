import json
import os
import firebase_admin
from firebase_admin import credentials, auth
from cachetools import TTLCache
from threading import Lock
from app.config import settings

_firebase_credentials = os.getenv("FIREBASE_CREDENTIALS")

if _firebase_credentials:
    cred = credentials.Certificate(json.loads(_firebase_credentials))
else:
    cred = credentials.Certificate(settings.FIREBASE_CREDS_PATH)

firebase_admin.initialize_app(cred)

_token_cache = TTLCache(maxsize=10_000, ttl=3600)
_lock = Lock()


def verify_token(token: str):
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
