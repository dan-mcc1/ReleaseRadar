"""FAAB blind-bid waiver wire. Players submit bids during the week; resolution
runs them in descending bid order and assigns each contested asset to the
highest bidder who can still afford it after their other winnings."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyAsset,
    FantasyLeague,
    FantasyLeagueMember,
    FantasySeason,
    FantasyWaiverBid,
)
from app.models.movie import Movie
from app.models.show import Show

VALID_CONTENT_TYPES = {"movie", "tv"}
VALID_SLOT_TYPES = {"movie", "tv", "flex"}


def _require_member(
    db: Session, league_id: int, user_id: str
) -> FantasyLeagueMember:
    member = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="League not found.")
    return member


def _verify_content_exists(db: Session, content_type: str, content_id: int) -> None:
    if content_type == "movie":
        if not db.query(Movie.id).filter(Movie.id == content_id).first():
            raise HTTPException(status_code=404, detail="Movie not found.")
    elif content_type == "tv":
        if not db.query(Show.id).filter(Show.id == content_id).first():
            raise HTTPException(status_code=404, detail="Show not found.")


def _serialize_bid(bid: FantasyWaiverBid) -> dict:
    return {
        "id": bid.id,
        "league_id": bid.league_id,
        "season_id": bid.season_id,
        "user_id": bid.user_id,
        "content_type": bid.content_type,
        "content_id": bid.content_id,
        "bid_amount": bid.bid_amount,
        "drop_asset_id": bid.drop_asset_id,
        "status": bid.status,
        "submitted_at": bid.submitted_at,
        "resolved_at": bid.resolved_at,
    }


def submit_bid(
    db: Session,
    user_id: str,
    league_id: int,
    season_id: int,
    *,
    content_type: str,
    content_id: int,
    bid_amount: int,
    drop_asset_id: int | None = None,
) -> dict:
    member = _require_member(db, league_id, user_id)

    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid content_type.")
    if bid_amount < 0:
        raise HTTPException(status_code=422, detail="bid_amount must be >= 0.")

    season = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.id == season_id, FantasySeason.league_id == league_id
        )
        .first()
    )
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")

    _verify_content_exists(db, content_type, content_id)

    on_active_roster = (
        db.query(FantasyAsset)
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.content_type == content_type,
            FantasyAsset.content_id == content_id,
            FantasyAsset.dropped_at.is_(None),
        )
        .first()
    )
    if on_active_roster:
        raise HTTPException(
            status_code=409, detail="That asset is already rostered."
        )

    if drop_asset_id is not None:
        drop_asset = db.get(FantasyAsset, drop_asset_id)
        if (
            not drop_asset
            or drop_asset.owner_user_id != user_id
            or drop_asset.dropped_at is not None
        ):
            raise HTTPException(
                status_code=404, detail="Drop asset not on your roster."
            )

    # Pending bids reserve budget. Sum the user's existing pending to check.
    pending_total = (
        db.query(func.coalesce(func.sum(FantasyWaiverBid.bid_amount), 0))
        .filter(
            FantasyWaiverBid.league_id == league_id,
            FantasyWaiverBid.season_id == season_id,
            FantasyWaiverBid.user_id == user_id,
            FantasyWaiverBid.status == "pending",
        )
        .scalar()
        or 0
    )
    if pending_total + bid_amount > member.budget_remaining:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Insufficient budget. You have {member.budget_remaining} "
                f"with {pending_total} already on pending bids."
            ),
        )

    bid = FantasyWaiverBid(
        league_id=league_id,
        season_id=season_id,
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        bid_amount=bid_amount,
        drop_asset_id=drop_asset_id,
    )
    db.add(bid)
    db.commit()
    db.refresh(bid)
    return _serialize_bid(bid)


def cancel_bid(db: Session, user_id: str, bid_id: int) -> dict:
    bid = db.get(FantasyWaiverBid, bid_id)
    if not bid or bid.user_id != user_id:
        raise HTTPException(status_code=404, detail="Bid not found.")
    if bid.status != "pending":
        raise HTTPException(
            status_code=409, detail="Only pending bids can be cancelled."
        )
    bid.status = "cancelled"
    bid.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(bid)
    return _serialize_bid(bid)


def list_my_bids(
    db: Session,
    user_id: str,
    league_id: int,
    season_id: int,
    *,
    status: str | None = None,
) -> list[dict]:
    _require_member(db, league_id, user_id)
    q = db.query(FantasyWaiverBid).filter(
        FantasyWaiverBid.league_id == league_id,
        FantasyWaiverBid.season_id == season_id,
        FantasyWaiverBid.user_id == user_id,
    )
    if status:
        q = q.filter(FantasyWaiverBid.status == status)
    rows = q.order_by(FantasyWaiverBid.submitted_at.desc()).all()
    return [_serialize_bid(b) for b in rows]


def resolve_waivers(db: Session, *, league_id: int, season_id: int) -> dict:
    """Process all pending bids in a league/season. Highest bidder wins each
    contested asset; ties broken by earliest submission. Losing bids are simply
    marked 'lost' — money is only spent on wins."""
    league = db.get(FantasyLeague, league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found.")

    bids = (
        db.query(FantasyWaiverBid)
        .filter(
            FantasyWaiverBid.league_id == league_id,
            FantasyWaiverBid.season_id == season_id,
            FantasyWaiverBid.status == "pending",
        )
        .order_by(
            FantasyWaiverBid.bid_amount.desc(),
            FantasyWaiverBid.submitted_at.asc(),
        )
        .all()
    )

    if not bids:
        return {"resolved": 0, "winners": [], "losers": 0}

    members = {
        m.user_id: m
        for m in db.query(FantasyLeagueMember)
        .filter(FantasyLeagueMember.league_id == league_id)
        .all()
    }

    assigned: set[tuple[str, int]] = set()  # (content_type, content_id) won this round
    winners: list[dict] = []
    losers = 0
    now = datetime.now(timezone.utc)

    for bid in bids:
        key = (bid.content_type, bid.content_id)
        if key in assigned:
            bid.status = "lost"
            bid.resolved_at = now
            losers += 1
            continue

        member = members.get(bid.user_id)
        if not member or member.budget_remaining < bid.bid_amount:
            bid.status = "lost"
            bid.resolved_at = now
            losers += 1
            continue

        # Make sure roster has space for the new asset (after the optional drop).
        if bid.drop_asset_id is not None:
            drop_asset = db.get(FantasyAsset, bid.drop_asset_id)
            if (
                drop_asset
                and drop_asset.owner_user_id == bid.user_id
                and drop_asset.dropped_at is None
            ):
                drop_asset.dropped_at = now
                slot_type = drop_asset.slot_type
            else:
                bid.status = "lost"
                bid.resolved_at = now
                losers += 1
                continue
        else:
            slot_type = "movie" if bid.content_type == "movie" else "tv"
            slot_limits = {
                "movie": league.roster_movie_slots,
                "tv": league.roster_tv_slots,
                "flex": league.roster_flex_slots,
            }
            used = (
                db.query(func.count(FantasyAsset.id))
                .filter(
                    FantasyAsset.league_id == league_id,
                    FantasyAsset.season_id == season_id,
                    FantasyAsset.owner_user_id == bid.user_id,
                    FantasyAsset.dropped_at.is_(None),
                    FantasyAsset.slot_type == slot_type,
                )
                .scalar()
                or 0
            )
            if used >= slot_limits[slot_type]:
                bid.status = "lost"
                bid.resolved_at = now
                losers += 1
                continue

        member.budget_remaining -= bid.bid_amount
        new_asset = FantasyAsset(
            league_id=league_id,
            season_id=season_id,
            owner_user_id=bid.user_id,
            content_type=bid.content_type,
            content_id=bid.content_id,
            auction_price=bid.bid_amount,
            slot_type=slot_type,
        )
        db.add(new_asset)
        bid.status = "won"
        bid.resolved_at = now
        assigned.add(key)
        winners.append(
            {
                "bid_id": bid.id,
                "user_id": bid.user_id,
                "content_type": bid.content_type,
                "content_id": bid.content_id,
                "bid_amount": bid.bid_amount,
            }
        )

    db.commit()
    return {
        "resolved": len(winners) + losers,
        "winners": winners,
        "losers": losers,
    }


def grant_weekly_allowance(db: Session, *, league_id: int) -> int:
    """Credits each league member their weekly_allowance. Returns members updated."""
    league = db.get(FantasyLeague, league_id)
    if not league:
        return 0
    members = (
        db.query(FantasyLeagueMember)
        .filter(FantasyLeagueMember.league_id == league_id)
        .all()
    )
    for m in members:
        m.budget_remaining += league.weekly_allowance
    db.commit()
    return len(members)
