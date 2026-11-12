"""add_terms_acceptance

Records when each account agreed to the Terms of Service and Privacy Policy,
and which version. Set at sign-up from now on.

Existing accounts are filled in with the current version and the migration's
time: when this ran (2026-11-12) the app had no users besides the owner's own
and test accounts, so there was no one whose acceptance this would misstate.

Revision ID: e5a1c7d2b843
Revises: d7b4e2a9f316
Create Date: 2026-11-12 14:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e5a1c7d2b843"
down_revision: Union[str, Sequence[str], None] = "d7b4e2a9f316"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Fixed here rather than imported: a migration must keep meaning what it meant
# when it was written, whatever app.config.legal.TERMS_VERSION later becomes.
TERMS_VERSION_AT_MIGRATION = "2026-06-02"


def upgrade() -> None:
    op.add_column("user", sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("user", sa.Column("terms_version", sa.String(), nullable=True))
    op.execute(
        sa.text('UPDATE "user" SET terms_accepted_at = now(), terms_version = :v').bindparams(
            v=TERMS_VERSION_AT_MIGRATION
        )
    )


def downgrade() -> None:
    op.drop_column("user", "terms_version")
    op.drop_column("user", "terms_accepted_at")
