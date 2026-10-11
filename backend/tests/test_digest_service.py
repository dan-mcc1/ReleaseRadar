"""Who is due a digest or a season-premiere alert, and when
(app/services/digest_service.py)."""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest


def _user(**overrides):
    fields = dict(
        id="u1", email="u1@t.com", email_notifications=True,
        notification_frequency="daily", digest_hour=9,
        digest_timezone="America/New_York", last_digest_sent_at=None,
        subscription_tier="premium", notify_new_seasons=True,
        push_notifications_enabled=False, push_notify_new_seasons=True,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


class TestDueDate:
    # June 2024: New York is UTC-4, so 9am there is 13:00 UTC.
    @pytest.mark.parametrize("now, expected", [
        (_utc(2024, 6, 1, 13, 0), date(2024, 6, 1)),   # 9:00, the chosen hour
        (_utc(2024, 6, 1, 18, 59), date(2024, 6, 1)),  # 14:59, 5h59 after
        (_utc(2024, 6, 1, 19, 0), None),               # 15:00, 6h after
        (_utc(2024, 6, 1, 12, 59), None),              # 8:59, just before
    ])
    def test_window_runs_six_hours_from_the_chosen_hour(self, now, expected):
        from app.services.digest_service import due_date

        assert due_date(_user(), now) == expected

    def test_window_crossing_midnight_belongs_to_the_day_it_started(self):
        from app.services.digest_service import due_date

        # A 22:00 user at 01:00 New York time on June 2 is in June 1's window.
        assert due_date(_user(digest_hour=22), _utc(2024, 6, 2, 5, 0)) == date(2024, 6, 1)

    def test_uses_the_users_timezone(self):
        from app.services.digest_service import due_date

        # 09:30 in Tokyo is 00:30 UTC.
        user = _user(digest_timezone="Asia/Tokyo")
        assert due_date(user, _utc(2024, 6, 1, 0, 30)) == date(2024, 6, 1)

    def test_unknown_timezone_falls_back_to_new_york(self):
        from app.services.digest_service import due_date

        user = _user(digest_timezone="Not/AZone")
        assert due_date(user, _utc(2024, 6, 1, 13, 0)) == date(2024, 6, 1)


class TestDigestDue:
    def test_weekly_only_on_mondays(self):
        from app.services.digest_service import digest_due

        user = _user(notification_frequency="weekly")
        assert digest_due(user, _utc(2024, 6, 3, 13, 0)) == date(2024, 6, 3)  # Monday
        assert digest_due(user, _utc(2024, 6, 4, 13, 0)) is None             # Tuesday

    def test_monthly_only_on_the_first(self):
        from app.services.digest_service import digest_due

        user = _user(notification_frequency="monthly")
        assert digest_due(user, _utc(2024, 6, 1, 13, 0)) == date(2024, 6, 1)
        assert digest_due(user, _utc(2024, 6, 2, 13, 0)) is None

    def test_not_twice_on_one_day(self):
        from app.services.digest_service import digest_due

        now = _utc(2024, 6, 1, 15, 0)
        assert digest_due(_user(last_digest_sent_at=date(2024, 6, 1)), now) is None
        assert digest_due(_user(last_digest_sent_at=date(2024, 5, 31)), now) == date(2024, 6, 1)

    @pytest.mark.parametrize("overrides", [{"email_notifications": False}, {"email": None}])
    def test_not_without_email(self, overrides):
        from app.services.digest_service import digest_due

        assert digest_due(_user(**overrides), _utc(2024, 6, 1, 13, 0)) is None


def _premiere_migration():
    import importlib.util
    from pathlib import Path

    path = (Path(__file__).resolve().parents[1] / "alembic" / "versions"
            / "c5e8a1f3b2d6_add_sent_premiere_alert.py")
    spec = importlib.util.spec_from_file_location("premiere_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestPremiereBackfill:
    """The migration marks alerts the old exact-day sweep already sent, so the
    first run of the new jobs doesn't send them again."""

    TODAY = date(2026, 10, 12)

    def _season(self, db, show_id, *, days_out, number=1):
        from app.models.season import Season
        from app.models.show import Show

        if db.get(Show, show_id) is None:
            db.add(Show(id=show_id, name=f"Show {show_id}", tracking_count=0))
            db.flush()
        db.add(Season(id=show_id * 100 + number, show_id=show_id, season_number=number,
                      air_date=self.TODAY + timedelta(days=days_out)))

    def _backfill(self, db):
        from app.models.sent_premiere_alert import SentPremiereAlert

        db.commit()
        _premiere_migration()._backfill(db.connection(), self.TODAY)
        db.commit()
        db.expire_all()
        return sorted(
            (a.user_id, a.show_id, a.season_number, a.lead_days)
            for a in db.query(SentPremiereAlert)
        )

    def test_marks_alerts_whose_old_day_has_passed(self, db, seed_users):
        from app.models.watchlist import Watchlist

        self._season(db, 1, days_out=29)
        self._season(db, 2, days_out=6)
        db.add_all([
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=1, notify=True),
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=2, notify=True),
        ])

        assert self._backfill(db) == [
            ("test-uid-1", 1, 1, 30),
            ("test-uid-1", 2, 1, 7),
            ("test-uid-1", 2, 1, 30),
        ]

    def test_seasons_exactly_30_or_7_days_out_keep_todays_alert(self, db, seed_users):
        from app.models.watchlist import Watchlist

        self._season(db, 1, days_out=30)
        self._season(db, 2, days_out=7)
        db.add_all([
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=1, notify=True),
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=2, notify=True),
        ])

        # Show 2's 30-day alert went out 23 days ago; its 7-day alert is today's.
        assert self._backfill(db) == [("test-uid-1", 2, 1, 30)]

    def test_only_trackers_the_old_sweep_alerted(self, db, seed_users):
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        self._season(db, 1, days_out=10)             # muted on the Watchlist
        self._season(db, 2, days_out=10)             # on the Watched list
        self._season(db, 3, days_out=10, number=0)   # specials
        self._season(db, 4, days_out=10)             # nobody tracks it
        db.add_all([
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=1, notify=False),
            Watched(user_id="test-uid-2", content_type="tv", content_id=2),
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=3, notify=True),
        ])

        assert self._backfill(db) == [("test-uid-2", 2, 1, 30)]


