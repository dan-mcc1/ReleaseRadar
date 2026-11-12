"""What schema comparisons (alembic autogenerate/check, scripts.schema_preflight)
should ignore because the models deliberately don't describe it."""

# durable-queue's tables (migration 7d1e4c2b9a50). They aren't ORM models, so
# without this autogenerate would propose dropping them.
QUEUE_TABLES = {"jobs", "effects", "schedules"}

# Partial, covering and DESC indexes from migration a1f3e9b2c845 that the
# models don't declare. Without this, autogenerate proposes dropping them.
MIGRATION_ONLY_INDEXES = {
    "ix_watched_user_watched_at",
    "ix_watched_user_rating_watched_at",
    "ix_watchlist_user_sort",
    "ix_watchlist_user_type_notify",
    "ix_movie_provider_flatrate",
    "ix_show_provider_flatrate",
    "ix_activity_created_user",
    "ix_ew_user_show_covering",
    "ix_episode_show_unfilled",
}


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and name in QUEUE_TABLES:
        return False
    if type_ == "index" and name in MIGRATION_ONLY_INDEXES:
        return False
    return True
