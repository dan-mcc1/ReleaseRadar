from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.firebase import verify_token
from app.db.session import SessionLocal, get_db
from app.dependencies.auth import get_current_user
from app.models.fantasy import FantasyLeagueMember
from app.services import fantasy_auction_service as auction_svc
from app.services.fantasy_auction_ws import manager as ws_manager

router = APIRouter()


class StartDraftBody(BaseModel):
    member_order: list[str] | None = Field(
        None, description="Optional explicit nomination order; otherwise randomized."
    )


class NominateBody(BaseModel):
    content_type: str = Field(..., pattern="^(movie|tv)$")
    content_id: int = Field(..., ge=1)
    starting_bid: int = Field(..., ge=1)
    slot_type: str | None = Field(None, pattern="^(movie|tv|flex)$")


class PlaceBidBody(BaseModel):
    amount: int = Field(..., ge=1)


@router.post("/{league_id}/seasons/{season_id}/start")
def start_draft(
    league_id: int,
    season_id: int,
    body: StartDraftBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.start_draft(
        db, uid, league_id, season_id, member_order=body.member_order
    )


@router.post("/{league_id}/seasons/{season_id}/nominate")
def nominate(
    league_id: int,
    season_id: int,
    body: NominateBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.nominate(
        db,
        uid,
        league_id,
        season_id,
        content_type=body.content_type,
        content_id=body.content_id,
        starting_bid=body.starting_bid,
        slot_type=body.slot_type,
    )


@router.post("/{league_id}/nominations/{nomination_id}/bid")
def place_bid(
    league_id: int,
    nomination_id: int,
    body: PlaceBidBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.place_bid(db, uid, league_id, nomination_id, body.amount)


@router.post("/{league_id}/nominations/{nomination_id}/pass")
def pass_on_nomination(
    league_id: int,
    nomination_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.pass_on_nomination(db, uid, league_id, nomination_id)


@router.post("/{league_id}/seasons/{season_id}/skip")
def skip_turn(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.skip_current_nominator(db, uid, league_id, season_id)


@router.post("/{league_id}/seasons/{season_id}/complete")
def complete(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.complete_draft(db, uid, league_id, season_id)


@router.get("/{league_id}/seasons/{season_id}/asset-suggestions")
def asset_suggestions(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Curated picker defaults: popular eligible content the user could draft
    or pick up via waivers. Excludes assets already rostered in the league."""
    return auction_svc.suggest_eligible_assets(db, uid, league_id, season_id)


@router.get("/{league_id}/seasons/{season_id}/asset-search")
def search_eligible_assets(
    league_id: int,
    season_id: int,
    q: str = Query(..., min_length=1, max_length=80),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Search movies + shows that are eligible for this season — releasing or
    airing inside the season window. Replaces /search for the draft + waiver
    pickers so users only see content they can actually nominate."""
    return auction_svc.search_eligible_assets(
        db, uid, league_id, season_id, query=q
    )


@router.get("/{league_id}/seasons/{season_id}/state")
def get_state(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.get_draft_state(db, uid, league_id, season_id)


@router.get("/{league_id}/seasons/{season_id}/nominations")
def list_nominations(
    league_id: int,
    season_id: int,
    status: str | None = Query(None, pattern="^(open|closed|cancelled)$"),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.list_nominations(
        db, uid, league_id, season_id, status=status
    )


@router.get("/{league_id}/nominations/{nomination_id}")
def get_nomination(
    league_id: int,
    nomination_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return auction_svc.get_nomination(db, uid, league_id, nomination_id)


@router.websocket("/ws/{league_id}/{season_id}")
async def auction_ws(
    websocket: WebSocket,
    league_id: int,
    season_id: int,
    token: str = Query(...),
):
    """Live auction subscription. Client sends Firebase ID token via ?token=.
    Server pushes events: draft_started, nomination_opened, bid_placed,
    nomination_closed. Client re-fetches /state on receipt to update UI."""
    try:
        decoded = verify_token(token)
        uid = decoded["uid"]
    except Exception:
        await websocket.close(code=4001)
        return

    db = SessionLocal()
    try:
        is_member = (
            db.query(FantasyLeagueMember.user_id)
            .filter(
                FantasyLeagueMember.league_id == league_id,
                FantasyLeagueMember.user_id == uid,
            )
            .first()
            is not None
        )
    finally:
        db.close()

    if not is_member:
        await websocket.close(code=4003)
        return

    await ws_manager.connect(websocket, league_id, season_id)
    try:
        while True:
            # Keepalive: ignore any incoming frames (pings, client heartbeats).
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket, league_id, season_id)
