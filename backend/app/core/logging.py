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
