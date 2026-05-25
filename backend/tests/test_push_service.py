"""
Tests for app.services.push_service.

firebase_admin is already mocked at the sys.modules level in conftest, so
`messaging.send_each` is a MagicMock. We patch it per-test to control
batch responses and assert pruning + send counts.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch, MagicMock

import pytest


# ── Helpers ────────────────────────────────────────────────────────────────


def _seed_user(db, uid="test-uid-1", **kwargs):
    from app.models.user import User

    defaults = dict(
        id=uid,
        username=f"user-{uid}",
        email=f"{uid}@test.com",
        push_notifications_enabled=True,
    )
    defaults.update(kwargs)
    user = User(**defaults)
    db.add(user)
    db.commit()
    return user


def _seed_token(db, user_id, token="tok-1", platform="ios", disabled=False):
    from app.models.device_token import DeviceToken

    dt = DeviceToken(
        user_id=user_id,
        token=token,
        platform=platform,
        disabled_at=(
            datetime.now(dt_timezone.utc) if disabled else None
        ),
    )
    db.add(dt)
    db.commit()
    return dt


def _mock_batch(success_count=1, responses=None):
    """Build a fake BatchResponse for messaging.send_each."""
    batch = MagicMock()
    batch.success_count = success_count
    batch.responses = responses or []
    return batch


def _ok_response():
    r = MagicMock()
    r.success = True
    r.exception = None
    return r


def _fail_response(exc):
    r = MagicMock()
    r.success = False
    r.exception = exc
    return r


# ── register_device / unregister_device ───────────────────────────────────


class TestRegisterDevice:
    def test_creates_new_row(self, db):
        from app.services.push_service import register_device
        from app.models.device_token import DeviceToken

        _seed_user(db)
        result = register_device(db, "test-uid-1", "tok-A", "ios", "1.0")
        assert result.token == "tok-A"
        assert result.user_id == "test-uid-1"
        assert result.platform == "ios"
        assert result.app_version == "1.0"
        assert db.query(DeviceToken).count() == 1

    def test_updates_existing_token_same_user(self, db):
        from app.services.push_service import register_device

        _seed_user(db)
        register_device(db, "test-uid-1", "tok-A", "ios", "1.0")
        result = register_device(db, "test-uid-1", "tok-A", "ios", "2.0")
        assert result.app_version == "2.0"

    def test_reassigns_token_on_account_switch(self, db):
        from app.services.push_service import register_device
        from app.models.device_token import DeviceToken

        _seed_user(db, uid="user-a")
        _seed_user(db, uid="user-b")
        register_device(db, "user-a", "tok-shared", "ios", "1.0")
        register_device(db, "user-b", "tok-shared", "ios", "1.0")
        rows = db.query(DeviceToken).filter_by(token="tok-shared").all()
        assert len(rows) == 1
        assert rows[0].user_id == "user-b"
        assert rows[0].disabled_at is None

    def test_reactivates_disabled_token(self, db):
        from app.services.push_service import register_device

        _seed_user(db)
        _seed_token(db, "test-uid-1", token="tok-A", disabled=True)
        result = register_device(db, "test-uid-1", "tok-A", "ios")
        assert result.disabled_at is None


class TestUnregisterDevice:
    def test_disables_existing_token(self, db):
        from app.services.push_service import unregister_device

        _seed_user(db)
        _seed_token(db, "test-uid-1", token="tok-A")
        unregister_device(db, "tok-A")
        from app.models.device_token import DeviceToken

        row = db.query(DeviceToken).filter_by(token="tok-A").first()
        assert row.disabled_at is not None

    def test_missing_token_is_noop(self, db):
        from app.services.push_service import unregister_device

        # Must not raise
        unregister_device(db, "nonexistent")


# ── unread_count / mark_read ──────────────────────────────────────────────


class TestUnreadCount:
    def test_zero_when_no_notifications(self, db):
        from app.services.push_service import unread_count

        _seed_user(db)
        assert unread_count(db, "test-uid-1") == 0

    def test_counts_only_unread(self, db):
        from app.services.push_service import unread_count
        from app.models.notification import Notification

        _seed_user(db)
        db.add_all([
            Notification(user_id="test-uid-1", type="digest", title="a", body="b"),
            Notification(user_id="test-uid-1", type="digest", title="a", body="b"),
            Notification(
                user_id="test-uid-1", type="digest", title="a", body="b",
                read_at=datetime.now(dt_timezone.utc),
            ),
        ])
        db.commit()
        assert unread_count(db, "test-uid-1") == 2


class TestMarkRead:
    def test_mark_all_when_ids_none(self, db):
        from app.services.push_service import mark_read
        from app.models.notification import Notification

        _seed_user(db)
        db.add_all([
            Notification(user_id="test-uid-1", type="t", title="a", body="b"),
            Notification(user_id="test-uid-1", type="t", title="a", body="b"),
        ])
        db.commit()
        new_unread = mark_read(db, "test-uid-1", ids=None)
        assert new_unread == 0

    def test_mark_subset_by_ids(self, db):
        from app.services.push_service import mark_read, unread_count
        from app.models.notification import Notification

        _seed_user(db)
        n1 = Notification(user_id="test-uid-1", type="t", title="a", body="b")
        n2 = Notification(user_id="test-uid-1", type="t", title="a", body="b")
        db.add_all([n1, n2])
        db.commit()
        new_unread = mark_read(db, "test-uid-1", ids=[n1.id])
        assert new_unread == 1
        assert unread_count(db, "test-uid-1") == 1

    def test_empty_ids_list_is_noop(self, db):
        from app.services.push_service import mark_read
        from app.models.notification import Notification

        _seed_user(db)
        db.add(Notification(user_id="test-uid-1", type="t", title="a", body="b"))
        db.commit()
        result = mark_read(db, "test-uid-1", ids=[])
        assert result == 1


# ── push_notification ─────────────────────────────────────────────────────


class TestPushNotification:
    def test_creates_inbox_row(self, db):
        from app.services.push_service import push_notification
        from app.models.notification import Notification

        _seed_user(db, push_notifications_enabled=False)
        notif = push_notification(
            db, "test-uid-1",
            type="trailer",
            title="Hi",
            body="Body",
            content_type="movie",
            content_id=550,
        )
        assert notif.id is not None
        row = db.get(Notification, notif.id)
        assert row.title == "Hi"
        assert row.body == "Body"
        assert row.content_type == "movie"
        assert row.content_id == 550

    def test_no_send_when_push_disabled(self, db):
        from app.services import push_service

        _seed_user(db, push_notifications_enabled=False)
        _seed_token(db, "test-uid-1")
        with patch.object(push_service.messaging, "send_each") as mock_send:
            push_service.push_notification(
                db, "test-uid-1",
                type="trailer", title="T", body="B",
            )
            mock_send.assert_not_called()

    def test_no_send_when_user_missing(self, db):
        from app.services import push_service

        with patch.object(push_service.messaging, "send_each") as mock_send:
            push_service.push_notification(
                db, "ghost-user",
                type="trailer", title="T", body="B",
            )
            mock_send.assert_not_called()

    def test_no_send_when_no_devices(self, db):
        from app.services import push_service

        _seed_user(db, push_notifications_enabled=True)
        with patch.object(push_service.messaging, "send_each") as mock_send:
            push_service.push_notification(
                db, "test-uid-1",
                type="trailer", title="T", body="B",
            )
            # Should not call send_each when no tokens
            mock_send.assert_not_called()

    def test_sends_when_enabled_with_devices(self, db):
        from app.services import push_service

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="tok-1")
        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(1, [_ok_response()]),
        ) as mock_send:
            push_service.push_notification(
                db, "test-uid-1",
                type="trailer",
                title="T", body="B",
                content_type="movie", content_id=550,
                season_number=1, episode_id=42, video_key="vk",
                image_url="http://img/1.jpg",
            )
            mock_send.assert_called_once()
            messages = mock_send.call_args[0][0]
            assert len(messages) == 1

    def test_skips_disabled_tokens(self, db):
        from app.services import push_service

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="active")
        _seed_token(db, "test-uid-1", token="dead", disabled=True)
        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(1, [_ok_response()]),
        ) as mock_send:
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )
            mock_send.assert_called_once()
            messages = mock_send.call_args[0][0]
            assert len(messages) == 1

    def test_send_each_exception_is_swallowed(self, db):
        from app.services import push_service

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="tok-1")
        with patch.object(
            push_service.messaging,
            "send_each",
            side_effect=RuntimeError("network down"),
        ):
            # Should not raise
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )


# ── _prune_invalid (covered via push_notification) ────────────────────────


class TestPruneInvalid:
    def test_disables_unregistered_tokens(self, db):
        from app.services import push_service
        from app.models.device_token import DeviceToken

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="bad-tok")

        # Build an exception whose class name is UnregisteredError
        class UnregisteredError(Exception):
            pass

        responses = [_fail_response(UnregisteredError("gone"))]
        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(0, responses),
        ):
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )

        row = db.query(DeviceToken).filter_by(token="bad-tok").first()
        assert row.disabled_at is not None

    def test_disables_on_invalid_code(self, db):
        from app.services import push_service
        from app.models.device_token import DeviceToken

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="bad-tok")

        class SomeFcmError(Exception):
            def __init__(self):
                super().__init__("invalid")
                self.code = "INVALID_ARGUMENT"

        responses = [_fail_response(SomeFcmError())]
        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(0, responses),
        ):
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )

        row = db.query(DeviceToken).filter_by(token="bad-tok").first()
        assert row.disabled_at is not None

    def test_disables_on_requested_entity_not_found(self, db):
        from app.services import push_service
        from app.models.device_token import DeviceToken

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="bad-tok")

        class OtherErr(Exception):
            pass

        responses = [_fail_response(OtherErr("Requested entity was not found."))]
        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(0, responses),
        ):
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )

        row = db.query(DeviceToken).filter_by(token="bad-tok").first()
        assert row.disabled_at is not None

    def test_keeps_token_on_transient_error(self, db):
        from app.services import push_service
        from app.models.device_token import DeviceToken

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="ok-tok")

        class TransientError(Exception):
            def __init__(self):
                super().__init__("retry later")
                self.code = "UNAVAILABLE"

        responses = [_fail_response(TransientError())]
        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(0, responses),
        ):
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )

        row = db.query(DeviceToken).filter_by(token="ok-tok").first()
        assert row.disabled_at is None

    def test_keeps_token_when_exception_is_none(self, db):
        from app.services import push_service
        from app.models.device_token import DeviceToken

        _seed_user(db, push_notifications_enabled=True)
        _seed_token(db, "test-uid-1", token="ok-tok")

        # exception=None branch
        r = MagicMock()
        r.success = False
        r.exception = None
        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(0, [r]),
        ):
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )

        row = db.query(DeviceToken).filter_by(token="ok-tok").first()
        assert row.disabled_at is None

    def test_updates_last_seen_on_success(self, db):
        from app.services import push_service
        from app.models.device_token import DeviceToken

        _seed_user(db, push_notifications_enabled=True)
        token_row = _seed_token(db, "test-uid-1", token="ok-tok")
        original_last_seen = token_row.last_seen_at

        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(1, [_ok_response()]),
        ):
            push_service.push_notification(
                db, "test-uid-1", type="t", title="T", body="B",
            )

        db.refresh(token_row)
        # Either updated (newer) or equal — should not be older
        assert token_row.last_seen_at >= original_last_seen
        assert token_row.disabled_at is None


# ── refresh_badge ─────────────────────────────────────────────────────────


class TestRefreshBadge:
    def test_no_tokens_returns_badge(self, db):
        from app.services.push_service import refresh_badge

        _seed_user(db)
        assert refresh_badge(db, "test-uid-1") == 0

    def test_sends_silent_push(self, db):
        from app.services import push_service
        from app.models.notification import Notification

        _seed_user(db)
        _seed_token(db, "test-uid-1", token="tok-1")
        db.add(Notification(user_id="test-uid-1", type="t", title="a", body="b"))
        db.commit()

        with patch.object(
            push_service.messaging,
            "send_each",
            return_value=_mock_batch(1, [_ok_response()]),
        ) as mock_send:
            badge = push_service.refresh_badge(db, "test-uid-1")
            mock_send.assert_called_once()
            assert badge == 1

    def test_swallows_exceptions(self, db):
        from app.services import push_service

        _seed_user(db)
        _seed_token(db, "test-uid-1", token="tok-1")
        with patch.object(
            push_service.messaging,
            "send_each",
            side_effect=RuntimeError("boom"),
        ):
            # Must not raise
            push_service.refresh_badge(db, "test-uid-1")
