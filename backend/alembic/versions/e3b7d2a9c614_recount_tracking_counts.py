"""recount_tracking_counts

tracking_count is now recomputed from the list rows on every add/remove
(media_upsert.recount_tracking) instead of +1/-1 bookkeeping. This one-time
backfill corrects counts that drifted under the old scheme, and adds
(content_type, content_id) indexes so the per-title recount — and the
existing "who tracks this title" lookups — don't scan whole list tables.

Revision ID: e3b7d2a9c614
Revises: a7c2e5d18f94
Create Date: 2026-10-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e3b7d2a9c614"
down_revision: Union[str, Sequence[str], None] = "a7c2e5d18f94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LISTS = ("watchlist", "currently_watching", "watched")
_TITLES = (("show", "tv"), ("movie", "movie"))


def upgrade() -> None:
    for table in _LISTS:
        op.create_index(f"ix_{table}_content", table, ["content_type", "content_id"])

    for title_table, content_type in _TITLES:
        trackers = " UNION ALL ".join(
            f"SELECT user_id, content_id FROM {t} WHERE content_type = '{content_type}'"
            for t in _LISTS
        )
        op.execute(f"""
            UPDATE {title_table} SET tracking_count = t.n
            FROM (
                SELECT content_id, COUNT(DISTINCT user_id) AS n
                FROM ({trackers}) AS lists
                GROUP BY content_id
            ) AS t
            WHERE {title_table}.id = t.content_id
              AND {title_table}.tracking_count IS DISTINCT FROM t.n
        """)
        untracked = " AND ".join(
            f"NOT EXISTS (SELECT 1 FROM {t} WHERE {t}.content_type = '{content_type}'"
            f" AND {t}.content_id = {title_table}.id)"
            for t in _LISTS
        )
        op.execute(f"""
            UPDATE {title_table} SET tracking_count = 0
            WHERE tracking_count IS DISTINCT FROM 0 AND {untracked}
        """)


def downgrade() -> None:
    # The recount is a data correction; there's nothing to restore.
    for table in _LISTS:
        op.drop_index(f"ix_{table}_content", table_name=table)
