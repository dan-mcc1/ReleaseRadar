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


# ── Hourly planning (plan_episode_alerts / send_planned_alert) ─────────────
#
# The scheduler plans a window of alerts once an hour and sleeps until each is
# due, so Neon can scale to zero between hours instead of being queried every
# five minutes.


class TestPlanEpisodeAlerts:
    AIR_DATE = date(2026, 5, 25)

    def _setup(self, db, lead=15, uid="u1"):
        _seed_show_with_episode(db, air_date_val=self.AIR_DATE)
        _seed_user(db, uid=uid, lead_minutes=lead)
        _watchlist(db, uid, 300)
        return _air_dt_utc(self.AIR_DATE, "20:00", "America/New_York")

    def test_plans_send_time_as_air_time_minus_lead(self, db):
        from app.services.episode_alert_service import plan_episode_alerts
        air = self._setup(db, lead=15)
        start = air.replace(minute=0) - timedelta(hours=1)
        alerts = plan_episode_alerts(db, start, start + timedelta(hours=2))
        assert len(alerts) == 1
        a = alerts[0]
        assert a.send_at == air - timedelta(minutes=15)
        assert (a.user_id, a.show_id, a.episode_ids, a.lead) == ("u1", 300, (400,), 15)

    def test_window_is_half_open(self, db):
        """An alert due exactly at the window end belongs to the next window."""
        from app.services.episode_alert_service import plan_episode_alerts
        air = self._setup(db, lead=0)
        assert plan_episode_alerts(db, air - timedelta(hours=1), air) == []
        assert len(plan_episode_alerts(db, air, air + timedelta(hours=1))) == 1

    def test_skips_alerts_already_sent(self, db):
        from app.models.sent_episode_alert import SentEpisodeAlert
        from app.services.episode_alert_service import plan_episode_alerts
        air = self._setup(db, lead=0)
        db.add(SentEpisodeAlert(user_id="u1", episode_id=400))
        db.commit()
        assert plan_episode_alerts(db, air - timedelta(minutes=5), air + timedelta(hours=1)) == []

    def test_skips_users_with_pushes_off(self, db):
        from app.services.episode_alert_service import plan_episode_alerts
        _seed_show_with_episode(db, air_date_val=self.AIR_DATE)
        _seed_user(db, uid="off", push_notifications_enabled=False)
        _watchlist(db, "off", 300)
        air = _air_dt_utc(self.AIR_DATE, "20:00", "America/New_York")
        assert plan_episode_alerts(db, air - timedelta(hours=1), air + timedelta(hours=1)) == []

    def test_groups_simultaneous_drops_into_one_alert(self, db):
        from app.models.episode import Episode
        from app.services.episode_alert_service import plan_episode_alerts
        air = self._setup(db, lead=0)
        db.add(Episode(id=401, show_id=300, season_number=1, episode_number=2,
                       name="Two", air_date=self.AIR_DATE))
        db.commit()
        alerts = plan_episode_alerts(db, air - timedelta(minutes=1), air + timedelta(hours=1))
        assert len(alerts) == 1
        assert set(alerts[0].episode_ids) == {400, 401}

    def test_one_alert_per_user_with_their_own_lead(self, db):
        from app.services.episode_alert_service import plan_episode_alerts
        air = self._setup(db, lead=0, uid="now")
        _seed_user(db, uid="early", lead_minutes=30)
        _watchlist(db, "early", 300)
        alerts = plan_episode_alerts(db, air - timedelta(hours=1), air + timedelta(hours=1))
        by_user = {a.user_id: a.send_at for a in alerts}
        assert by_user == {"now": air, "early": air - timedelta(minutes=30)}

    def test_window_crossing_midnight_utc_finds_next_days_episode(self, db):
        """00:30 UTC air time, planned from 23:00 UTC the day before with a 60-min lead."""
        from app.services.episode_alert_service import plan_episode_alerts
        next_day = date(2026, 5, 26)
        _seed_show_with_episode(db, air_date_val=next_day, air_time="00:30", air_timezone="UTC")
        _seed_user(db, uid="u1", lead_minutes=60)
        _watchlist(db, "u1", 300)
        start = datetime(2026, 5, 25, 23, 0, tzinfo=dt_timezone.utc)
        alerts = plan_episode_alerts(db, start, start + timedelta(hours=1))
        assert [a.send_at for a in alerts] == [datetime(2026, 5, 25, 23, 30, tzinfo=dt_timezone.utc)]


