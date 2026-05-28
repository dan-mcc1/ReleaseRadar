"""add_fantasy_game

Adds the 12 fantasy_* tables for the fantasy box office game:
  fantasy_league, fantasy_league_member, fantasy_season, fantasy_asset,
  fantasy_waiver_bid, fantasy_trade, fantasy_trade_asset, fantasy_lineup_boost,
  fantasy_weekly_score, fantasy_renewal_event, fantasy_draft_nomination,
  fantasy_draft_bid.

Revision ID: d5c9ef31b6a8
Revises: c7e5a91d3f48
Create Date: 2026-05-27 23:26:04.684273

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5c9ef31b6a8'
down_revision: Union[str, Sequence[str], None] = 'c7e5a91d3f48'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # fantasy_league — the league itself + draft/scoring settings
    op.create_table(
        'fantasy_league',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('owner_id', sa.String(), nullable=True),
        sa.Column('current_season_id', sa.Integer(), nullable=True),
        sa.Column('starting_budget', sa.Integer(), server_default='200', nullable=False),
        sa.Column('weekly_allowance', sa.Integer(), server_default='5', nullable=False),
        sa.Column('roster_movie_slots', sa.Integer(), server_default='4', nullable=False),
        sa.Column('roster_tv_slots', sa.Integer(), server_default='3', nullable=False),
        sa.Column('roster_flex_slots', sa.Integer(), server_default='1', nullable=False),
        sa.Column('boost_slots', sa.Integer(), server_default='2', nullable=False),
        sa.Column('max_members', sa.Integer(), server_default='12', nullable=False),
        sa.Column('draft_bid_window_seconds', sa.Integer(), server_default='86400', nullable=False),
        sa.Column('draft_nomination_window_seconds', sa.Integer(), server_default='86400', nullable=False),
        sa.Column('draft_extension_seconds', sa.Integer(), server_default='600', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['current_season_id'], ['fantasy_season.id'], ondelete='SET NULL', use_alter=True),
        sa.ForeignKeyConstraint(['owner_id'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'fantasy_season',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=40), nullable=False),
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(), server_default='upcoming', nullable=False),
        sa.Column('nomination_order', sa.Text(), nullable=True),
        sa.Column('next_nominator_index', sa.Integer(), server_default='0', nullable=False),
        sa.Column('nomination_deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('league_id', 'code', 'year', name='uq_fantasy_season_league_code_year'),
    )
    op.create_index(op.f('ix_fantasy_season_league_id'), 'fantasy_season', ['league_id'], unique=False)

    op.create_table(
        'fantasy_league_member',
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('display_name', sa.String(length=50), nullable=True),
        sa.Column('role', sa.String(), server_default='member', nullable=False),
        sa.Column('budget_remaining', sa.Integer(), server_default='0', nullable=False),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('league_id', 'user_id'),
    )
    op.create_index('ix_fantasy_league_member_user', 'fantasy_league_member', ['user_id'], unique=False)

    op.create_table(
        'fantasy_asset',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('season_id', sa.Integer(), nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=False),
        sa.Column('content_id', sa.Integer(), nullable=False),
        sa.Column('auction_price', sa.Integer(), nullable=False),
        sa.Column('slot_type', sa.String(), nullable=False),
        sa.Column('drafted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('dropped_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['season_id'], ['fantasy_season.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fantasy_asset_active', 'fantasy_asset', ['league_id', 'season_id', 'dropped_at'], unique=False)
    op.create_index('ix_fantasy_asset_content', 'fantasy_asset', ['league_id', 'season_id', 'content_type', 'content_id'], unique=False)
    op.create_index('ix_fantasy_asset_owner', 'fantasy_asset', ['owner_user_id', 'season_id'], unique=False)

    op.create_table(
        'fantasy_waiver_bid',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('season_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=False),
        sa.Column('content_id', sa.Integer(), nullable=False),
        sa.Column('bid_amount', sa.Integer(), nullable=False),
        sa.Column('drop_asset_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(), server_default='pending', nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['drop_asset_id'], ['fantasy_asset.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['season_id'], ['fantasy_season.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_fantasy_waiver_bid_league_id'), 'fantasy_waiver_bid', ['league_id'], unique=False)
    op.create_index('ix_fantasy_waiver_pending', 'fantasy_waiver_bid', ['league_id', 'season_id', 'status'], unique=False)

    op.create_table(
        'fantasy_trade',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('season_id', sa.Integer(), nullable=False),
        sa.Column('proposer_id', sa.String(), nullable=False),
        sa.Column('recipient_id', sa.String(), nullable=False),
        sa.Column('status', sa.String(), server_default='pending', nullable=False),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['proposer_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recipient_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['season_id'], ['fantasy_season.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_fantasy_trade_league_id'), 'fantasy_trade', ['league_id'], unique=False)

    op.create_table(
        'fantasy_trade_asset',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trade_id', sa.Integer(), nullable=False),
        sa.Column('direction', sa.String(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=True),
        sa.Column('budget_amount', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['fantasy_asset.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['trade_id'], ['fantasy_trade.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_fantasy_trade_asset_trade_id'), 'fantasy_trade_asset', ['trade_id'], unique=False)

    op.create_table(
        'fantasy_lineup_boost',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('season_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('week_number', sa.Integer(), nullable=False),
        sa.Column('set_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['fantasy_asset.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['season_id'], ['fantasy_season.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('league_id', 'season_id', 'user_id', 'week_number', 'asset_id', name='uq_fantasy_lineup_boost'),
    )
    op.create_index('ix_fantasy_boost_week', 'fantasy_lineup_boost', ['league_id', 'season_id', 'week_number'], unique=False)

    op.create_table(
        'fantasy_weekly_score',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('season_id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('week_number', sa.Integer(), nullable=False),
        sa.Column('points', sa.Float(), server_default='0', nullable=False),
        sa.Column('breakdown', sa.Text(), nullable=True),
        sa.Column('computed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['fantasy_asset.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['season_id'], ['fantasy_season.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('asset_id', 'week_number', name='uq_fantasy_weekly_score_asset_week'),
    )
    op.create_index('ix_fantasy_weekly_score_league_week', 'fantasy_weekly_score', ['league_id', 'season_id', 'week_number'], unique=False)
    op.create_index('ix_fantasy_weekly_score_user_season', 'fantasy_weekly_score', ['user_id', 'season_id'], unique=False)

    op.create_table(
        'fantasy_renewal_event',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('show_id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('announced_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['show_id'], ['show.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_fantasy_renewal_event_show_id'), 'fantasy_renewal_event', ['show_id'], unique=False)
    op.create_index('ix_fantasy_renewal_show_date', 'fantasy_renewal_event', ['show_id', 'announced_at'], unique=False)

    op.create_table(
        'fantasy_draft_nomination',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('league_id', sa.Integer(), nullable=False),
        sa.Column('season_id', sa.Integer(), nullable=False),
        sa.Column('nominator_user_id', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=False),
        sa.Column('content_id', sa.Integer(), nullable=False),
        sa.Column('slot_type', sa.String(), nullable=False),
        sa.Column('current_high_bid', sa.Integer(), nullable=False),
        sa.Column('current_high_bidder_id', sa.String(), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(), server_default='open', nullable=False),
        sa.Column('resulting_asset_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['current_high_bidder_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['league_id'], ['fantasy_league.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['nominator_user_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resulting_asset_id'], ['fantasy_asset.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['season_id'], ['fantasy_season.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_fantasy_draft_nomination_season_id'), 'fantasy_draft_nomination', ['season_id'], unique=False)
    op.create_index('ix_fantasy_nomination_status', 'fantasy_draft_nomination', ['season_id', 'status'], unique=False)

    op.create_table(
        'fantasy_draft_bid',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nomination_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('placed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['nomination_id'], ['fantasy_draft_nomination.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_fantasy_draft_bid_nomination_id'), 'fantasy_draft_bid', ['nomination_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_fantasy_draft_bid_nomination_id'), table_name='fantasy_draft_bid')
    op.drop_table('fantasy_draft_bid')

    op.drop_index('ix_fantasy_nomination_status', table_name='fantasy_draft_nomination')
    op.drop_index(op.f('ix_fantasy_draft_nomination_season_id'), table_name='fantasy_draft_nomination')
    op.drop_table('fantasy_draft_nomination')

    op.drop_index('ix_fantasy_renewal_show_date', table_name='fantasy_renewal_event')
    op.drop_index(op.f('ix_fantasy_renewal_event_show_id'), table_name='fantasy_renewal_event')
    op.drop_table('fantasy_renewal_event')

    op.drop_index('ix_fantasy_weekly_score_user_season', table_name='fantasy_weekly_score')
    op.drop_index('ix_fantasy_weekly_score_league_week', table_name='fantasy_weekly_score')
    op.drop_table('fantasy_weekly_score')

    op.drop_index('ix_fantasy_boost_week', table_name='fantasy_lineup_boost')
    op.drop_table('fantasy_lineup_boost')

    op.drop_index(op.f('ix_fantasy_trade_asset_trade_id'), table_name='fantasy_trade_asset')
    op.drop_table('fantasy_trade_asset')

    op.drop_index(op.f('ix_fantasy_trade_league_id'), table_name='fantasy_trade')
    op.drop_table('fantasy_trade')

    op.drop_index('ix_fantasy_waiver_pending', table_name='fantasy_waiver_bid')
    op.drop_index(op.f('ix_fantasy_waiver_bid_league_id'), table_name='fantasy_waiver_bid')
    op.drop_table('fantasy_waiver_bid')

    op.drop_index('ix_fantasy_asset_owner', table_name='fantasy_asset')
    op.drop_index('ix_fantasy_asset_content', table_name='fantasy_asset')
    op.drop_index('ix_fantasy_asset_active', table_name='fantasy_asset')
    op.drop_table('fantasy_asset')

    op.drop_index('ix_fantasy_league_member_user', table_name='fantasy_league_member')
    op.drop_table('fantasy_league_member')

    op.drop_index(op.f('ix_fantasy_season_league_id'), table_name='fantasy_season')
    op.drop_table('fantasy_season')

    op.drop_table('fantasy_league')
