from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import fantasy_trade_service as trade_svc

router = APIRouter()


class ProposeTradeBody(BaseModel):
    recipient_id: str = Field(..., min_length=1)
    proposer_assets: list[int] = Field(default_factory=list)
    recipient_assets: list[int] = Field(default_factory=list)
    proposer_cash: int = Field(0, ge=0)
    recipient_cash: int = Field(0, ge=0)
    message: str | None = Field(None, max_length=500)


@router.post("/{league_id}/seasons/{season_id}/trades")
def propose_trade(
    league_id: int,
    season_id: int,
    body: ProposeTradeBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return trade_svc.propose_trade(
        db,
        uid,
        league_id,
        season_id,
        recipient_id=body.recipient_id,
        proposer_assets=body.proposer_assets,
        recipient_assets=body.recipient_assets,
        proposer_cash=body.proposer_cash,
        recipient_cash=body.recipient_cash,
        message=body.message,
    )


@router.get("/{league_id}/seasons/{season_id}/trades/mine")
def list_my_trades(
    league_id: int,
    season_id: int,
    status: str | None = Query(
        None, pattern="^(pending|accepted|declined|cancelled|vetoed)$"
    ),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return trade_svc.list_my_trades(db, uid, league_id, season_id, status=status)


@router.get("/{league_id}/seasons/{season_id}/trades/all")
def list_all_trades(
    league_id: int,
    season_id: int,
    status: str | None = Query(
        None, pattern="^(pending|accepted|declined|cancelled|vetoed)$"
    ),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return trade_svc.list_all_trades(db, uid, league_id, season_id, status=status)


@router.post("/{league_id}/trades/{trade_id}/accept")
def accept(
    league_id: int,
    trade_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return trade_svc.accept_trade(db, uid, trade_id)


@router.post("/{league_id}/trades/{trade_id}/decline")
def decline(
    league_id: int,
    trade_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return trade_svc.decline_trade(db, uid, trade_id)


@router.post("/{league_id}/trades/{trade_id}/veto")
def veto(
    league_id: int,
    trade_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return trade_svc.veto_trade(db, uid, trade_id)
