"""
Background jobs, run by durable-queue (github.com/dan-mcc1/durable-queue).

Every task module is imported here so its @logged_task functions are
registered before a worker looks one up by name.
"""
from app.jobs import maintenance  # noqa: F401
