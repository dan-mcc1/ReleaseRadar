"""FCM push delivery + in-app notification inbox.

iOS badge is driven by `Notification` unread count: every push to a user
includes the current unread count as the APNs badge, so the home-screen
red dot stays correct even if individual pushes are missed.

Firebase Admin is already initialized in app.core.firebase, so importing
`firebase_admin.messaging` here works without extra setup.
"""

import logging
from datetime import datetime, timezone as dt_timezone
from typing import Iterable

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from app.models.device_token import DeviceToken
from app.models.notification import Notification
from app.models.user import User

# Ensure Firebase Admin is initialized before importing messaging.
import app.core.firebase  # noqa: F401
from firebase_admin import messaging

logger = logging.getLogger(__name__)


VALID_PLATFORMS = {"ios", "android"}

# TMDb image CDN base. w500 is a good size for push thumbnails — large enough
# to look sharp on retina displays, small enough that APNs's 10 MB attachment
# limit is never close.
_TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"


def tmdb_poster_url(poster_path: str | None) -> str | None:
    """Turn a TMDb poster_path ('/abc.jpg') into a full HTTPS URL FCM can use."""
    if not poster_path:
        return None
    return f"{_TMDB_IMAGE_BASE}{poster_path}"


# ---------------------------------------------------------------------------
# Device tokens
# ---------------------------------------------------------------------------

def register_device(
    db: Session,
    user_id: str,
    token: str,
    platform: str,
    app_version: str | None = None,
) -> DeviceToken:
    """Upsert by token. If the token previously belonged to another user
    (account switch on the same device), reassign it."""
    now = datetime.now(dt_timezone.utc)
    existing = db.query(DeviceToken).filter_by(token=token).first()
    if existing:
        existing.user_id = user_id
        existing.platform = platform
        existing.app_version = app_version
        existing.last_seen_at = now
        existing.disabled_at = None
    else:
        existing = DeviceToken(
            user_id=user_id,
            token=token,
            platform=platform,
            app_version=app_version,
        )
        db.add(existing)
    db.commit()
    return existing


def unregister_device(db: Session, token: str) -> None:
    row = db.query(DeviceToken).filter_by(token=token).first()
    if row:
        row.disabled_at = datetime.now(dt_timezone.utc)
        db.commit()


def _active_tokens(db: Session, user_id: str) -> list[DeviceToken]:
    return (
        db.query(DeviceToken)
        .filter(DeviceToken.user_id == user_id, DeviceToken.disabled_at.is_(None))
        .all()
    )


# ---------------------------------------------------------------------------
# Badge / inbox helpers
# ---------------------------------------------------------------------------

def unread_count(db: Session, user_id: str) -> int:
    return (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user_id, Notification.read_at.is_(None))
        .scalar()
        or 0
    )


def mark_read(db: Session, user_id: str, ids: list[int] | None = None) -> int:
    """Mark inbox entries as read. If ids is None, mark all. Returns new unread count."""
    now = datetime.now(dt_timezone.utc)
    q = update(Notification).where(
        Notification.user_id == user_id, Notification.read_at.is_(None)
    )
    if ids is not None:
        if not ids:
            return unread_count(db, user_id)
        q = q.where(Notification.id.in_(ids))
    db.execute(q.values(read_at=now))
    db.commit()
    return unread_count(db, user_id)


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------

def _build_message(
    token: str,
    title: str,
    body: str,
    badge: int,
    data: dict | None,
    image_url: str | None,
) -> messaging.Message:
    # FCM requires data values to be strings.
    str_data = {k: str(v) for k, v in (data or {}).items() if v is not None}

    # Belt-and-suspenders for rich-push image discovery on the iOS extension:
    #   - notification.image  → standard FCM field; Firebase's iOS SDK
    #     populates the APNs attachment automatically when you use
    #     Messaging.serviceExtension().populateNotificationContent(...).
    #   - data.image_url      → mirror under the conventional data key so a
    #     hand-rolled NotificationServiceExtension finds it without depending
    #     on the Firebase helper.
    # APS "mutable-content: 1" is only set when there's actually an image —
    # otherwise the extension would run for no reason on every push.
    if image_url:
        str_data["image_url"] = image_url

    return messaging.Message(
        token=token,
        notification=messaging.Notification(
            title=title, body=body, image=image_url
        ),
        data=str_data,
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(
                aps=messaging.Aps(
                    badge=badge,
                    sound="default",
                    mutable_content=True if image_url else None,
                    thread_id=str_data.get("thread_id"),
                )
            )
        ),
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                sound="default",
                notification_count=badge,
                image=image_url,
            ),
        ),
    )


