# app/dependencies/auth.py
from datetime import datetime, timezone
from threading import Lock
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from cachetools import TTLCache
from app.core.firebase import verify_token
from app.db.session import get_db

bearer_scheme = HTTPBearer()

# Cache the full set of banned emails; refreshed every 5 minutes.
_banned_cache: TTLCache = TTLCache(maxsize=1, ttl=300)
_banned_lock = Lock()


def _is_email_banned(email: str, db: Session) -> bool:
    with _banned_lock:
        banned_set = _banned_cache.get("emails")
        if banned_set is None:
            from app.models.banned_email import BannedEmail
            rows = db.query(BannedEmail.email).all()
            banned_set = frozenset(r.email for r in rows)
            _banned_cache["emails"] = banned_set
    return email in banned_set


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    try:
        decoded_token = verify_token(credentials.credentials)
        uid = decoded_token["uid"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    from app.models.user import User  # local import avoids circular dependency

    token_email = decoded_token.get("email", "")
    if token_email and _is_email_banned(token_email, db):
        raise HTTPException(status_code=403, detail={"code": "account_banned", "message": "Your account has been permanently banned."})

    user = db.get(User, uid)
    if user:
        now = datetime.now(timezone.utc)

        if user.is_banned:
            raise HTTPException(status_code=403, detail={"code": "account_banned", "message": "Your account has been banned."})

        if user.is_suspended:
            # Suspension may have expired; background task lifts it on the next hourly sweep.
            if not (user.suspended_until and now >= user.suspended_until):
                until = (
                    user.suspended_until.strftime("%Y-%m-%d") if user.suspended_until else "further notice"
                )
                raise HTTPException(
                    status_code=403,
                    detail={"code": "account_suspended", "message": f"Your account has been suspended until {until}."},
                )

    return uid


def get_uid_only(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Verify token only — no suspension/ban/silence check. Use for endpoints banned users must reach."""
    try:
        decoded_token = verify_token(credentials.credentials)
        return decoded_token["uid"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_not_silenced(
    uid: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Use on endpoints that create content — blocks silenced users."""
    from app.models.user import User
    user = db.get(User, uid)
    if user:
        now = datetime.now(timezone.utc)
        if user.is_silenced:
            raise HTTPException(
                status_code=403,
                detail="Your review and comment privileges have been permanently removed.",
            )
        if user.silenced_until and now < user.silenced_until:
            until = user.silenced_until.strftime("%Y-%m-%d")
            raise HTTPException(
                status_code=403,
                detail=f"You are silenced until {until} and cannot post reviews or comments.",
            )
    return uid
