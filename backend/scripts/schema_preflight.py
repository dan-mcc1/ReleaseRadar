"""
Read-only check of a database before deploying migrations: which revision it's
at, how its schema differs from the models (what the reconcile migration
f2b9d4e6a171 will change), and any rows that would make a migration fail.

    python -m scripts.schema_preflight

Uses DATABASE_URL. To check production, set it for this one command; an
environment variable wins over backend/.env:

    $env:DATABASE_URL = "<prod connection string>"; python -m scripts.schema_preflight

Runs in a read-only transaction and changes nothing. Exit code 1 when
something would block the migrations.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

import app.models  # noqa: E402,F401  (registers every table on Base.metadata)
from app.db.base import Base  # noqa: E402
from app.db.migration_filters import include_object  # noqa: E402

# Rows that would make the reconcile migration fail, as (label, SQL count).
BLOCKERS = [
    ("report rows with no reported_id (would block NOT NULL)",
     "SELECT count(*) FROM report WHERE reported_id IS NULL"),
    ("usernames used by more than one account (would block UNIQUE)",
     'SELECT count(*) FROM (SELECT username FROM "user" WHERE username IS NOT NULL '
     "GROUP BY username HAVING count(*) > 1) d"),
    ("episodes whose show no longer exists (would block the episode -> show foreign key)",
     "SELECT count(*) FROM episode e LEFT JOIN show s ON s.id = e.show_id WHERE s.id IS NULL"),
]
# Columns the migrations add themselves; any other missing column blocks the
# reconcile migration, which only changes existing ones.
ADDED_BY_MIGRATIONS = {("user", "terms_accepted_at"), ("user", "terms_version")}
# Worth knowing, but the migration handles them.
NOTES = [
    ("accounts with email_notifications NULL (will be set to false)",
     'SELECT count(*) FROM "user" WHERE email_notifications IS NULL'),
    ("accounts", 'SELECT count(*) FROM "user"'),
]


def _describe(diff) -> list[str]:
    if isinstance(diff, list):
        return [line for d in diff for line in _describe(d)]
    kind = diff[0]
    if kind.startswith("modify_"):
        _, _, table, col, _info, old, new = diff
        return [f"{kind}: {table}.{col}: {old!r} -> {new!r}"]
    if kind in ("add_column", "remove_column"):
        _, _schema, table, col = diff
        return [f"{kind}: {table}.{col.name}"]
    obj = diff[1]
    table = getattr(getattr(obj, "table", None), "name", None) or getattr(obj, "name", "?")
    name = getattr(obj, "name", None)
    if kind in ("add_fk", "remove_fk"):
        return [f"{kind}: {table} ({', '.join(c.name for c in obj.columns)}) ondelete={obj.ondelete}"]
    if kind in ("add_constraint", "remove_constraint"):
        return [f"{kind}: {table} {name or 'unique'} ({', '.join(c.name for c in obj.columns)})"]
    return [f"{kind}: {table}.{name}" if name and name != table else f"{kind}: {table}"]


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set.")
        return 2
    engine = create_engine(url)
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        host = engine.url.host or "?"
        rev = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        print(f"Database: {host}  revision: {rev}")

        ctx = MigrationContext.configure(conn, opts={"compare_type": True, "include_object": include_object})
        raw = compare_metadata(ctx, Base.metadata)
        drift = _describe(raw)
        print(f"\nDifferences from the models ({len(drift)}):")
        for line in drift:
            print(f"  {line}")
        if not drift:
            print("  none")

        flat = [d for item in raw for d in (item if isinstance(item, list) else [item])]
        missing = sorted(
            f"{d[2]}.{d[3].name}" for d in flat
            if d[0] == "add_column" and (d[2], d[3].name) not in ADDED_BY_MIGRATIONS
        )
        blocked = bool(missing)
        print("\nWould block a migration:")
        print(f"  {'!!' if missing else 'ok'}  columns the models have but this database lacks: "
              f"{', '.join(missing) if missing else 0}")
        for label, sql in BLOCKERS:
            n = conn.execute(text(sql)).scalar()
            blocked |= bool(n)
            print(f"  {'!!' if n else 'ok'}  {label}: {n}")
        print("\nFor information:")
        for label, sql in NOTES:
            print(f"      {label}: {conn.execute(text(sql)).scalar()}")
        conn.rollback()

    print("\n" + ("BLOCKED: fix the rows marked !! before deploying." if blocked else "Nothing blocks the migrations."))
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
