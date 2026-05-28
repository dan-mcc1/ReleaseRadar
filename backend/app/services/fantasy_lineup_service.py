"""Lineup boost slots. Players choose N assets per week to receive a 1.5x
scoring multiplier. Scoring runner applies the multiplier when computing weekly
points."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyAsset,
    FantasyLeague,
    FantasyLeagueMember,
    FantasyLineupBoost,
)

BOOST_MULTIPLIER = 1.5


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


def _serialize_boost(b: FantasyLineupBoost) -> dict:
    return {
        "id": b.id,
        "league_id": b.league_id,
        "season_id": b.season_id,
        "user_id": b.user_id,
        "asset_id": b.asset_id,
        "week_number": b.week_number,
        "set_at": b.set_at,
    }


def set_boost(
    db: Session,
    user_id: str,
    league_id: int,
    *,
    season_id: int,
    asset_id: int,
    week_number: int,
) -> dict:
    member = _require_member(db, league_id, user_id)
    league = db.get(FantasyLeague, league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found.")

    if week_number < 1:
        raise HTTPException(status_code=422, detail="week_number must be >= 1.")

    asset = db.get(FantasyAsset, asset_id)
    if (
        not asset
        or asset.owner_user_id != user_id
        or asset.league_id != league_id
        or asset.season_id != season_id
        or asset.dropped_at is not None
    ):
        raise HTTPException(status_code=404, detail="Asset not on your roster.")

    existing = (
        db.query(FantasyLineupBoost)
        .filter(
            FantasyLineupBoost.league_id == league_id,
            FantasyLineupBoost.season_id == season_id,
            FantasyLineupBoost.user_id == user_id,
            FantasyLineupBoost.week_number == week_number,
            FantasyLineupBoost.asset_id == asset_id,
        )
        .first()
    )
    if existing:
        return _serialize_boost(existing)

    used = (
        db.query(func.count(FantasyLineupBoost.id))
        .filter(
            FantasyLineupBoost.league_id == league_id,
            FantasyLineupBoost.season_id == season_id,
            FantasyLineupBoost.user_id == user_id,
            FantasyLineupBoost.week_number == week_number,
        )
        .scalar()
        or 0
    )
    if used >= league.boost_slots:
        raise HTTPException(
            status_code=409,
            detail=f"All {league.boost_slots} boost slots used for week {week_number}.",
        )

    boost = FantasyLineupBoost(
        league_id=league_id,
        season_id=season_id,
        user_id=user_id,
        asset_id=asset_id,
        week_number=week_number,
    )
    db.add(boost)
    db.commit()
    db.refresh(boost)
    return _serialize_boost(boost)


def clear_boost(db: Session, user_id: str, boost_id: int) -> None:
    boost = db.get(FantasyLineupBoost, boost_id)
    if not boost or boost.user_id != user_id:
        raise HTTPException(status_code=404, detail="Boost not found.")
    db.delete(boost)
    db.commit()


def list_my_boosts(
    db: Session,
    user_id: str,
    league_id: int,
    season_id: int,
    *,
    week_number: int | None = None,
) -> list[dict]:
    _require_member(db, league_id, user_id)
    q = db.query(FantasyLineupBoost).filter(
        FantasyLineupBoost.league_id == league_id,
        FantasyLineupBoost.season_id == season_id,
        FantasyLineupBoost.user_id == user_id,
    )
    if week_number is not None:
        q = q.filter(FantasyLineupBoost.week_number == week_number)
    rows = q.order_by(FantasyLineupBoost.week_number.asc()).all()
    return [_serialize_boost(b) for b in rows]


def has_boost(
    db: Session, *, asset_id: int, week_number: int
) -> bool:
    """Helper for the scoring runner — true if the asset is boosted that week."""
    return (
        db.query(FantasyLineupBoost.id)
        .filter(
            FantasyLineupBoost.asset_id == asset_id,
            FantasyLineupBoost.week_number == week_number,
        )
        .first()
        is not None
    )
