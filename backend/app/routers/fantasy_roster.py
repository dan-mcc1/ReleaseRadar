from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import fantasy_roster_service as roster_svc

router = APIRouter()


class DraftAssetBody(BaseModel):
    target_user_id: str = Field(..., min_length=1)
    content_type: str = Field(..., pattern="^(movie|tv)$")
    content_id: int = Field(..., ge=1)
    auction_price: int = Field(..., ge=0)
    slot_type: str = Field(..., pattern="^(movie|tv|flex)$")


@router.post("/{league_id}/seasons/{season_id}/draft")
def draft_asset(
    league_id: int,
    season_id: int,
    body: DraftAssetBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return roster_svc.draft_asset(
        db,
        uid,
        league_id,
        season_id,
        target_user_id=body.target_user_id,
        content_type=body.content_type,
        content_id=body.content_id,
        auction_price=body.auction_price,
        slot_type=body.slot_type,
    )


class SetSlotBody(BaseModel):
    slot_type: str = Field(..., pattern="^(movie|tv|flex|bench)$")


class SwapSlotsBody(BaseModel):
    asset_a_id: int = Field(..., ge=1)
    asset_b_id: int = Field(..., ge=1)


@router.post("/{league_id}/assets/{asset_id}/set-slot")
def set_slot(
    league_id: int,
    asset_id: int,
    body: SetSlotBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return roster_svc.set_asset_slot(db, uid, asset_id, slot_type=body.slot_type)


@router.post("/{league_id}/swap-slots")
def swap_slots(
    league_id: int,
    body: SwapSlotsBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return roster_svc.swap_asset_slots(db, uid, body.asset_a_id, body.asset_b_id)


@router.delete("/{league_id}/assets/{asset_id}")
def drop_asset(
    league_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return roster_svc.drop_asset(db, uid, asset_id)


@router.get("/{league_id}/seasons/{season_id}/my-roster")
def my_roster(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return roster_svc.get_my_roster(db, uid, league_id, season_id)
