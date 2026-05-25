"""
Tests for app.services.episode_alert_service.

Focus: dispatch_due_episode_alerts() — verify it fires pushes only when
an episode's lead-adjusted send time lands inside the sweep window, that
SentEpisodeAlert prevents double-fires, and that per-user preferences
are respected.
"""

from datetime import date, datetime, timedelta, time, timezone as dt_timezone
from unittest.mock import patch

import pytest


def _seed_user(
    db, uid="user-1",
    push_notifications_enabled=True,
    push_notify_episode_air=True,
    lead_minutes=0,
):
    from app.models.user import User
    u = User(
        id=uid, username=f"u-{uid}", email=f"{uid}@t.com",
        push_notifications_enabled=push_notifications_enabled,
        push_notify_episode_air=push_notify_episode_air,
        episode_alert_lead_minutes=lead_minutes,
    )
    db.add(u)
    db.commit()
    return u


def _seed_show_with_episode(
    db, show_id=300, ep_id=400,
    air_time="20:00", air_timezone="America/New_York",
    air_date_val=None,
    season_number=1, episode_number=1, ep_name="Pilot",
):
    from app.models.show import Show
    from app.models.episode import Episode

    if air_date_val is None:
        air_date_val = date.today()

    s = Show(
        id=show_id, name=f"Show-{show_id}",
        air_time=air_time, air_timezone=air_timezone,
        tracking_count=0, vote_average=0.0,
    )
    db.add(s)
    db.flush()
    e = Episode(
        id=ep_id, show_id=show_id,
        season_number=season_number, episode_number=episode_number,
        name=ep_name, air_date=air_date_val,
    )
    db.add(e)
    db.commit()
    return s, e


def _watchlist(db, user_id, show_id, notify=True):
    from app.models.watchlist import Watchlist
    db.add(Watchlist(
        user_id=user_id, content_id=show_id, content_type="tv", notify=notify,
    ))
    db.commit()


def _cw(db, user_id, show_id):
    from app.models.currently_watching import CurrentlyWatching
    db.add(CurrentlyWatching(
        user_id=user_id, content_id=show_id, content_type="tv",
    ))
    db.commit()


def _air_dt_utc(air_date_val, air_time_str, tz_name):
    """Compute the same UTC datetime the service computes."""
    from zoneinfo import ZoneInfo

    h, m = map(int, air_time_str.split(":"))
    local = datetime.combine(air_date_val, time(hour=h, minute=m), tzinfo=ZoneInfo(tz_name))
    return local.astimezone(dt_timezone.utc)


# ── _parse_air_time ───────────────────────────────────────────────────────


class TestParseAirTime:
    def test_none(self):
        from app.services.episode_alert_service import _parse_air_time
        assert _parse_air_time(None) is None
        assert _parse_air_time("") is None

    def test_hh_mm(self):
        from app.services.episode_alert_service import _parse_air_time
        t = _parse_air_time("20:00")
        assert t.hour == 20 and t.minute == 0

    def test_hh_mm_ss(self):
        from app.services.episode_alert_service import _parse_air_time
        t = _parse_air_time("20:00:30")
        assert t.hour == 20 and t.minute == 0

    def test_hour_only(self):
        from app.services.episode_alert_service import _parse_air_time
        t = _parse_air_time("20")
        assert t.hour == 20 and t.minute == 0

    def test_invalid_returns_none(self):
        from app.services.episode_alert_service import _parse_air_time
        assert _parse_air_time("not-a-time") is None


# ── _air_datetime_utc ─────────────────────────────────────────────────────


class TestAirDatetimeUtc:
    def test_returns_none_when_no_air_time(self):
        from app.services.episode_alert_service import _air_datetime_utc
        from app.models.show import Show

        s = Show(id=1, name="X", air_time=None, air_timezone="America/New_York")
        assert _air_datetime_utc(s, date(2026, 5, 25)) is None

    def test_uses_show_timezone(self):
        from app.services.episode_alert_service import _air_datetime_utc
        from app.models.show import Show

        s = Show(id=1, name="X", air_time="20:00", air_timezone="America/New_York")
        result = _air_datetime_utc(s, date(2026, 5, 25))
        # 8 PM ET is 12 AM or 1 AM UTC depending on DST.
        assert result.tzinfo is dt_timezone.utc

    def test_falls_back_to_eastern_on_unknown_tz(self):
        from app.services.episode_alert_service import _air_datetime_utc
        from app.models.show import Show

        s = Show(id=1, name="X", air_time="20:00", air_timezone="Mars/Olympus_Mons")
        result = _air_datetime_utc(s, date(2026, 5, 25))
        assert result is not None
        assert result.tzinfo is dt_timezone.utc


# ── dispatch_due_episode_alerts ───────────────────────────────────────────


