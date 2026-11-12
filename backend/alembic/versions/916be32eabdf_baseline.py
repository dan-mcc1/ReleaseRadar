"""baseline

The schema as it stood when Alembic was adopted (commit b273a68), minus the
four migrations that shipped in that same commit (ical_token_version,
last_digest_sent_at, processed_stripe_events, ck_friendship_status). It lets
`alembic upgrade head` build a fresh database from nothing; CI checks that the
result matches the models.

Databases that predate Alembic (prod, the Neon dev branch) were stamped at
this revision, so this upgrade never runs on them. Run against a database that
already has these tables it fails on the first CREATE TABLE and, Postgres DDL
being transactional, changes nothing.

Revision ID: 916be32eabdf
Revises: 
Create Date: 2026-05-21 00:59:52.292572

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '916be32eabdf'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('appeal',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('appeal_type', sa.String(), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('request_unsilence', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('admin_notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_appeal_user_id'), 'appeal', ['user_id'], unique=False)
    op.create_index('ix_appeal_user_status', 'appeal', ['user_id', 'status'], unique=False)
    op.create_table('banned_email',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('banned_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_banned_email_email'), 'banned_email', ['email'], unique=True)
    op.create_index(op.f('ix_banned_email_user_id'), 'banned_email', ['user_id'], unique=False)
    op.create_table('genre',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('movie',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('imdb_id', sa.String(), nullable=True),
    sa.Column('backdrop_path', sa.String(), nullable=True),
    sa.Column('logo_path', sa.String(), nullable=True),
    sa.Column('budget', sa.Float(), nullable=True),
    sa.Column('homepage', sa.String(), nullable=True),
    sa.Column('overview', sa.Text(), nullable=True),
    sa.Column('tagline', sa.String(), nullable=True),
    sa.Column('poster_path', sa.String(), nullable=True),
    sa.Column('release_date', sa.Date(), nullable=True),
    sa.Column('revenue', sa.Float(), nullable=True),
    sa.Column('runtime', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('title', sa.String(), nullable=True),
    sa.Column('tracking_count', sa.Integer(), nullable=True),
    sa.Column('vote_average', sa.Float(), nullable=True),
    sa.Column('certification', sa.String(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('provider',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('logo_path', sa.String(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('rewatch',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('content_type', sa.String(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('watched_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('rating', sa.Float(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('would_rewatch', sa.Boolean(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_rewatch_user_content', 'rewatch', ['user_id', 'content_type', 'content_id'], unique=False)
    op.create_index(op.f('ix_rewatch_user_id'), 'rewatch', ['user_id'], unique=False)
    op.create_table('show',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('backdrop_path', sa.String(), nullable=True),
    sa.Column('logo_path', sa.String(), nullable=True),
    sa.Column('first_air_date', sa.Date(), nullable=True),
    sa.Column('last_air_date', sa.Date(), nullable=True),
    sa.Column('homepage', sa.String(), nullable=True),
    sa.Column('in_production', sa.Boolean(), nullable=True),
    sa.Column('number_of_seasons', sa.Integer(), nullable=True),
    sa.Column('number_of_episodes', sa.Integer(), nullable=True),
    sa.Column('overview', sa.Text(), nullable=True),
    sa.Column('poster_path', sa.String(), nullable=True),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('tagline', sa.String(), nullable=True),
    sa.Column('type', sa.String(), nullable=True),
    sa.Column('tracking_count', sa.Integer(), nullable=True),
    sa.Column('air_time', sa.String(), nullable=True),
    sa.Column('air_timezone', sa.String(), nullable=True),
    sa.Column('vote_average', sa.Float(), nullable=True),
    sa.Column('certification', sa.String(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('subscriptions',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('source', sa.String(), nullable=True),
    sa.Column('stripe_customer_id', sa.String(), nullable=True),
    sa.Column('stripe_subscription_id', sa.String(), nullable=True),
    sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancel_at_period_end', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscriptions_stripe_customer_id'), 'subscriptions', ['stripe_customer_id'], unique=True)
    op.create_index(op.f('ix_subscriptions_stripe_subscription_id'), 'subscriptions', ['stripe_subscription_id'], unique=True)
    op.create_index(op.f('ix_subscriptions_user_id'), 'subscriptions', ['user_id'], unique=True)
    op.create_table('user',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('email', sa.String(), nullable=True),
    sa.Column('username', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('email_notifications', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('notification_frequency', sa.String(), server_default='daily', nullable=False),
    sa.Column('profile_visibility', sa.String(), server_default='friends_only', nullable=False),
    sa.Column('avatar_key', sa.String(), nullable=True),
    sa.Column('bio', sa.String(), nullable=True),
    sa.Column('subscription_tier', sa.String(), server_default='free', nullable=False),
    sa.Column('notify_new_seasons', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('notify_streaming_changes', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('notify_trailers', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('digest_hour', sa.Integer(), server_default='9', nullable=False),
    sa.Column('digest_timezone', sa.String(), server_default='America/New_York', nullable=False),
    sa.Column('onboarding_completed', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('letterboxd_prompted', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('is_suspended', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('suspended_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('suspension_reason', sa.Text(), nullable=True),
    sa.Column('warning_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('has_unread_warning', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('is_banned', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('ban_reason', sa.Text(), nullable=True),
    sa.Column('is_silenced', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('silenced_until', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('username')
    )
    op.create_table('activity',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('activity_type', sa.String(), nullable=False),
    sa.Column('content_type', sa.String(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('content_title', sa.Text(), nullable=True),
    sa.Column('content_poster_path', sa.Text(), nullable=True),
    sa.Column('rating', sa.Float(), nullable=True),
    sa.Column('season_number', sa.Integer(), nullable=True),
    sa.Column('episode_number', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_activity_created_at', 'activity', ['created_at'], unique=False)
    op.create_index('ix_activity_user_created_at', 'activity', ['user_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_activity_user_id'), 'activity', ['user_id'], unique=False)
    op.create_table('block',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('blocker_id', sa.String(), nullable=False),
    sa.Column('blocked_id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['blocked_id'], ['user.id'], ),
    sa.ForeignKeyConstraint(['blocker_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('blocker_id', 'blocked_id', name='uq_block_pair')
    )
    op.create_index('ix_block_blocked', 'block', ['blocked_id'], unique=False)
    op.create_index('ix_block_blocker', 'block', ['blocker_id'], unique=False)
    op.create_table('currently_watching',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('content_type', sa.String(), nullable=True),
    sa.Column('content_id', sa.Integer(), nullable=True),
    sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'content_type', 'content_id', name='uq_currently_watching_user_content')
    )
    op.create_index('ix_currently_watching_user_content', 'currently_watching', ['user_id', 'content_type', 'content_id'], unique=False)
    op.create_index(op.f('ix_currently_watching_user_id'), 'currently_watching', ['user_id'], unique=False)
    op.create_table('episode',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('show_id', sa.Integer(), nullable=False),
    sa.Column('season_number', sa.Integer(), nullable=False),
    sa.Column('episode_number', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=True),
    sa.Column('overview', sa.Text(), nullable=True),
    sa.Column('air_date', sa.Date(), nullable=True),
    sa.Column('runtime', sa.Integer(), nullable=True),
    sa.Column('still_path', sa.String(), nullable=True),
    sa.Column('vote_average', sa.Float(), nullable=True),
    sa.Column('episode_type', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['show_id'], ['show.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('show_id', 'season_number', 'episode_number', name='uq_show_season_episode')
    )
    op.create_index('ix_episode_air_date', 'episode', ['air_date'], unique=False)
    op.create_index('ix_episode_show_air_date', 'episode', ['show_id', 'air_date'], unique=False)
    op.create_table('favorite',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('content_type', sa.String(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'content_type', 'content_id', name='uq_favorite_user_content')
    )
    op.create_index(op.f('ix_favorite_user_id'), 'favorite', ['user_id'], unique=False)
    op.create_table('feedback',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('category', sa.String(), nullable=False),
    sa.Column('subject', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('status', sa.String(), server_default='open', nullable=False),
    sa.Column('admin_notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_feedback_category', 'feedback', ['category'], unique=False)
    op.create_index('ix_feedback_created_at', 'feedback', ['created_at'], unique=False)
    op.create_index('ix_feedback_status', 'feedback', ['status'], unique=False)
    op.create_table('finish_by_goal',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('show_id', sa.Integer(), nullable=False),
    sa.Column('target_date', sa.Date(), nullable=False),
    sa.ForeignKeyConstraint(['show_id'], ['show.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'show_id', name='uq_finish_by_user_show')
    )
    op.create_index('ix_finish_by_user_show', 'finish_by_goal', ['user_id', 'show_id'], unique=False)
    op.create_table('friendship',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('requester_id', sa.String(), nullable=False),
    sa.Column('addressee_id', sa.String(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('message', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['addressee_id'], ['user.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['requester_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('requester_id', 'addressee_id', name='uq_friendship_pair')
    )
    op.create_index(op.f('ix_friendship_addressee_id'), 'friendship', ['addressee_id'], unique=False)
    op.create_index('ix_friendship_addressee_status', 'friendship', ['addressee_id', 'status'], unique=False)
    op.create_index(op.f('ix_friendship_requester_id'), 'friendship', ['requester_id'], unique=False)
    op.create_index('ix_friendship_requester_status', 'friendship', ['requester_id', 'status'], unique=False)
    op.create_table('movie_genre',
    sa.Column('movie_id', sa.Integer(), nullable=False),
    sa.Column('genre_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['genre_id'], ['genre.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['movie_id'], ['movie.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('movie_id', 'genre_id')
    )
    op.create_table('movie_provider',
    sa.Column('movie_id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('flatrate', sa.Boolean(), nullable=True),
    sa.Column('rent', sa.Boolean(), nullable=True),
    sa.Column('buy', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['movie_id'], ['movie.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['provider_id'], ['provider.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('movie_id', 'provider_id')
    )
    op.create_table('movie_video',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('movie_id', sa.Integer(), nullable=False),
    sa.Column('video_key', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=True),
    sa.Column('first_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['movie_id'], ['movie.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_movie_video_movie_id'), 'movie_video', ['movie_id'], unique=False)
    op.create_table('recommendation',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('sender_id', sa.String(), nullable=False),
    sa.Column('recipient_id', sa.String(), nullable=False),
    sa.Column('content_type', sa.String(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('content_title', sa.Text(), nullable=True),
    sa.Column('content_poster_path', sa.Text(), nullable=True),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('is_read', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['recipient_id'], ['user.id'], ),
    sa.ForeignKeyConstraint(['sender_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_recommendation_created_at', 'recommendation', ['created_at'], unique=False)
    op.create_index(op.f('ix_recommendation_recipient_id'), 'recommendation', ['recipient_id'], unique=False)
    op.create_index('ix_recommendation_recipient_read_created', 'recommendation', ['recipient_id', 'is_read', 'created_at'], unique=False)
    op.create_index(op.f('ix_recommendation_sender_id'), 'recommendation', ['sender_id'], unique=False)
    op.create_table('report',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('reporter_id', sa.String(), nullable=True),
    sa.Column('reported_type', sa.String(), nullable=False),
    sa.Column('reported_id', sa.String(), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('status', sa.String(), server_default='pending', nullable=False),
    sa.Column('admin_notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('snapshot_author_id', sa.String(), nullable=True),
    sa.Column('snapshot_author_username', sa.String(), nullable=True),
    sa.Column('snapshot_content_type', sa.String(), nullable=True),
    sa.Column('snapshot_content_id', sa.Integer(), nullable=True),
    sa.Column('snapshot_review_text', sa.Text(), nullable=True),
    sa.Column('snapshot_review_created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('snapshot_user_username', sa.String(), nullable=True),
    sa.Column('snapshot_user_email', sa.String(), nullable=True),
    sa.Column('snapshot_user_created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['reporter_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_report_reporter', 'report', ['reporter_id'], unique=False)
    op.create_index('ix_report_status', 'report', ['status'], unique=False)
    op.create_table('review',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('content_type', sa.String(), nullable=True),
    sa.Column('content_id', sa.Integer(), nullable=True),
    sa.Column('review_text', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'content_type', 'content_id', name='uq_review_user_content')
    )
    op.create_index(op.f('ix_review_user_id'), 'review', ['user_id'], unique=False)
    op.create_table('season',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('show_id', sa.Integer(), nullable=False),
    sa.Column('season_number', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=True),
    sa.Column('overview', sa.Text(), nullable=True),
    sa.Column('air_date', sa.Date(), nullable=True),
    sa.Column('episode_count', sa.Integer(), nullable=True),
    sa.Column('poster_path', sa.String(), nullable=True),
    sa.Column('vote_average', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['show_id'], ['show.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_season_show_id'), 'season', ['show_id'], unique=False)
    op.create_table('shelves',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('description', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('notify', sa.Boolean(), server_default='true', nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_shelves_user_id'), 'shelves', ['user_id'], unique=False)
    op.create_table('show_genre',
    sa.Column('show_id', sa.Integer(), nullable=False),
    sa.Column('genre_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['genre_id'], ['genre.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['show_id'], ['show.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('show_id', 'genre_id')
    )
    op.create_table('show_provider',
    sa.Column('show_id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('flatrate', sa.Boolean(), nullable=True),
    sa.Column('rent', sa.Boolean(), nullable=True),
    sa.Column('buy', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['provider_id'], ['provider.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['show_id'], ['show.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('show_id', 'provider_id')
    )
    op.create_table('show_video',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('show_id', sa.Integer(), nullable=False),
    sa.Column('video_key', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=True),
    sa.Column('first_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['show_id'], ['show.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_show_video_show_id'), 'show_video', ['show_id'], unique=False)
    op.create_table('user_streaming_service',
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['provider_id'], ['provider.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'provider_id'),
    sa.UniqueConstraint('user_id', 'provider_id', name='uq_user_provider')
    )
    op.create_table('watched',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('content_type', sa.String(), nullable=True),
    sa.Column('content_id', sa.Integer(), nullable=True),
    sa.Column('watched_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('rating', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'content_type', 'content_id', name='uq_watched_user_content')
    )
    op.create_index('ix_watched_user_content', 'watched', ['user_id', 'content_type', 'content_id'], unique=False)
    op.create_index(op.f('ix_watched_user_id'), 'watched', ['user_id'], unique=False)
    op.create_table('watchlist',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('content_type', sa.String(), nullable=True),
    sa.Column('content_id', sa.Integer(), nullable=True),
    sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('sort_key', sa.BigInteger(), nullable=False),
    sa.Column('notify', sa.Boolean(), server_default='true', nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'content_type', 'content_id', name='uq_watchlist_user_content')
    )
    op.create_index('ix_watchlist_user_content', 'watchlist', ['user_id', 'content_type', 'content_id'], unique=False)
    op.create_index(op.f('ix_watchlist_user_id'), 'watchlist', ['user_id'], unique=False)
    op.create_table('episode_watched',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('show_id', sa.Integer(), nullable=True),
    sa.Column('episode_id', sa.Integer(), nullable=True),
    sa.Column('season_number', sa.Integer(), nullable=True),
    sa.Column('episode_number', sa.Integer(), nullable=True),
    sa.Column('watched_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('rating', sa.Float(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['episode_id'], ['episode.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['show_id'], ['show.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'show_id', 'season_number', 'episode_number', name='uq_episode_watched_user_episode')
    )
    op.create_index('ix_episode_watched_show', 'episode_watched', ['show_id'], unique=False)
    op.create_index(op.f('ix_episode_watched_user_id'), 'episode_watched', ['user_id'], unique=False)
    op.create_index('ix_episode_watched_user_show', 'episode_watched', ['user_id', 'show_id'], unique=False)
    op.create_table('review_like',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('review_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['review_id'], ['review.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'review_id', name='uq_review_like')
    )
    op.create_index(op.f('ix_review_like_review_id'), 'review_like', ['review_id'], unique=False)
    op.create_index(op.f('ix_review_like_user_id'), 'review_like', ['user_id'], unique=False)
    op.create_table('shelf_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('shelf_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('content_type', sa.String(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['shelf_id'], ['shelves.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('shelf_id', 'content_type', 'content_id')
    )
    op.create_index('ix_shelf_item_user_content', 'shelf_items', ['user_id', 'content_type', 'content_id'], unique=False)
    op.create_index(op.f('ix_shelf_items_shelf_id'), 'shelf_items', ['shelf_id'], unique=False)
    op.create_index(op.f('ix_shelf_items_user_id'), 'shelf_items', ['user_id'], unique=False)
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrading past the baseline would drop every table and all data in
    them. Refuse; restore from a backup (or drop the database) instead."""
    raise NotImplementedError("Refusing to downgrade past the baseline: it would drop every table.")
