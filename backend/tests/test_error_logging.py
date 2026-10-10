"""
Failures in background work must reach the logs (and Sentry) with their
traceback, and the app's own INFO lines must be emitted at all.

print() never reaches Sentry, and logger.error("...: %s", e) drops the stack.
"""

import asyncio
import logging
from unittest.mock import patch

import pytest


def _errors_with_traceback(caplog, level=logging.ERROR):
    return [r for r in caplog.records if r.levelno >= level and r.exc_info]


class TestAppLoggerSetup:
    def test_app_info_lines_are_emitted(self, capsys):
        from app.core.logging import setup_logging

        app_logger = logging.getLogger("app")
        saved = app_logger.handlers[:]
        try:
            setup_logging()
            logging.getLogger("app.services.example").info("nightly job finished")
            err = capsys.readouterr().err
        finally:
            app_logger.handlers[:] = saved

        assert "nightly job finished" in err
        assert "app.services.example" in err

    def test_setup_is_idempotent(self):
        from app.core.logging import setup_logging

        app_logger = logging.getLogger("app")
        saved = app_logger.handlers[:]
        try:
            setup_logging()
            setup_logging()
            count = len(app_logger.handlers)
        finally:
            app_logger.handlers[:] = saved

        assert count == 1


class TestBackgroundFailuresAreLogged:
    def test_populate_movie_bg_logs_traceback(self, db, caplog):
        from app.models.movie import Movie
        from app.services.media_upsert import populate_movie_bg

        db.add(Movie(id=777, title="", tracking_count=1, updated_at=None))
        db.commit()
        with patch(
            "app.services.media_upsert.fetch_movie_from_tmdb",
            side_effect=RuntimeError("tmdb down"),
        ), caplog.at_level(logging.ERROR):
            populate_movie_bg(777)

        logged = _errors_with_traceback(caplog)
        assert [str(r.exc_info[1]) for r in logged] == ["tmdb down"]

    def test_provider_backfill_failure_is_logged(self, db, caplog):
        from app.services.streaming_notification_service import ensure_providers_populated

        with patch(
            "app.services.streaming_notification_service._fetch_fresh_us_providers",
            side_effect=RuntimeError("tmdb down"),
        ), caplog.at_level(logging.WARNING):
            ensure_providers_populated(db, 777, "movie")

        logged = _errors_with_traceback(caplog, logging.WARNING)
        assert [str(r.exc_info[1]) for r in logged] == ["tmdb down"]

    def test_scheduler_loop_failure_logs_traceback(self, caplog):
        from app import main

        with patch.object(main, "delete_old_activity", side_effect=RuntimeError("db gone")), \
             patch.object(main.asyncio, "sleep", side_effect=asyncio.CancelledError), \
             caplog.at_level(logging.ERROR):
            # A private loop: asyncio.run() would clear the main thread's
            # current event loop, which other tests rely on.
            loop = asyncio.new_event_loop()
            try:
                with pytest.raises(asyncio.CancelledError):
                    loop.run_until_complete(main._activity_cleanup_loop())
            finally:
                loop.close()

        logged = _errors_with_traceback(caplog)
        assert [str(r.exc_info[1]) for r in logged] == ["db gone"]