class TestPremiereEligible:
    @pytest.mark.parametrize("overrides, eligible", [
        ({}, True),                                    # premium, email on
        ({"subscription_tier": "free"}, False),
        ({"notify_new_seasons": False}, False),
        ({"email_notifications": False}, False),       # no channel left
        ({"email_notifications": False, "push_notifications_enabled": True}, True),
    ])
    def test_premium_users_with_a_channel(self, overrides, eligible):
        from app.services.digest_service import premiere_eligible

        assert premiere_eligible(_user(**overrides)) is eligible


class TestPendingPremiereAlerts:
    ALERT_DATE = date(2026, 10, 12)

    def _season(self, db, show_id, *, days_out, season_id=None, number=1):
        from app.models.season import Season
        from app.models.show import Show

        if db.get(Show, show_id) is None:
            db.add(Show(id=show_id, name=f"Show {show_id}", tracking_count=0))
            db.flush()
        db.add(Season(id=season_id or show_id * 100 + number, show_id=show_id,
                      season_number=number, air_date=self.ALERT_DATE + timedelta(days=days_out)))

    def _pending(self, db):
        from app.models.user import User
        from app.services.digest_service import pending_premiere_alerts

        db.commit()
        return pending_premiere_alerts(db, db.get(User, "test-uid-1"), self.ALERT_DATE)

    @pytest.mark.parametrize("days_out, lead", [
        (30, 30), (20, 30), (8, 30), (7, 7), (1, 7), (31, None), (0, None),
    ])
    def test_lead_by_days_away(self, db, seed_users, days_out, lead):
        from app.models.watchlist import Watchlist

        self._season(db, 10, days_out=days_out)
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=10, notify=True))

        alerts = self._pending(db)
        assert [(a["lead_days"], a["days_away"]) for a in alerts] == (
            [] if lead is None else [(lead, days_out)]
        )

    def test_recorded_alerts_are_not_pending(self, db, seed_users):
        from app.models.sent_premiere_alert import SentPremiereAlert
        from app.models.watchlist import Watchlist

        self._season(db, 10, days_out=20)
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=10, notify=True))
        db.add(SentPremiereAlert(user_id="test-uid-1", show_id=10, season_number=1, lead_days=30))

        assert self._pending(db) == []

    def test_counts_watched_but_not_a_muted_watchlist(self, db, seed_users):
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        self._season(db, 10, days_out=20)
        self._season(db, 11, days_out=20)
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=10, notify=False))
        db.add(Watched(user_id="test-uid-1", content_type="tv", content_id=11))

        assert [a["show_id"] for a in self._pending(db)] == [11]

    def test_two_rows_for_one_season_alert_once(self, db, seed_users):
        from app.models.watchlist import Watchlist

        # TMDb reissued the season's id, leaving two rows (seen for The Rookie).
        self._season(db, 10, days_out=20, season_id=512798)
        self._season(db, 10, days_out=20, season_id=514233)
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=10, notify=True))

        assert len(self._pending(db)) == 1


def test_push_text_matches_the_old_sweep():
    from app.services.digest_service import premiere_push_text

    title, body = premiere_push_text({
        "show_name": "The Rookie", "season_number": 9, "season_name": None,
        "air_date": "2027-01-05", "days_away": 20,
    })

    assert title == "A new season of The Rookie airs in 20 days"
    assert body == "Season 9 releases on January 5, 2027"
