"""add_performance_indexes

Revision ID: a1f3e9b2c845
Revises: 0bda5db5c752
Create Date: 2026-05-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1f3e9b2c845'
down_revision: Union[str, Sequence[str], None] = '0bda5db5c752'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # for_you seeds + profile preview + streak CTE
    op.create_index(
        'ix_watched_user_watched_at',
        'watched',
        ['user_id', sa.text('watched_at DESC')],
    )
    op.create_index(
        'ix_watched_user_rating_watched_at',
        'watched',
        ['user_id', sa.text('rating DESC NULLS LAST'), sa.text('watched_at DESC')],
        postgresql_where=sa.text('rating IS NOT NULL'),
    )

    # Watchlist sort order
    op.create_index(
        'ix_watchlist_user_sort',
        'watchlist',
        ['user_id', 'sort_key'],
    )

    # Digest sweep — only notify=true rows
    op.create_index(
        'ix_watchlist_user_type_notify',
        'watchlist',
        ['user_id', 'content_type'],
        postgresql_where=sa.text('notify = true'),
    )

    # Filter providers to flatrate before joining
    op.create_index(
        'ix_movie_provider_flatrate',
        'movie_provider',
        ['movie_id'],
        postgresql_where=sa.text('flatrate = true'),
    )
    op.create_index(
        'ix_show_provider_flatrate',
        'show_provider',
        ['show_id'],
        postgresql_where=sa.text('flatrate = true'),
    )

    # Activity feed multi-user IN with global ORDER BY
    op.create_index(
        'ix_activity_created_user',
        'activity',
        [sa.text('created_at DESC'), 'user_id'],
    )

    # Index-only scan for reactivation check
    op.create_index(
        'ix_ew_user_show_covering',
        'episode_watched',
        ['user_id', 'show_id'],
        postgresql_include=['season_number', 'episode_number'],
    )

    # Skip already-filled rows on episode refresh
    op.create_index(
        'ix_episode_show_unfilled',
        'episode',
        ['show_id'],
        postgresql_where=sa.text('air_date IS NULL OR name IS NULL OR still_path IS NULL'),
    )


def downgrade() -> None:
    op.drop_index('ix_episode_show_unfilled', table_name='episode')
    op.drop_index('ix_ew_user_show_covering', table_name='episode_watched')
    op.drop_index('ix_activity_created_user', table_name='activity')
    op.drop_index('ix_show_provider_flatrate', table_name='show_provider')
    op.drop_index('ix_movie_provider_flatrate', table_name='movie_provider')
    op.drop_index('ix_watchlist_user_type_notify', table_name='watchlist')
    op.drop_index('ix_watchlist_user_sort', table_name='watchlist')
    op.drop_index('ix_watched_user_rating_watched_at', table_name='watched')
    op.drop_index('ix_watched_user_watched_at', table_name='watched')
