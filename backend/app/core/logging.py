import logging
import time
from contextvars import ContextVar
from dataclasses import dataclass
from uvicorn.logging import AccessFormatter

request_elapsed_ms: ContextVar[float | None] = ContextVar(
    "request_elapsed_ms", default=None
)


@dataclass
class RequestStats:
    """SQL statements one request ran and the time spent in them."""

    queries: int = 0
    db_ms: float = 0.0


# Set to a fresh RequestStats at the start of each request. It's a mutable
# object, not a counter, on purpose: sync routes and dependencies run in a
# threadpool with a copy of the context, so a ContextVar.set() there never
# reaches the middleware, but the copy still points at the same object.
request_stats: ContextVar[RequestStats | None] = ContextVar("request_stats", default=None)


class TimedAccessFormatter(AccessFormatter):
    def formatMessage(self, record: logging.LogRecord) -> str:
        msg = super().formatMessage(record)
        elapsed = request_elapsed_ms.get()
        stats = request_stats.get()
        queries = stats.queries if stats else 0
        if elapsed is not None or queries:
            extras = []
            if elapsed is not None:
                extras.append(f"{elapsed:.0f}ms")
            if queries:
                extras.append(f"{queries}q")
            msg += " (" + ", ".join(extras) + ")"
        return msg


def setup_logging():
    handler = logging.StreamHandler()
    handler.setFormatter(
        TimedAccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s')
    )

    logger = logging.getLogger("uvicorn.access")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.propagate = False
    logger.setLevel(logging.INFO)

    # The app's own loggers (logging.getLogger(__name__) under app.*), and
    # durable_queue's (the job queue's reconnects, slot errors and loop
    # crashes). uvicorn only configures its own, so without this INFO lines
    # were dropped and warnings/errors went out bare through logging's
    # last-resort handler. Still propagates, so pytest's caplog and any root
    # handlers see them; Sentry hooks every logger and records ERROR and
    # above as events.
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    for name in ("app", "durable_queue"):
        named_handler = logging.StreamHandler()
        named_handler.setFormatter(formatter)
        named_logger = logging.getLogger(name)
        named_logger.handlers.clear()
        named_logger.addHandler(named_handler)
        named_logger.setLevel(logging.INFO)


def install_query_counter(engine):
    """Register SQLAlchemy listeners that add each statement, and the time it
    took, to the current request's RequestStats. Statements outside a request
    (jobs, startup) are ignored. Connection checkout, BEGIN and ROLLBACK
    aren't cursor executions, so they aren't counted. Call once at startup."""
    from sqlalchemy import event

    @event.listens_for(engine, "before_cursor_execute")
    def _start_query(conn, cursor, statement, parameters, context, executemany):
        stats = request_stats.get()
        if stats is not None:
            stats.queries += 1
            if context is not None:
                context._rr_started = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def _end_query(conn, cursor, statement, parameters, context, executemany):
        stats = request_stats.get()
        started = getattr(context, "_rr_started", None)
        if stats is not None and started is not None:
            stats.db_ms += (time.perf_counter() - started) * 1000