class TestSendPlannedAlert:
    AIR_DATE = date(2026, 5, 25)

    def _planned(self, db, lead=0):
        from app.services.episode_alert_service import plan_episode_alerts
        _seed_show_with_episode(db, air_date_val=self.AIR_DATE)
        _seed_user(db, uid="u1", lead_minutes=lead)
        _watchlist(db, "u1", 300)
        air = _air_dt_utc(self.AIR_DATE, "20:00", "America/New_York")
        (alert,) = plan_episode_alerts(db, air - timedelta(hours=1), air + timedelta(hours=1))
        return alert

    def test_sends_and_records_marker(self, db):
        from app.models.sent_episode_alert import SentEpisodeAlert
        from app.services import episode_alert_service as svc
        alert = self._planned(db, lead=15)
        with patch.object(svc, "push_notification") as mock_push:
            assert svc.send_planned_alert(db, alert) is True
        assert "airs in 15 minutes" in mock_push.call_args.kwargs["title"]
        assert db.query(SentEpisodeAlert).filter_by(user_id="u1", episode_id=400).count() == 1

    def test_second_send_is_a_no_op(self, db):
        from app.services import episode_alert_service as svc
        alert = self._planned(db)
        with patch.object(svc, "push_notification") as mock_push:
            svc.send_planned_alert(db, alert)
            assert svc.send_planned_alert(db, alert) is False
        assert mock_push.call_count == 1

    def test_respects_push_turned_off_after_planning(self, db):
        from app.models.user import User
        from app.services import episode_alert_service as svc
        alert = self._planned(db)
        db.get(User, "u1").push_notify_episode_air = False
        db.commit()
        with patch.object(svc, "push_notification") as mock_push:
            assert svc.send_planned_alert(db, alert) is False
        mock_push.assert_not_called()

    def test_respects_show_muted_after_planning(self, db):
        from app.models.watchlist import Watchlist
        from app.services import episode_alert_service as svc
        alert = self._planned(db)
        db.query(Watchlist).filter_by(user_id="u1", content_id=300).update({"notify": False})
        db.commit()
        with patch.object(svc, "push_notification") as mock_push:
            assert svc.send_planned_alert(db, alert) is False
        mock_push.assert_not_called()

    def test_respects_show_removed_after_planning(self, db):
        from app.models.watchlist import Watchlist
        from app.services import episode_alert_service as svc
        alert = self._planned(db)
        db.query(Watchlist).filter_by(user_id="u1", content_id=300).delete()
        db.commit()
        with patch.object(svc, "push_notification") as mock_push:
            assert svc.send_planned_alert(db, alert) is False
        mock_push.assert_not_called()


class TestNextAlertWindow:
    def test_plans_through_the_next_top_of_hour(self):
        from app.services.episode_alert_service import next_alert_window
        now = datetime(2026, 5, 25, 14, 0, 3, tzinfo=dt_timezone.utc)
        start, end = next_alert_window(now, planned_until=datetime(2026, 5, 25, 14, 0, tzinfo=dt_timezone.utc))
        assert start == datetime(2026, 5, 25, 14, 0, tzinfo=dt_timezone.utc)
        assert end == datetime(2026, 5, 25, 15, 0, tzinfo=dt_timezone.utc)

    def test_first_run_mid_hour_catches_the_last_five_minutes(self):
        from app.services.episode_alert_service import LATE_GRACE_SECONDS, next_alert_window
        now = datetime(2026, 5, 25, 14, 37, tzinfo=dt_timezone.utc)
        start, end = next_alert_window(now, planned_until=None)
        assert start == now - timedelta(seconds=LATE_GRACE_SECONDS)
        assert end == datetime(2026, 5, 25, 15, 0, tzinfo=dt_timezone.utc)

    def test_never_sends_alerts_more_than_five_minutes_late(self):
        """After a long stall, skip stale alerts rather than pushing 'airs in 15 minutes' hours late."""
        from app.services.episode_alert_service import LATE_GRACE_SECONDS, next_alert_window
        now = datetime(2026, 5, 25, 18, 2, tzinfo=dt_timezone.utc)
        start, _ = next_alert_window(now, planned_until=datetime(2026, 5, 25, 15, 0, tzinfo=dt_timezone.utc))
        assert start == now - timedelta(seconds=LATE_GRACE_SECONDS)
