from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import fantasy_lineup_service as lineup_svc

router = APIRouter()


class SetBoostBody(BaseModel):
    season_id: int = Field(..., ge=1)
    asset_id: int = Field(..., ge=1)
    week_number: int = Field(..., ge=1)


@router.post("/{league_id}/boosts")
def set_boost(
    league_id: int,
    body: SetBoostBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return lineup_svc.set_boost(
        db,
        uid,
        league_id,
        season_id=body.season_id,
        asset_id=body.asset_id,
        week_number=body.week_number,
    )


@router.delete("/{league_id}/boosts/{boost_id}", status_code=204)
def clear_boost(
    league_id: int,
    boost_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    lineup_svc.clear_boost(db, uid, boost_id)


@router.get("/{league_id}/seasons/{season_id}/boosts/mine")
def list_my_boosts(
    league_id: int,
    season_id: int,
    week: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return lineup_svc.list_my_boosts(
        db, uid, league_id, season_id, week_number=week
    )
