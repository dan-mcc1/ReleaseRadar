"""The episode-alert scheduler in app.main: plan hourly, sleep until each alert
is due, and touch the database only to plan and to send."""

import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

import pytest

from app.services.episode_alert_service import PlannedAlert


class _Stop(BaseException):
    """Ends the infinite loop from inside a fake sleep."""


def _run_loop(plan, send, max_sleeps):
    from app import main

    sleeps: list[float] = []
    sessions: list[str] = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= max_sleeps:
            raise _Stop

    @contextmanager
    def fake_session():
        sessions.append("open")
        yield object()

    async def run():
        with patch.object(main.asyncio, "sleep", fake_sleep), \
             patch.object(main, "_db_session", fake_session), \
             patch.object(main, "plan_episode_alerts", side_effect=plan), \
             patch.object(main, "send_planned_alert", side_effect=send):
            with pytest.raises(_Stop):
                await main._episode_alert_loop()

    # A private loop: asyncio.run() would unset the thread's current loop,
    # which other tests (e.g. test_tmdb_client) rely on.
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()
    return sleeps, sessions


def _alert(send_at):
    return PlannedAlert(send_at=send_at, user_id="u1", show_id=1, episode_ids=(10,), lead=0)


def test_sleeps_until_each_alert_then_until_the_next_hour():
    now = datetime.now(dt_timezone.utc)
    alert = _alert(now + timedelta(minutes=10))
    windows, sent = [], []

    def plan(db, start, end):
        windows.append((start, end))
        return [alert]

    def send(db, a):
        sent.append(a)
        return True

    sleeps, sessions = _run_loop(plan, send, max_sleeps=2)

    start, end = windows[0]
    assert end == now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    assert sleeps[0] == pytest.approx(600, abs=2)  # until the alert is due
    assert sent == [alert]
    assert sleeps[1] == pytest.approx((end - now).total_seconds(), abs=2)  # until the top of the hour
    # One session to plan, one to send; nothing while idle.
    assert sessions == ["open", "open"]


def test_overdue_alerts_send_without_sleeping():
    now = datetime.now(dt_timezone.utc)
    overdue = _alert(now - timedelta(minutes=2))
    sent = []
    sleeps, _ = _run_loop(lambda db, s, e: [overdue], lambda db, a: sent.append(a) or True, max_sleeps=1)
    assert sent == [overdue]
    assert len(sleeps) == 1  # only the sleep until the next hour


def test_replans_from_now_after_an_error():
    calls = []

    def plan(db, start, end):
        calls.append((start, end))
        if len(calls) == 1:
            raise RuntimeError("database unavailable")
        return []

    sleeps, _ = _run_loop(plan, lambda db, a: True, max_sleeps=2)
    assert sleeps[0] == 60  # back-off after the error
    retry_start, _ = calls[1]
    # Re-planned from roughly now minus the late-grace window, not skipped ahead.
    assert retry_start <= datetime.now(dt_timezone.utc)
