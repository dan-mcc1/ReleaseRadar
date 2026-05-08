from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User

PREMIUM_TIERS = {"premium", "admin"}


def _get_tier(user_id: str, db: Session) -> str:
    user = db.query(User).filter(User.id == user_id).first()
    return user.subscription_tier if user else "free"


def is_premium(user_id: str, db: Session) -> bool:
    return _get_tier(user_id, db) in PREMIUM_TIERS


def require_premium(
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> str:
    if not is_premium(user_id, db):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "premium_required",
                "message": "This feature requires a Premium subscription.",
            },
        )
    return user_id


def feature_gate(feature: str):
    """
    Returns a FastAPI dependency that enforces the feature's tier at request time.
    Usage:  uid: str = Depends(feature_gate("shelves"))
    """

    def _dependency(
        user_id: str = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> str:
        from app.config.features import PREMIUM_FEATURES

        if PREMIUM_FEATURES.get(feature, True) and not is_premium(user_id, db):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "premium_required",
                    "message": "This feature requires a Premium subscription.",
                },
            )
        return user_id

    return _dependency


def require_admin(
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> str:
    if _get_tier(user_id, db) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user_id
