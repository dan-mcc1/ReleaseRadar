import hmac
import hashlib
import logging
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.subscription import is_premium
from app.models.user import User
from app.models.notification import Notification as NotificationModel
from app.services import push_service
from app.services.email_service import send_notification_email
from app.services.digest_service import _build_items_for_window, _frequency_window
from app.config import settings
from app.core.limiter import limiter

router = APIRouter()

logger = logging.getLogger(__name__)

VALID_FREQUENCIES = {"daily", "weekly", "monthly"}
VALID_VISIBILITIES = {"public", "friends_only", "private"}


class PreferencesUpdate(BaseModel):
    email_notifications: bool | None = None
    notification_frequency: str | None = None
    profile_visibility: str | None = None
    notify_new_seasons: bool | None = None
    notify_streaming_changes: bool | None = None
    notify_trailers: bool | None = None
    digest_hour: int | None = None
    digest_timezone: str | None = None
    hide_spoilers: bool | None = None
    push_notifications_enabled: bool | None = None
    push_notify_new_seasons: bool | None = None
    push_notify_streaming_changes: bool | None = None
    push_notify_trailers: bool | None = None
    push_notify_episode_air: bool | None = None
    episode_alert_lead_minutes: int | None = None


class DeviceRegister(BaseModel):
    token: str
    platform: str  # 'ios' | 'android'
    app_version: str | None = None


class DeviceUnregister(BaseModel):
    token: str


class MarkReadBody(BaseModel):
    ids: list[int] | None = None  # null = mark all


class DeleteInboxBody(BaseModel):
    ids: list[int] | None = None  # null = delete all


@router.get("/preferences")
def get_notification_preferences(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "email_notifications": user.email_notifications,
        "notification_frequency": user.notification_frequency or "daily",
        "profile_visibility": user.profile_visibility or "friends_only",
        "notify_new_seasons": user.notify_new_seasons,
        "notify_streaming_changes": user.notify_streaming_changes,
        "notify_trailers": user.notify_trailers,
        "digest_hour": user.digest_hour if user.digest_hour is not None else 9,
        "digest_timezone": user.digest_timezone or "America/New_York",
        "hide_spoilers": user.hide_spoilers,
        "push_notifications_enabled": user.push_notifications_enabled,
        "push_notify_new_seasons": user.push_notify_new_seasons,
        "push_notify_streaming_changes": user.push_notify_streaming_changes,
        "push_notify_trailers": user.push_notify_trailers,
        "push_notify_episode_air": user.push_notify_episode_air,
        "episode_alert_lead_minutes": user.episode_alert_lead_minutes,
    }


@router.patch("/preferences")
def update_notification_preferences(
    body: PreferencesUpdate,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.email_notifications is not None:
        user.email_notifications = body.email_notifications

    if body.notification_frequency is not None:
        if body.notification_frequency not in VALID_FREQUENCIES:
            raise HTTPException(
                status_code=422, detail="Invalid notification frequency."
            )
        user.notification_frequency = body.notification_frequency

    if body.profile_visibility is not None:
        if body.profile_visibility not in VALID_VISIBILITIES:
            raise HTTPException(status_code=422, detail="Invalid profile visibility.")
        user.profile_visibility = body.profile_visibility

    if body.notify_new_seasons is not None:
        if body.notify_new_seasons and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "premium_required",
                    "message": "This feature requires a Premium subscription.",
                },
            )
        user.notify_new_seasons = body.notify_new_seasons

    if body.notify_streaming_changes is not None:
        if body.notify_streaming_changes and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "premium_required",
                    "message": "This feature requires a Premium subscription.",
                },
            )
        user.notify_streaming_changes = body.notify_streaming_changes

    if body.notify_trailers is not None:
        if body.notify_trailers and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "premium_required",
                    "message": "This feature requires a Premium subscription.",
                },
            )
        user.notify_trailers = body.notify_trailers

    if body.digest_hour is not None:
        if not (0 <= body.digest_hour <= 23):
            raise HTTPException(status_code=422, detail="digest_hour must be between 0 and 23")
        user.digest_hour = body.digest_hour

    if body.digest_timezone is not None:
        try:
            ZoneInfo(body.digest_timezone)
        except (ZoneInfoNotFoundError, KeyError):
            raise HTTPException(status_code=422, detail="Invalid timezone")
        user.digest_timezone = body.digest_timezone

    if body.hide_spoilers is not None:
        user.hide_spoilers = body.hide_spoilers

    if body.push_notifications_enabled is not None:
        user.push_notifications_enabled = body.push_notifications_enabled

    if body.push_notify_new_seasons is not None:
        if body.push_notify_new_seasons and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={"error": "premium_required", "message": "This feature requires a Premium subscription."},
            )
        user.push_notify_new_seasons = body.push_notify_new_seasons

    if body.push_notify_streaming_changes is not None:
        if body.push_notify_streaming_changes and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={"error": "premium_required", "message": "This feature requires a Premium subscription."},
            )
        user.push_notify_streaming_changes = body.push_notify_streaming_changes

    if body.push_notify_trailers is not None:
        if body.push_notify_trailers and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={"error": "premium_required", "message": "This feature requires a Premium subscription."},
            )
        user.push_notify_trailers = body.push_notify_trailers

    if body.push_notify_episode_air is not None:
        user.push_notify_episode_air = body.push_notify_episode_air

    if body.episode_alert_lead_minutes is not None:
        lead = body.episode_alert_lead_minutes
        if lead < 0 or lead > 60 or lead % 15 != 0:
            raise HTTPException(
                status_code=422,
                detail="episode_alert_lead_minutes must be 0, 15, 30, 45, or 60",
            )
        user.episode_alert_lead_minutes = lead

    db.commit()
    return {
        "email_notifications": user.email_notifications,
        "notification_frequency": user.notification_frequency,
        "profile_visibility": user.profile_visibility,
        "notify_new_seasons": user.notify_new_seasons,
        "notify_streaming_changes": user.notify_streaming_changes,
        "notify_trailers": user.notify_trailers,
        "digest_hour": user.digest_hour,
        "digest_timezone": user.digest_timezone,
        "hide_spoilers": user.hide_spoilers,
        "push_notifications_enabled": user.push_notifications_enabled,
        "push_notify_new_seasons": user.push_notify_new_seasons,
        "push_notify_streaming_changes": user.push_notify_streaming_changes,
        "push_notify_trailers": user.push_notify_trailers,
        "push_notify_episode_air": user.push_notify_episode_air,
        "episode_alert_lead_minutes": user.episode_alert_lead_minutes,
    }


