"""reconcile_schema_drift

Brings a database that was hand-ALTERed before Alembic (prod, the Neon dev
branch) in line with the models. Every step reads the live schema first and
only changes what differs, so on a database built from migrations (CI, a fresh
setup) this does nothing, and it fixes whatever drift dev or prod actually has.

Steps that depend on the data (NOT NULL on report.reported_id, unique
usernames) fail if rows violate them; Postgres DDL is transactional, so a
failure changes nothing. Run `python -m scripts.schema_preflight` against a
database first to see what this will do there and whether anything blocks it.

Revision ID: f2b9d4e6a171
Revises: e5a1c7d2b843
Create Date: 2026-11-12 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2b9d4e6a171"
down_revision: Union[str, Sequence[str], None] = "e5a1c7d2b843"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Free-text columns the models declare as Text; drifted databases have VARCHAR.
# Unbounded VARCHAR -> TEXT is a catalogue-only change in Postgres (no rewrite).
TEXT_COLUMNS = [
    ("episode_watched", "notes"),
    ("report", "message"),
    ("report", "snapshot_review_text"),
    ("user", "suspension_reason"),
    ("user", "ban_reason"),
    ("user", "bio"),
]

# Float in the models (double precision); drifted databases have NUMERIC or,
# for activity.rating, INTEGER (which truncated half-star ratings).
FLOAT_COLUMNS = [
    ("show", "vote_average"),
    ("movie", "vote_average"),
    ("activity", "rating"),
]

USER_CONTENT_INDEXES = [
    ("ix_currently_watching_user_content", "currently_watching"),
    ("ix_episode_watched_user_show", "episode_watched"),
    ("ix_watched_user_content", "watched"),
    ("ix_watchlist_user_content", "watchlist"),
]
INDEX_COLUMNS = {
    "ix_currently_watching_user_content": ["user_id", "content_type", "content_id"],
    "ix_episode_watched_user_show": ["user_id", "show_id"],
    "ix_watched_user_content": ["user_id", "content_type", "content_id"],
    "ix_watchlist_user_content": ["user_id", "content_type", "content_id"],
}


def upgrade() -> None:
    bind = op.get_bind()

    def insp():
        # Fresh each time: earlier steps change what's there.
        return sa.inspect(bind)

    def column(table: str, name: str) -> dict:
        col = next((c for c in insp().get_columns(table) if c["name"] == name), None)
        if col is None:
            # Adding columns isn't this migration's job; scripts.schema_preflight
            # reports a missing one as a blocker before deploy.
            raise RuntimeError(f"{table}.{name} is missing from this database; add it before reconciling")
        return col

    # 1. Free-text columns -> TEXT.
    for table, name in TEXT_COLUMNS:
        col = column(table, name)
        if not isinstance(col["type"], sa.Text):
            op.alter_column(table, name, type_=sa.Text(), existing_nullable=col["nullable"])

    # 2. Numeric columns -> double precision (REAL is a Float too, but only
    #    4 bytes, so match the exact type).
    for table, name in FLOAT_COLUMNS:
        col = column(table, name)
        if not isinstance(col["type"], sa.DOUBLE_PRECISION):
            op.alter_column(
                table,
                name,
                type_=sa.Float(),
                existing_nullable=col["nullable"],
                postgresql_using=f"{name}::double precision",
            )

    # 3. Nullability.
    if not column("user", "username")["nullable"]:
        # Google/Microsoft/Facebook sign-ups create the account first and pick
        # a username on the next screen, so it must be allowed to be empty.
        op.alter_column("user", "username", existing_type=sa.String(), nullable=True)
    if column("user", "email_notifications")["nullable"]:
        op.execute(sa.text('UPDATE "user" SET email_notifications = false WHERE email_notifications IS NULL'))
        op.alter_column("user", "email_notifications", existing_type=sa.Boolean(), nullable=False)
    if column("report", "reported_id")["nullable"]:
        op.alter_column("report", "reported_id", existing_type=sa.String(), nullable=False)

    # 4. Unique usernames (a unique constraint or a unique index either way).
    i = insp()
    has_unique = any(
        uc["column_names"] == ["username"] for uc in i.get_unique_constraints("user")
    ) or any(ix["unique"] and ix["column_names"] == ["username"] for ix in i.get_indexes("user"))
    if not has_unique:
        op.create_unique_constraint("user_username_key", "user", ["username"])

    # 5. Missing lookup indexes.
    for name, table in USER_CONTENT_INDEXES:
        if name not in {ix["name"] for ix in insp().get_indexes(table)}:
            op.create_index(name, table, INDEX_COLUMNS[name], unique=False)

    # 6. episode.show_id: cascade with its show (the cache prune deletes shows).
    fk = next(
        (f for f in insp().get_foreign_keys("episode") if f["constrained_columns"] == ["show_id"]),
        None,
    )
    if fk is None or (fk.get("options") or {}).get("ondelete", "").upper() != "CASCADE":
        if fk is not None:
            op.drop_constraint(fk["name"], "episode", type_="foreignkey")
        op.create_foreign_key(
            "episode_show_id_fkey", "episode", "show", ["show_id"], ["id"], ondelete="CASCADE"
        )

    # 7. banned_email.user_id: no foreign key. A ban must outlive the account
    #    and keep recording which account it was (account_service.delete_user_data);
    #    the hand-made ON DELETE SET NULL key on drifted databases erased that.
    for f in insp().get_foreign_keys("banned_email"):
        if f["constrained_columns"] == ["user_id"]:
            op.drop_constraint(f["name"], "banned_email", type_="foreignkey")


def downgrade() -> None:
    """Nothing to undo: the upgrade only removed drift, and which drift a given
    database had isn't recorded."""
