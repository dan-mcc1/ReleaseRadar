"""
Failures in background work must reach the logs (and Sentry) with their
traceback, and the app's own INFO lines must be emitted at all.

print() never reaches Sentry, and logger.error("...: %s", e) drops the stack.
"""

import logging
from unittest.mock import patch


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

    def test_durable_queue_info_lines_are_emitted_formatted(self, capsys):
        from app.core.logging import setup_logging

        queue_logger = logging.getLogger("durable_queue")
        saved = queue_logger.handlers[:]
        try:
            setup_logging()
            logging.getLogger("durable_queue.runner").info("worker restarted")
            err = capsys.readouterr().err
        finally:
            queue_logger.handlers[:] = saved

        # Formatted, not bare: logging's last-resort handler would print only
        # the message, and only at WARNING and above.
        assert "INFO durable_queue.runner: worker restarted" in err

    def test_setup_is_idempotent(self):
        from app.core.logging import setup_logging

        loggers = [logging.getLogger("app"), logging.getLogger("durable_queue")]
        saved = [named.handlers[:] for named in loggers]
        try:
            setup_logging()
            setup_logging()
            counts = [len(named.handlers) for named in loggers]
        finally:
            for named, handlers in zip(loggers, saved):
                named.handlers[:] = handlers

        assert counts == [1, 1]


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
