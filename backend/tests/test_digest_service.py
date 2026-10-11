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
