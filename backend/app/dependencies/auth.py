# app/dependencies/auth.py
from datetime import datetime, timezone
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.core.firebase import verify_token
from app.db.session import get_db

bearer_scheme = HTTPBearer()


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
    from app.models.banned_email import BannedEmail

    # Block re-registrations: reject any token whose email is on the ban list
    token_email = decoded_token.get("email", "")
    if token_email and db.query(BannedEmail).filter(BannedEmail.email == token_email).first():
        raise HTTPException(status_code=403, detail="Your account has been permanently banned.")

    user = db.query(User).filter(User.id == uid).first()
    if user:
        now = datetime.now(timezone.utc)

        if user.is_banned:
            raise HTTPException(status_code=403, detail="Your account has been banned.")

        if user.is_suspended:
            if user.suspended_until and now >= user.suspended_until:
                user.is_suspended = False
                user.suspended_until = None
                user.suspension_reason = None
                db.commit()
            else:
                until = (
                    user.suspended_until.strftime("%Y-%m-%d") if user.suspended_until else "further notice"
                )
                raise HTTPException(
                    status_code=403,
                    detail=f"Your account has been suspended until {until}.",
                )

        # Auto-lift expired temporary silences
        if not user.is_silenced and user.silenced_until and now >= user.silenced_until:
            user.silenced_until = None
            db.commit()

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
    user = db.query(User).filter(User.id == uid).first()
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
