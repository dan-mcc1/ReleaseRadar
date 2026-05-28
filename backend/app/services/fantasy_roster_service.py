"""Roster mutations: draft an asset onto a player (admin manual draft for now,
auction logic comes later), drop an active asset, and roster lookups."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyAsset,
    FantasyLeague,
    FantasyLeagueMember,
    FantasySeason,
)
from app.models.movie import Movie
from app.models.show import Show

VALID_CONTENT_TYPES = {"movie", "tv"}
VALID_SLOT_TYPES = {"movie", "tv", "flex", "bench"}


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


def _require_admin(
    db: Session, league_id: int, user_id: str
) -> tuple[FantasyLeague, FantasyLeagueMember]:
    league = db.get(FantasyLeague, league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found.")
    member = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )
    if not member or member.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=403, detail="Only league owners can draft assets."
        )
    return league, member


def _verify_content_exists(db: Session, content_type: str, content_id: int) -> None:
    if content_type == "movie":
        if not db.query(Movie.id).filter(Movie.id == content_id).first():
            raise HTTPException(status_code=404, detail="Movie not found in cache.")
    elif content_type == "tv":
        if not db.query(Show.id).filter(Show.id == content_id).first():
            raise HTTPException(status_code=404, detail="Show not found in cache.")


def _count_active_assets_of_slot(
    db: Session, league_id: int, season_id: int, user_id: str, slot_type: str
) -> int:
    return (
        db.query(func.count(FantasyAsset.id))
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.owner_user_id == user_id,
            FantasyAsset.dropped_at.is_(None),
            FantasyAsset.slot_type == slot_type,
        )
        .scalar()
        or 0
    )


def draft_asset(
    db: Session,
    actor_user_id: str,
    league_id: int,
    season_id: int,
    *,
    target_user_id: str,
    content_type: str,
    content_id: int,
    auction_price: int,
    slot_type: str,
) -> dict:
    """Manual admin draft: league owner assigns an asset to a player at a price.
    Replaces the full auction draft for v1. Deducts the price from the target's
    budget."""
    league, _ = _require_admin(db, league_id, actor_user_id)

    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="content_type must be 'movie' or 'tv'.")
    if slot_type not in VALID_SLOT_TYPES:
        raise HTTPException(status_code=422, detail="slot_type must be 'movie', 'tv', or 'flex'.")
    if auction_price < 0:
        raise HTTPException(status_code=422, detail="auction_price must be >= 0.")

    season = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.id == season_id, FantasySeason.league_id == league_id
        )
        .first()
    )
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")

    target = _require_member(db, league_id, target_user_id)

    _verify_content_exists(db, content_type, content_id)

    existing_active = (
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
    if existing_active:
        raise HTTPException(
            status_code=409,
            detail="That asset is already on a roster in this season.",
        )

    slot_limits = {
        "movie": league.roster_movie_slots,
        "tv": league.roster_tv_slots,
        "flex": league.roster_flex_slots,
    }
    used = _count_active_assets_of_slot(
        db, league_id, season_id, target_user_id, slot_type
    )
    if used >= slot_limits[slot_type]:
        raise HTTPException(
            status_code=409,
            detail=f"{target_user_id} has no remaining {slot_type} slots.",
        )

    if target.budget_remaining < auction_price:
        raise HTTPException(
            status_code=409,
            detail=f"{target_user_id} cannot afford this pick (budget {target.budget_remaining}, price {auction_price}).",
        )
    target.budget_remaining -= auction_price

    asset = FantasyAsset(
        league_id=league_id,
        season_id=season_id,
        owner_user_id=target_user_id,
        content_type=content_type,
        content_id=content_id,
        auction_price=auction_price,
        slot_type=slot_type,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _serialize_asset(asset)


def set_asset_slot(
    db: Session, user_id: str, asset_id: int, *, slot_type: str
) -> dict:
    """Move an asset between slot types (e.g. movie → bench, bench → flex).
    The slot_type must be valid and the player must have an open slot of that
    type — except they can ALWAYS move their own asset to a non-active slot
    they're vacating, since the move is atomic."""
    asset = db.get(FantasyAsset, asset_id)
    if not asset or asset.dropped_at is not None:
        raise HTTPException(status_code=404, detail="Asset not found.")

    member = _require_member(db, asset.league_id, user_id)  # noqa: F841
    if asset.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="That's not your asset.")

    if slot_type not in VALID_SLOT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid slot_type.")

    if slot_type == asset.slot_type:
        return _serialize_asset(asset)

    # Movie content can occupy movie, flex, or bench. TV content can occupy
    # tv, flex, or bench. (Active type must match content_type for movie/tv.)
    if slot_type == "movie" and asset.content_type != "movie":
        raise HTTPException(
            status_code=422,
            detail="Only movies can occupy a movie slot.",
        )
    if slot_type == "tv" and asset.content_type != "tv":
        raise HTTPException(
            status_code=422,
            detail="Only shows can occupy a tv slot.",
        )

    league = db.get(FantasyLeague, asset.league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found.")

    # Verify destination slot has room (excluding the asset being moved).
    used = (
        db.query(FantasyAsset.slot_type, func.count(FantasyAsset.id))
        .filter(
            FantasyAsset.league_id == asset.league_id,
            FantasyAsset.season_id == asset.season_id,
            FantasyAsset.owner_user_id == user_id,
            FantasyAsset.dropped_at.is_(None),
            FantasyAsset.id != asset_id,
        )
        .group_by(FantasyAsset.slot_type)
        .all()
    )
    used_counts = {s: c for s, c in used}
    slot_limits = {
        "movie": league.roster_movie_slots,
        "tv": league.roster_tv_slots,
        "flex": league.roster_flex_slots,
        "bench": league.bench_slots,
    }
    if used_counts.get(slot_type, 0) >= slot_limits[slot_type]:
        raise HTTPException(
            status_code=409,
            detail=f"No open {slot_type} slot available.",
        )

    asset.slot_type = slot_type
    db.commit()
    db.refresh(asset)
    return _serialize_asset(asset)


def swap_asset_slots(
    db: Session, user_id: str, asset_a_id: int, asset_b_id: int
) -> dict:
    """Atomically swap the slot_types of two assets the user owns. Lets you
    move asset A from 'movie' to 'bench' and asset B from 'bench' to 'movie'
    in one operation, even though doing each individually would violate slot
    limits mid-swap."""
    a = db.get(FantasyAsset, asset_a_id)
    b = db.get(FantasyAsset, asset_b_id)
    if not a or not b or a.dropped_at or b.dropped_at:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if a.owner_user_id != user_id or b.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Both assets must be yours.")
    if a.league_id != b.league_id or a.season_id != b.season_id:
        raise HTTPException(
            status_code=422, detail="Assets must be in the same season."
        )

    # Each asset must be legal in the other's slot. Movie content can't go in
    # tv slot, etc.
    if b.slot_type == "movie" and a.content_type != "movie":
        raise HTTPException(
            status_code=422,
            detail="Can't move a TV show into a movie slot.",
        )
    if b.slot_type == "tv" and a.content_type != "tv":
        raise HTTPException(
            status_code=422,
            detail="Can't move a movie into a TV slot.",
        )
    if a.slot_type == "movie" and b.content_type != "movie":
        raise HTTPException(
            status_code=422,
            detail="Can't move a TV show into a movie slot.",
        )
    if a.slot_type == "tv" and b.content_type != "tv":
        raise HTTPException(
            status_code=422,
            detail="Can't move a movie into a TV slot.",
        )

    a.slot_type, b.slot_type = b.slot_type, a.slot_type
    db.commit()
    return {"a": _serialize_asset(a), "b": _serialize_asset(b)}


def drop_asset(db: Session, user_id: str, asset_id: int) -> dict:
    """A player drops one of their own assets. League owner can drop on behalf
    of any member."""
    asset = db.get(FantasyAsset, asset_id)
    if not asset or asset.dropped_at is not None:
        raise HTTPException(status_code=404, detail="Asset not found.")

    member = _require_member(db, asset.league_id, user_id)
    if asset.owner_user_id != user_id and member.role != "owner":
        raise HTTPException(
            status_code=403, detail="You can only drop your own assets."
        )

    asset.dropped_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(asset)
    return _serialize_asset(asset)


def get_my_roster(
    db: Session, user_id: str, league_id: int, season_id: int
) -> list[dict]:
    _require_member(db, league_id, user_id)
    assets = (
        db.query(FantasyAsset)
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.owner_user_id == user_id,
            FantasyAsset.dropped_at.is_(None),
        )
        .order_by(FantasyAsset.drafted_at.asc())
        .all()
    )
    return [_serialize_asset(a) for a in assets]


def _serialize_asset(asset: FantasyAsset) -> dict:
    return {
        "id": asset.id,
        "league_id": asset.league_id,
        "season_id": asset.season_id,
        "owner_user_id": asset.owner_user_id,
        "content_type": asset.content_type,
        "content_id": asset.content_id,
        "auction_price": asset.auction_price,
        "slot_type": asset.slot_type,
        "drafted_at": asset.drafted_at,
        "dropped_at": asset.dropped_at,
    }
