"""The decorator every ReleaseRadar job uses in place of durable-queue's @task."""
import functools
import logging
from collections.abc import Callable
from typing import Any

from durable_queue.registry import task

logger = logging.getLogger(__name__)


def logged_task(fn: Callable[..., Any] | None = None, **options: Any) -> Any:
    """
    durable-queue's @task (same options), plus a traceback in the logs when
    the job raises. durable-queue only writes the exception's message to the
    job row, so without this a failing job never reaches the logs or Sentry.
    Every failed attempt logs, not just the last.

    The exception is re-raised so durable-queue still retries the job. The
    task is registered under the function's name, which must be unique
    app-wide.
    """
    def register(fn: Callable[..., Any]) -> Callable[..., Any]:
        # wraps() keeps the name durable-queue registers under, and sets
        # __wrapped__, which inspect.signature follows when durable-queue
        # checks for a `conn` parameter.
        @functools.wraps(fn)
        def run(**kwargs: Any) -> Any:
            try:
                return fn(**kwargs)
            except Exception:
                logger.exception("job %s failed", fn.__name__)
                raise

        return task(run, **options)

    if fn is None:
        return register
    return register(fn)
