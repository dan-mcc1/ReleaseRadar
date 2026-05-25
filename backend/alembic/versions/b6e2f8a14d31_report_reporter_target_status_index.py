"""add ix_report_reporter_target_status

Revision ID: b6e2f8a14d31
Revises: f4c91e7b2a83
Create Date: 2026-05-25 00:00:00.000000

Covers the duplicate-report lookup in moderation.report: same reporter,
same (reported_type, reported_id), status = 'pending'. The existing
ix_report_reporter alone forces a scan over all reports by that user.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b6e2f8a14d31'
down_revision: Union[str, Sequence[str], None] = 'f4c91e7b2a83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_report_reporter_target_status',
        'report',
        ['reporter_id', 'reported_type', 'reported_id', 'status'],
    )


def downgrade() -> None:
    op.drop_index('ix_report_reporter_target_status', table_name='report')
