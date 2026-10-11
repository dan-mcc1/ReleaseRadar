import logging
from contextvars import ContextVar
from uvicorn.logging import AccessFormatter

request_elapsed_ms: ContextVar[float | None] = ContextVar(
    "request_elapsed_ms", default=None
)
request_query_count: ContextVar[int] = ContextVar("request_query_count", default=0)


class TimedAccessFormatter(AccessFormatter):
    def formatMessage(self, record: logging.LogRecord) -> str:
        msg = super().formatMessage(record)
        elapsed = request_elapsed_ms.get()
        queries = request_query_count.get()
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
    """Register a SQLAlchemy listener that increments request_query_count
    for each statement executed. Idempotent — safe to call once at startup."""
    from sqlalchemy import event

    @event.listens_for(engine, "before_cursor_execute")
    def _count_query(conn, cursor, statement, parameters, context, executemany):
        try:
            request_query_count.set(request_query_count.get() + 1)
        except LookupError:
            # No request context (background task, startup) — ignore.
            pass