def _prune_invalid(db: Session, token_rows: Iterable[DeviceToken], responses) -> None:
    """Disable tokens FCM rejected as permanently invalid."""
    now = datetime.now(dt_timezone.utc)
    invalid_codes = {"UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND"}
    any_changed = False
    for row, resp in zip(token_rows, responses):
        if resp.success:
            row.last_seen_at = now
            any_changed = True
            continue
        exc = resp.exception
        if exc is None:
            continue
        code = getattr(exc, "code", None) or type(exc).__name__
        # firebase_admin raises UnregisteredError / SenderIdMismatchError etc.
        # — name-match is safer than importing each exception type.
        name = type(exc).__name__
        if (
            code in invalid_codes
            or name in {"UnregisteredError", "SenderIdMismatchError"}
            or "Requested entity was not found" in str(exc)
        ):
            row.disabled_at = now
            any_changed = True
            logger.info("push: disabling invalid token %s", row.token[:12])
    if any_changed:
        db.commit()


def _send_to_user(
    db: Session,
    user_id: str,
    title: str,
    body: str,
    badge: int,
    data: dict | None,
    image_url: str | None,
) -> int:
    tokens = _active_tokens(db, user_id)
    if not tokens:
        return 0

    messages = [
        _build_message(t.token, title, body, badge, data, image_url) for t in tokens
    ]
    try:
        batch = messaging.send_each(messages)
    except Exception:
        logger.exception("push: send_each failed for user %s", user_id)
        return 0

    _prune_invalid(db, tokens, batch.responses)
    return batch.success_count


def push_notification(
    db: Session,
    user_id: str,
    *,
    type: str,
    title: str,
    body: str,
    content_type: str | None = None,
    content_id: int | None = None,
    image_url: str | None = None,
    season_number: int | None = None,
    episode_id: int | None = None,
    video_key: str | None = None,
    recommendation_id: int | None = None,
    friendship_id: int | None = None,
) -> Notification:
    """Create an inbox row and deliver an FCM push to all of the user's devices.

    Always writes the inbox row, even if the user has no devices yet —
    that way the badge count is correct the moment a device registers,
    and the in-app notifications screen still shows the history.
    """
    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        content_type=content_type,
        content_id=content_id,
        image_url=image_url,
        season_number=season_number,
        episode_id=episode_id,
        video_key=video_key,
        recommendation_id=recommendation_id,
        friendship_id=friendship_id,
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)

    user = db.get(User, user_id)
    if not user or not user.push_notifications_enabled:
        return notif

    badge = unread_count(db, user_id)
    # FCM data values must be strings; only include keys that are actually set.
    payload: dict = {
        "notification_id": notif.id,
        "type": type,
        "content_type": content_type or "",
        "content_id": content_id or "",
    }
    if season_number is not None:
        payload["season_number"] = season_number
    if episode_id is not None:
        payload["episode_id"] = episode_id
    if video_key is not None:
        payload["video_key"] = video_key

    _send_to_user(
        db,
        user_id,
        title=title,
        body=body,
        badge=badge,
        data=payload,
        image_url=image_url,
    )
    return notif


def refresh_badge(db: Session, user_id: str) -> int:
    """Silent (data-only) push that updates the iOS badge without showing a banner.
    Use after the client marks notifications read so other devices stay in sync."""
    badge = unread_count(db, user_id)
    tokens = _active_tokens(db, user_id)
    if not tokens:
        return badge

    messages = [
        messaging.Message(
            token=t.token,
            apns=messaging.APNSConfig(
                headers={"apns-push-type": "background", "apns-priority": "5"},
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(badge=badge, content_available=True)
                ),
            ),
            data={"badge": str(badge), "silent": "1"},
        )
        for t in tokens
    ]
    try:
        batch = messaging.send_each(messages)
        _prune_invalid(db, tokens, batch.responses)
    except Exception:
        logger.exception("push: silent badge refresh failed for user %s", user_id)
    return badge
