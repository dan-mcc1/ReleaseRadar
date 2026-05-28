from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Float,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.sql import func
from app.db.base import Base


class FantasyLeague(Base):
    """A private fantasy league. Owner invites members, configures roster shape
    and budgets. Leagues are scoped to a series of seasons (4/year)."""

    __tablename__ = "fantasy_league"

    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False)
    owner_id = Column(String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    current_season_id = Column(
        Integer,
        ForeignKey("fantasy_season.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
    )

    starting_budget = Column(Integer, nullable=False, server_default="200")
    weekly_allowance = Column(Integer, nullable=False, server_default="5")
    roster_movie_slots = Column(Integer, nullable=False, server_default="4")
    roster_tv_slots = Column(Integer, nullable=False, server_default="3")
    roster_flex_slots = Column(Integer, nullable=False, server_default="1")
    bench_slots = Column(Integer, nullable=False, server_default="4")
    boost_slots = Column(Integer, nullable=False, server_default="2")
    max_members = Column(Integer, nullable=False, server_default="12")

    # Auction draft timing. Bid window resets to extension_seconds when a bid
    # lands within that final window (snipe protection).
    draft_bid_window_seconds = Column(
        Integer, nullable=False, server_default="86400"
    )
    draft_nomination_window_seconds = Column(
        Integer, nullable=False, server_default="86400"
    )
    draft_extension_seconds = Column(
        Integer, nullable=False, server_default="600"
    )

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FantasyLeagueMember(Base):
    __tablename__ = "fantasy_league_member"

    league_id = Column(
        Integer, ForeignKey("fantasy_league.id", ondelete="CASCADE"), primary_key=True
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    display_name = Column(String(50), nullable=True)
    role = Column(String, nullable=False, server_default="member")  # owner|admin|member
    # Auction budget remaining + accumulated weekly allowance, spent on waivers.
    budget_remaining = Column(Integer, nullable=False, server_default="0")
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_fantasy_league_member_user", "user_id"),)


class FantasySeason(Base):
    """One of four seasons per year (summer / fall / holiday / spring)."""

    __tablename__ = "fantasy_season"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer,
        ForeignKey("fantasy_league.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(40), nullable=False)  # "Summer 2026"
    code = Column(String(20), nullable=False)  # summer|fall|holiday|spring
    year = Column(Integer, nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=False)
    # upcoming -> draft -> active -> complete
    status = Column(String, nullable=False, server_default="upcoming")

    # Draft state. nomination_order is a JSON list of user_ids set at start_draft.
    # next_nominator_index points into that list (modulo length, skipping members
    # whose rosters are full). nomination_deadline is when the current nominator
    # auto-skips if they don't open an auction.
    nomination_order = Column(Text, nullable=True)
    next_nominator_index = Column(Integer, nullable=False, server_default="0")
    nomination_deadline = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "league_id", "code", "year", name="uq_fantasy_season_league_code_year"
        ),
    )


class FantasyAsset(Base):
    """A drafted movie or show on a player's roster. content_type/content_id
    references Movie or Show (TMDb id). A row is "active" while dropped_at IS NULL."""

    __tablename__ = "fantasy_asset"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer, ForeignKey("fantasy_league.id", ondelete="CASCADE"), nullable=False
    )
    season_id = Column(
        Integer, ForeignKey("fantasy_season.id", ondelete="CASCADE"), nullable=False
    )
    owner_user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )

    content_type = Column(String, nullable=False)  # 'movie' | 'tv'
    content_id = Column(Integer, nullable=False)

    auction_price = Column(Integer, nullable=False)
    slot_type = Column(String, nullable=False)  # 'movie' | 'tv' | 'flex'

    drafted_at = Column(DateTime(timezone=True), server_default=func.now())
    dropped_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_fantasy_asset_owner", "owner_user_id", "season_id"),
        Index(
            "ix_fantasy_asset_active",
            "league_id",
            "season_id",
            "dropped_at",
        ),
        # Uniqueness of active rows per (league, season, content) is enforced
        # at the application layer (draft_asset / waiver resolution) — a partial
        # unique index can't be expressed portably across Postgres + SQLite.
        Index(
            "ix_fantasy_asset_content",
            "league_id",
            "season_id",
            "content_type",
            "content_id",
        ),
    )