# ---------------------------------------------------------------------------
# Device tokens (iOS APNs via FCM)
# ---------------------------------------------------------------------------

@router.post("/devices/register")
def register_device(
    body: DeviceRegister,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Register an FCM token for the current user. Idempotent on `token`."""
    platform = body.platform.lower()
    if platform not in {"ios", "android"}:
        raise HTTPException(status_code=422, detail="platform must be 'ios' or 'android'")
    if not body.token or len(body.token) > 4096:
        raise HTTPException(status_code=422, detail="invalid token")

    push_service.register_device(
        db, uid, body.token, platform, app_version=body.app_version
    )
    # Auto-enable push the first time a device shows up — explicit toggle is
    # available in /preferences if the user wants to turn it back off.
    user = db.get(User, uid)
    if user and not user.push_notifications_enabled:
        user.push_notifications_enabled = True
        db.commit()
    return {"ok": True, "badge": push_service.unread_count(db, uid)}


@router.post("/devices/unregister")
def unregister_device(
    body: DeviceUnregister,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),  # noqa: ARG001 — auth gate only
):
    push_service.unregister_device(db, body.token)
    return {"ok": True}


# ---------------------------------------------------------------------------
# In-app inbox + badge
# ---------------------------------------------------------------------------

@router.get("/inbox")
def list_inbox(
    limit: int = Query(50, ge=1, le=100),
    before_id: int | None = Query(None),
    unread_only: bool = Query(False),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    q = db.query(NotificationModel).filter(NotificationModel.user_id == uid)
    if unread_only:
        q = q.filter(NotificationModel.read_at.is_(None))
    if before_id is not None:
        q = q.filter(NotificationModel.id < before_id)
    rows = q.order_by(NotificationModel.id.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "content_type": n.content_type,
                "content_id": n.content_id,
                "image_url": n.image_url,
                "season_number": n.season_number,
                "episode_id": n.episode_id,
                "video_key": n.video_key,
                "recommendation_id": n.recommendation_id,
                "friendship_id": n.friendship_id,
                "read_at": n.read_at.isoformat() if n.read_at else None,
                "created_at": n.created_at.isoformat(),
            }
            for n in rows
        ],
        "badge": push_service.unread_count(db, uid),
    }


@router.get("/badge")
def get_badge(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return {"badge": push_service.unread_count(db, uid)}


@router.post("/inbox/read")
def mark_inbox_read(
    body: MarkReadBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    new_badge = push_service.mark_read(db, uid, body.ids)
    # Best-effort silent push so the user's other devices update their badge.
    try:
        push_service.refresh_badge(db, uid)
    except Exception:
        logger.exception("badge refresh push failed for %s", uid)
    return {"badge": new_badge}


@router.post("/inbox/delete")
def delete_inbox(
    body: DeleteInboxBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Permanently remove inbox entries. Only deletes rows belonging to the
    current user. Does NOT touch the underlying recommendation / friendship /
    invitation row — those have their own dedicated actions; this is just
    'clear it from my inbox'."""
    q = db.query(NotificationModel).filter(NotificationModel.user_id == uid)
    if body.ids is not None:
        if not body.ids:
            return {"badge": push_service.unread_count(db, uid), "deleted": 0}
        q = q.filter(NotificationModel.id.in_(body.ids))
    deleted = q.delete(synchronize_session=False)
    db.commit()

    new_badge = push_service.unread_count(db, uid)
    # Best-effort silent push so other devices update their badge.
    try:
        push_service.refresh_badge(db, uid)
    except Exception:
        logger.exception("badge refresh push failed for %s", uid)
    return {"badge": new_badge, "deleted": deleted}


@router.post("/send-digest")
@limiter.limit("3/hour")
def send_digest(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Trigger a digest email for the current user (uses their frequency window)."""
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.email_notifications:
        raise HTTPException(status_code=400, detail="Email notifications are disabled")
    if not user.email:
        raise HTTPException(status_code=400, detail="No email address on file")

    freq = user.notification_frequency or "daily"
    window = _frequency_window(freq)
    upcoming = _build_items_for_window(db, uid, window)

    background_tasks.add_task(
        send_notification_email,
        user.email,
        user.username or "",
        upcoming,
        uid,
        frequency=freq,
    )
    return {"message": "Digest email queued"}


# POST only: mail providers and link scanners prefetch links with GET, which
# must not unsubscribe anyone. Gmail/Yahoo one-click unsubscribe POSTs here
# (List-Unsubscribe header); the frontend /unsubscribe page POSTs on confirm.
@router.post("/unsubscribe")
def unsubscribe(
    uid: str = Query(...),
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    expected = hmac.new(
        settings.UNSUBSCRIBE_SECRET.encode(),
        uid.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, token):
        raise HTTPException(status_code=400, detail="Invalid unsubscribe token")

    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.email_notifications = False
    db.commit()
    return {"message": "Unsubscribed successfully"}
