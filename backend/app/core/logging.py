import logging
from contextvars import ContextVar
from uvicorn.logging import AccessFormatter

request_elapsed_ms: ContextVar[float | None] = ContextVar(
    "request_elapsed_ms", default=None
)


class TimedAccessFormatter(AccessFormatter):
    def formatMessage(self, record: logging.LogRecord) -> str:
        msg = super().formatMessage(record)
        elapsed = request_elapsed_ms.get()
        if elapsed is not None:
            msg += f" ({elapsed:.0f}ms)"
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