class FantasyWaiverBid(Base):
    """Blind FAAB bid on an undrafted or dropped asset. Resolved weekly in
    descending bid order; ties broken by submission time."""

    __tablename__ = "fantasy_waiver_bid"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer,
        ForeignKey("fantasy_league.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    season_id = Column(
        Integer, ForeignKey("fantasy_season.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )

    content_type = Column(String, nullable=False)
    content_id = Column(Integer, nullable=False)

    bid_amount = Column(Integer, nullable=False)
    # Optional: asset to drop if this bid wins (roster slot already full).
    drop_asset_id = Column(
        Integer, ForeignKey("fantasy_asset.id", ondelete="SET NULL"), nullable=True
    )

    # pending|won|lost|cancelled
    status = Column(String, nullable=False, server_default="pending")
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_fantasy_waiver_pending", "league_id", "season_id", "status"),
    )


class FantasyTrade(Base):
    __tablename__ = "fantasy_trade"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer,
        ForeignKey("fantasy_league.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    season_id = Column(
        Integer, ForeignKey("fantasy_season.id", ondelete="CASCADE"), nullable=False
    )
    proposer_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    recipient_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    # pending|accepted|declined|cancelled|vetoed
    status = Column(String, nullable=False, server_default="pending")
    message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class FantasyTradeAsset(Base):
    """One leg of a trade: either an asset transfer or a budget transfer."""

    __tablename__ = "fantasy_trade_asset"

    id = Column(Integer, primary_key=True)
    trade_id = Column(
        Integer,
        ForeignKey("fantasy_trade.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 'proposer_sends' | 'recipient_sends'
    direction = Column(String, nullable=False)
    asset_id = Column(
        Integer, ForeignKey("fantasy_asset.id", ondelete="CASCADE"), nullable=True
    )
    budget_amount = Column(Integer, nullable=True)


class FantasyLineupBoost(Base):
    """A player's chosen boost slots for a given week. Each league has a fixed
    number of boost slots per player per week (default 2)."""

    __tablename__ = "fantasy_lineup_boost"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer, ForeignKey("fantasy_league.id", ondelete="CASCADE"), nullable=False
    )
    season_id = Column(
        Integer, ForeignKey("fantasy_season.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    asset_id = Column(
        Integer, ForeignKey("fantasy_asset.id", ondelete="CASCADE"), nullable=False
    )
    week_number = Column(Integer, nullable=False)
    set_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "league_id",
            "season_id",
            "user_id",
            "week_number",
            "asset_id",
            name="uq_fantasy_lineup_boost",
        ),
        Index("ix_fantasy_boost_week", "league_id", "season_id", "week_number"),
    )


class FantasyWeeklyScore(Base):
    """A snapshot of an asset's points for one week. Standings = sum of these
    rows for a user's active assets across the season."""

    __tablename__ = "fantasy_weekly_score"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer, ForeignKey("fantasy_league.id", ondelete="CASCADE"), nullable=False
    )
    season_id = Column(
        Integer, ForeignKey("fantasy_season.id", ondelete="CASCADE"), nullable=False
    )
    asset_id = Column(
        Integer, ForeignKey("fantasy_asset.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )

    week_number = Column(Integer, nullable=False)
    points = Column(Float, nullable=False, server_default="0")
    # JSON blob: {"base": 20, "milestones": 45, "bonuses": {...}, "penalties": {...}}
    breakdown = Column(Text, nullable=True)
    computed_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "asset_id", "week_number", name="uq_fantasy_weekly_score_asset_week"
        ),
        Index("ix_fantasy_weekly_score_user_season", "user_id", "season_id"),
        Index(
            "ix_fantasy_weekly_score_league_week",
            "league_id",
            "season_id",
            "week_number",
        ),
    )


class FantasyLeagueInvitation(Base):
    """Pending invite from an owner to a prospective member. Lives only while
    pending — accepting deletes the row and creates a FantasyLeagueMember,
    declining just deletes it. Re-invites work because there's no history kept."""

    __tablename__ = "fantasy_league_invitation"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer,
        ForeignKey("fantasy_league.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invited_by = Column(
        String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("league_id", "user_id", name="uq_fantasy_league_invitation"),
    )


class FantasyDraftNomination(Base):
    """One asset being auctioned during a draft. Only one open nomination per
    season at a time; status flips to 'closed' once the bid window expires."""

    __tablename__ = "fantasy_draft_nomination"

    id = Column(Integer, primary_key=True)
    league_id = Column(
        Integer, ForeignKey("fantasy_league.id", ondelete="CASCADE"), nullable=False
    )
    season_id = Column(
        Integer,
        ForeignKey("fantasy_season.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    nominator_user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    content_type = Column(String, nullable=False)  # 'movie' | 'tv'
    content_id = Column(Integer, nullable=False)
    slot_type = Column(String, nullable=False)  # 'movie' | 'tv' | 'flex'

    current_high_bid = Column(Integer, nullable=False)
    current_high_bidder_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )

    starts_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    # open | closed | cancelled
    status = Column(String, nullable=False, server_default="open")

    # Set once closed and the winning asset is created. Null for open + cancelled.
    resulting_asset_id = Column(
        Integer, ForeignKey("fantasy_asset.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        # The "at most one open nomination per season" invariant is enforced by
        # the service (nominate() checks for an existing open row before
        # inserting). A partial unique index can't be expressed portably across
        # Postgres + SQLite, so we lean on application code here too.
        Index("ix_fantasy_nomination_status", "season_id", "status"),
    )


class FantasyDraftPass(Base):
    """A player declaring they're out of bidding on a specific nomination.
    Once passed, the user can no longer bid on that nomination. Auctions
    auto-close when every non-high-bidder has passed."""

    __tablename__ = "fantasy_draft_pass"

    id = Column(Integer, primary_key=True)
    nomination_id = Column(
        Integer,
        ForeignKey("fantasy_draft_nomination.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    passed_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "nomination_id", "user_id", name="uq_fantasy_draft_pass"
        ),
    )


class FantasyDraftBid(Base):
    """A single bid placed on a draft nomination. Kept for history/audit even
    after the nomination closes."""

    __tablename__ = "fantasy_draft_bid"

    id = Column(Integer, primary_key=True)
    nomination_id = Column(
        Integer,
        ForeignKey("fantasy_draft_nomination.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    amount = Column(Integer, nullable=False)
    placed_at = Column(DateTime(timezone=True), server_default=func.now())


class FantasyRenewalEvent(Base):
    """Manually recorded TV renewal or cancellation announcement. Feeds scoring
    bonuses/penalties when the announcement falls inside an active season."""

    __tablename__ = "fantasy_renewal_event"

    id = Column(Integer, primary_key=True)
    show_id = Column(
        Integer, ForeignKey("show.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type = Column(String, nullable=False)  # 'renewed' | 'cancelled'
    announced_at = Column(DateTime(timezone=True), nullable=False)
    note = Column(Text, nullable=True)
    created_by = Column(
        String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_fantasy_renewal_show_date", "show_id", "announced_at"),)