class TestDispatchDueEpisodeAlerts:
    def test_no_rows_returns_zero(self, db):
        from app.services.episode_alert_service import dispatch_due_episode_alerts

        # Empty DB
        assert dispatch_due_episode_alerts(db) == 0

    def test_lead_zero_fires_at_air_time(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        # now = air_dt exactly
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 1
            mock_push.assert_called_once()
            kwargs = mock_push.call_args.kwargs
            assert "is on now" in kwargs["title"]

    def test_lead_15_fires_15_min_early(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        # 15 min before air
        now = air_dt - timedelta(minutes=15)

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=15)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 1
            mock_push.assert_called_once()
            kwargs = mock_push.call_args.kwargs
            assert "airs in 15 minutes" in kwargs["title"]

    def test_lead_60_says_one_hour(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt - timedelta(minutes=60)

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=60)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 1
            assert "1 hour" in mock_push.call_args.kwargs["title"]

    def test_too_early_no_fire(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        # 30 min before air, but user lead is 0 -> send_at is 8pm, too late vs now=7:30pm
        now = air_dt - timedelta(minutes=30)

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0
            mock_push.assert_not_called()

    def test_too_late_outside_window_no_fire(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        # 30 min AFTER air, lead 0 -> send_at was 30 min ago, sweep window is
        # only 5 min, so out of range.
        now = air_dt + timedelta(minutes=30)

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0
            mock_push.assert_not_called()

    def test_already_sent_skipped(self, db):
        from app.services import episode_alert_service as svc
        from app.models.sent_episode_alert import SentEpisodeAlert

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val, ep_id=400)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)
        db.add(SentEpisodeAlert(user_id="u1", episode_id=400))
        db.commit()

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0
            mock_push.assert_not_called()

    def test_push_disabled_user_skipped(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", push_notifications_enabled=False)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0
            mock_push.assert_not_called()

    def test_episode_air_pref_off_user_skipped(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", push_notify_episode_air=False)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0
            mock_push.assert_not_called()

    def test_watchlist_notify_false_excludes_user(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300, notify=False)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0

    def test_currently_watching_user_fires(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=0)
        _cw(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 1

    def test_idempotency_record_persisted_on_send(self, db):
        from app.services import episode_alert_service as svc
        from app.models.sent_episode_alert import SentEpisodeAlert

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val, ep_id=400)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification"):
            svc.dispatch_due_episode_alerts(db, now_utc=now)

        markers = db.query(SentEpisodeAlert).filter_by(user_id="u1", episode_id=400).all()
        assert len(markers) == 1

    def test_episode_with_no_name_body_is_label_only(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val, ep_name=None)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            svc.dispatch_due_episode_alerts(db, now_utc=now)
            mock_push.assert_called_once()
            assert mock_push.call_args.kwargs["body"] == "S01E01"

    def test_show_with_no_air_time_excluded(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val, air_time=None)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0
            mock_push.assert_not_called()

    def test_no_watchers_returns_zero(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val)
        # No user/watchlist set up

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0
            mock_push.assert_not_called()

    def test_user_not_opted_in_returns_zero(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val)
        # Watchlist exists but the only user has push disabled
        _seed_user(db, uid="u1", push_notifications_enabled=False)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 0

    def test_lead_clamped_to_60(self, db):
        from app.services import episode_alert_service as svc

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        # Lead clamped from 999 -> 60. send_at = air - 60min.
        now = air_dt - timedelta(minutes=60)

        _seed_show_with_episode(db, air_date_val=air_date_val)
        _seed_user(db, uid="u1", lead_minutes=999)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification") as mock_push:
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            assert sent == 1

    def test_push_failure_swallowed_but_marker_kept(self, db):
        from app.services import episode_alert_service as svc
        from app.models.sent_episode_alert import SentEpisodeAlert

        air_date_val = date(2026, 5, 25)
        air_dt = _air_dt_utc(air_date_val, "20:00", "America/New_York")
        now = air_dt

        _seed_show_with_episode(db, air_date_val=air_date_val, ep_id=400)
        _seed_user(db, uid="u1", lead_minutes=0)
        _watchlist(db, "u1", 300)

        with patch.object(svc, "push_notification", side_effect=RuntimeError("fcm down")):
            sent = svc.dispatch_due_episode_alerts(db, now_utc=now)
            # The marker is committed before push, so even when push fails
            # the count doesn't increment but the marker remains.
            assert sent == 0
        markers = db.query(SentEpisodeAlert).filter_by(user_id="u1", episode_id=400).all()
        assert len(markers) == 1

    def test_default_now_uses_current_time(self, db):
        """now_utc=None branch — should not error on empty DB."""
        from app.services.episode_alert_service import dispatch_due_episode_alerts

        assert dispatch_due_episode_alerts(db) == 0
