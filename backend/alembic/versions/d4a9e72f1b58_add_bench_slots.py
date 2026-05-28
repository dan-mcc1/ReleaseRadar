"""add_bench_slots

Adds a per-league bench_slots configuration. Bench is implemented as a value
of FantasyAsset.slot_type (alongside movie/tv/flex) — no new tables. Benched
assets score zero points.

Revision ID: d4a9e72f1b58
Revises: b2f7e493a51c
Create Date: 2026-05-28 03:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4a9e72f1b58"
down_revision: Union[str, Sequence[str], None] = "b2f7e493a51c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "fantasy_league",
        sa.Column(
            "bench_slots",
            sa.Integer(),
            nullable=False,
            server_default="4",
        ),
    )


def downgrade() -> None:
    op.drop_column("fantasy_league", "bench_slots")
