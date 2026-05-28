from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.fantasy import FantasyLeague, FantasyLeagueMember
from app.services import fantasy_waiver_service as waiver_svc

router = APIRouter()


class SubmitBidBody(BaseModel):
    content_type: str = Field(..., pattern="^(movie|tv)$")
    content_id: int = Field(..., ge=1)
    bid_amount: int = Field(..., ge=0)
    drop_asset_id: int | None = Field(None, ge=1)


@router.post("/{league_id}/seasons/{season_id}/bids")
def submit_bid(
    league_id: int,
    season_id: int,
    body: SubmitBidBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return waiver_svc.submit_bid(
        db,
        uid,
        league_id,
        season_id,
        content_type=body.content_type,
        content_id=body.content_id,
        bid_amount=body.bid_amount,
        drop_asset_id=body.drop_asset_id,
    )


@router.get("/{league_id}/seasons/{season_id}/bids/mine")
def list_my_bids(
    league_id: int,
    season_id: int,
    status: str | None = Query(None, pattern="^(pending|won|lost|cancelled)$"),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return waiver_svc.list_my_bids(db, uid, league_id, season_id, status=status)


@router.delete("/{league_id}/bids/{bid_id}")
def cancel_bid(
    league_id: int,
    bid_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return waiver_svc.cancel_bid(db, uid, bid_id)


@router.post("/{league_id}/seasons/{season_id}/resolve")
def resolve(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Manually trigger waiver resolution for a league + season. Owner only."""
    league = db.get(FantasyLeague, league_id)
    if not league or league.owner_id != uid:
        raise HTTPException(status_code=403, detail="Owner only.")
    return waiver_svc.resolve_waivers(db, league_id=league_id, season_id=season_id)


@router.post("/{league_id}/grant-allowance")
def grant_allowance(
    league_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Credit every member with the league's weekly allowance. Owner only."""
    league = db.get(FantasyLeague, league_id)
    if not league or league.owner_id != uid:
        raise HTTPException(status_code=403, detail="Owner only.")
    updated = waiver_svc.grant_weekly_allowance(db, league_id=league_id)
    return {"league_id": league_id, "members_updated": updated}
